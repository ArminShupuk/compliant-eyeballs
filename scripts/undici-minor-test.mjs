import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run with npm run test:undici-minors so npm_execpath is available');

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [npm, ...args], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options,
  });
  if (result.status !== 0) {
    throw new Error(`npm ${args[0]} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
  return result.stdout;
}

const published = JSON.parse(run(['view', 'undici', 'versions', '--json']));
const byMinor = new Map();
for (const version of published) {
  const match = /^(6|7|8)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) continue;
  const key = `${match[1]}.${match[2]}`;
  const previous = byMinor.get(key);
  if (!previous || Number(match[3]) > Number(previous.split('.')[2])) byMinor.set(key, version);
}
// Also exercise the first published patch of each supported major: "6+" and
// "8+ for HTTP/2" otherwise leave their literal floors untested.
const versions = [...new Set([...byMinor.values(), '6.0.0', '8.0.0'])].sort((a, b) => {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
});
for (const floor of ['6.0.0', '8.0.0']) {
  if (!published.includes(floor)) throw new Error(`Registry did not return Undici ${floor}`);
}
if (!versions.some(v => v.startsWith('6.')) || !versions.some(v => v.startsWith('7.')) || !versions.some(v => v.startsWith('8.'))) {
  throw new Error('Registry did not return all three Undici major versions');
}

const directory = mkdtempSync(join(tmpdir(), 'eyeballs-undici-minors-'));
const results = [];
try {
  writeFileSync(join(directory, 'package.json'), '{"name":"undici-minor-fixtures","private":true}\n');
  const alias = version => `undici-${version.replaceAll('.', '-')}`;
  run(['install', '--prefix', directory, '--no-save', '--ignore-scripts', '--no-audit', '--no-fund',
    ...versions.map(version => `${alias(version)}@npm:undici@${version}`)], { timeout: 300_000 });

  for (const version of versions) {
    const modulePath = join(directory, 'node_modules', alias(version));
    const installed = JSON.parse(readFileSync(join(modulePath, 'package.json'), 'utf8'));
    if (installed.version !== version) throw new Error(`Expected Undici ${version}, installed ${installed.version}`);
    const modes = Number(version.split('.')[0]) >= 8 ? ['http1', 'http2'] : ['http1'];
    for (const mode of modes) {
      const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'fixtures/consumers.test.mjs'], {
        encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, EYEBALLS_UNDICI: modulePath, EYEBALLS_TEST_PROTOCOL: mode },
      });
      const passedTests = Number(/^# pass (\d+)$/m.exec(child.stdout ?? '')?.[1]);
      const pass = child.status === 0 && passedTests === (mode === 'http2' ? 1 : 7);
      results.push({ undici: version, protocol: mode === 'http2' ? 'HTTP/2' : 'HTTP/1.1 and consumer fixtures', pass, passedTests,
        ...(pass ? {} : { error: (child.error?.message ?? child.stderr?.slice(-4000)) || child.stdout?.slice(-4000) }) });
      console.log(`Undici ${version} ${mode === 'http2' ? 'HTTP/2' : 'HTTP/1.1'}: ${pass ? 'PASS' : 'FAIL'}`);
      if (!pass) console.error(child.stdout?.slice(-4000), child.stderr?.slice(-4000));
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
  const report = process.env.EYEBALLS_UNDICI_MINOR_REPORT ?? 'docs/undici-minor-results.json';
  writeFileSync(report, JSON.stringify({ checked: new Date().toISOString(), node: process.versions.node,
    platform: process.platform, selection: 'latest published stable patch per Undici 6.x, 7.x and 8.x minor, plus 6.0.0 and 8.0.0 floors',
    selectedVersions: versions, results }, null, 2) + '\n');
}
if (results.some(result => !result.pass)) process.exitCode = 1;
