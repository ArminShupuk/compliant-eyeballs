import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
const matrix = JSON.parse(readFileSync('docs/tested-versions.json', 'utf8'));
const currentOnly = process.argv.includes('--current');
const installedOnly = process.argv.includes('--installed');
const selectedArg = process.argv.find(arg => arg.startsWith('--nodes='));
const selectedNodes = selectedArg?.slice('--nodes='.length).split(',');
if (selectedNodes?.some(version => !matrix.nodeVersions.includes(version))) throw new Error('Unknown Node version in --nodes');
const nvmDir = process.env.NVM_DIR ?? join(homedir(), '.nvm');
const nodePath = version => join(nvmDir, 'versions', 'node', `v${version}`, 'bin', 'node');
const versions = currentOnly ? [process.versions.node] : selectedNodes ?? (installedOnly ? matrix.nodeVersions.filter(version => existsSync(nodePath(version))) : matrix.nodeVersions);
if (!versions.length) throw new Error('No listed Node versions are installed');
const atLeast = (a, b) => { const aa = a.split('.').map(Number), bb = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if (aa[i] !== bb[i]) return aa[i] > bb[i]; } return true; };
const results = [];
for (const version of versions) {
  const executable = currentOnly ? process.execPath : nodePath(version);
  if (!existsSync(executable)) throw new Error(`Missing Node ${version}; install with nvm install ${version}`);
  const runtime = JSON.parse(spawnSync(executable, ['-p', 'JSON.stringify(process.versions)'], { encoding: 'utf8' }).stdout);
  const core = spawnSync(executable, ['--test', 'test/runtime.test.mjs', 'test/agents.test.mjs', 'test/network.test.mjs', 'test/scheduler.test.mjs', 'test/undici-order.test.mjs'], { encoding: 'utf8', timeout: 60000 });
  results.push({ node: version, suite: 'core', pass: core.status === 0 });
  console.log(`Node ${version}: core ${core.status === 0 ? 'PASS' : 'FAIL'}`);
  if (core.status !== 0) console.error(core.stdout, core.stderr);
  for (const undici of matrix.undiciVersions) {
    if (!atLeast(version, undici.minimumNode)) { results.push({ node: version, undici: undici.version, excluded: `Undici requires Node >=${undici.minimumNode}` }); continue; }
    const result = spawnSync(executable, ['--test', 'fixtures/consumers.test.mjs'], { env: { ...process.env, EYEBALLS_UNDICI: undici.module, EYEBALLS_TEST_PROTOCOL: '' }, encoding: 'utf8', timeout: 60000 });
    results.push({ node: version, undici: undici.version, pass: result.status === 0,
      http2: Number(undici.version.split('.')[0]) >= 8 ? (result.status === 0 ? 'fixture passed' : 'fixture failed') : 'not supported with Undici 6/7; native HTTP/2 tested in core',
      bundledUndici: runtime.undici ?? 'not reported by runtime',
      builtinFetch: (Number(undici.version.split('.')[0]) >= 8 && Number((runtime.undici ?? '5').split('.')[0]) < 8) || (Number(undici.version.split('.')[0]) < 7 && Number((runtime.undici ?? '5').split('.')[0]) >= 8) ? 'known incompatible dispatcher generation; rejection and matching external fetch asserted' : 'interoperability asserted',
    });
    console.log(`Node ${version} / Undici ${undici.version}: ${result.status === 0 ? 'PASS' : 'FAIL'}`);
    if (result.status !== 0) console.error(result.stdout, result.stderr);
  }
}
writeFileSync(process.env.EYEBALLS_MATRIX_REPORT ?? 'docs/matrix-results.json', JSON.stringify({ date: new Date().toISOString(), platform: process.platform,
  nodesNotInstalled: installedOnly ? matrix.nodeVersions.filter(version => !versions.includes(version)) : [], results }, null, 2) + '\n');
if (results.some(r => r.pass === false)) process.exitCode = 1;
