import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const known = arg => arg === '--sudo' || arg === '--list' || /^(?:--case|--platform|--output)=.+/.test(arg);
if (args.some(arg => !known(arg))) throw Error('Use --list, --case=ID, --platform=linux/amd64|linux/arm64, --output=DIR or --sudo');
const value = flag => args.find(arg => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
const matrix = JSON.parse(readFileSync('docs/docker-matrix.json', 'utf8')).cases;
const selected = value('--case') ? matrix.filter(item => item.id === value('--case')) : matrix;
if (!selected.length) throw Error('Unknown Docker test case');
if (args.includes('--list')) {
  console.log(JSON.stringify(selected, null, 2));
} else {
  const prefix = args.includes('--sudo') ? ['sudo', '-n', 'docker'] : ['docker'];
  function docker(command, options = {}) {
    const result = spawnSync(prefix[0], [...prefix.slice(1), ...command], { encoding: 'utf8', timeout: 20 * 60 * 1000, ...options });
    if (result.error || result.status !== 0) throw Error(`docker ${command[0]} failed (${result.error?.code ?? result.status})${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
    return result.stdout?.trim();
  }
  const engine = docker(['info', '--format', '{{.OSType}}/{{.Architecture}}']);
  if (!engine.startsWith('linux/')) throw Error('This matrix needs a Linux container engine; use native runners for Windows and macOS');
  const architecture = engine.split('/')[1];
  const platform = value('--platform') ?? ({ x86_64: 'linux/amd64', aarch64: 'linux/arm64', arm64: 'linux/arm64' }[architecture]);
  if (!['linux/amd64', 'linux/arm64'].includes(platform)) throw Error('Supported Docker platforms are linux/amd64 and linux/arm64');
  const output = value('--output') ? resolve(value('--output')) : mkdtempSync(join(tmpdir(), 'eyeballs-docker-'));
  mkdirSync(output, { recursive: true });
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const report = { package: `${manifest.name}@${manifest.version}`, checked: new Date().toISOString(), platform, results: [] };
  for (const entry of selected) {
    const directory = join(output, entry.id); mkdirSync(directory, { recursive: true });
    const log = openSync(join(directory, 'docker.log'), 'w');
    const image = `compliant-eyeballs-test:${entry.id}-${platform.split('/')[1]}-${manifest.version}`;
    let container;
    const result = { ...entry, platform, pass: false };
    try {
      console.log(`Building ${entry.id}: ${entry.image} (${platform})`);
      docker(['pull', '--platform', platform, entry.image], { stdio: ['ignore', log, log] });
      result.baseImageDigests = JSON.parse(docker(['image', 'inspect', '--format', '{{json .RepoDigests}}', entry.image]));
      docker(['build', '--platform', platform, '--build-arg', `NODE_IMAGE=${entry.image}`, '--file', 'Dockerfile.test', '--tag', image, '.'], { stdio: ['ignore', log, log] });
      container = docker(['create', '--name', `eyeballs-test-${randomUUID()}`, '--platform', platform, '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', image]);
      console.log(`Testing ${entry.id}`);
      let executionError;
      try { docker(['start', '--attach', container], { stdio: ['ignore', log, log] }); }
      catch (error) { executionError = error; }
      docker(['cp', `${container}:/tmp/eyeballs-results/.`, directory]);
      const details = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'));
      result.report = details;
      if (executionError) throw executionError;
      if (!details.pass || details.package !== report.package || details.node !== entry.node
        || details.platform !== 'linux' || details.architecture !== (platform.endsWith('amd64') ? 'x64' : 'arm64')) {
        throw Error('Container report failed or does not match the requested package/runtime/platform');
      }
      result.pass = true;
    } catch (error) { result.error = error.message; }
    finally {
      if (container) {
        try { docker(['rm', '--force', container]); }
        catch (error) { result.pass = false; result.cleanupError = error.message; }
      }
      closeSync(log);
      report.results.push(result);
      writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${entry.id}${result.error ? `: ${result.error}` : ''}`);
    }
  }
  console.log(`Docker reports: ${output}`);
  if (report.results.some(result => !result.pass)) process.exitCode = 1;
}
