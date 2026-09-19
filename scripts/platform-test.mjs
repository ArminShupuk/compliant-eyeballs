import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, release } from 'node:os';
import { join, resolve } from 'node:path';

const npm = process.env.npm_execpath;
if (!npm) throw Error('Run with npm run test:platform');
const directory = process.env.EYEBALLS_PLATFORM_DIR
  ? resolve(process.env.EYEBALLS_PLATFORM_DIR) : mkdtempSync(join(tmpdir(), 'eyeballs-platform-'));
mkdirSync(directory, { recursive: true });
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const report = { package: `${manifest.name}@${manifest.version}`, checked: new Date().toISOString(),
  platform: process.platform, architecture: process.arch, kernel: release(), node: process.versions.node,
  coverageRequired: Number(process.versions.node.split('.')[0]) === 24, steps: [], pass: false };
const env = { ...process.env, EYEBALLS_MATRIX_REPORT: join(directory, 'matrix.json'),
  EYEBALLS_COVERAGE_REPORT: join(directory, 'coverage.json') };
try {
  const openssl = spawnSync('openssl', ['version'], { encoding: 'utf8' });
  if (openssl.status !== 0) throw Error('OpenSSL CLI is required for the TLS fixtures');
  report.openssl = openssl.stdout.trim();
  const steps = [['build'], ['test:public-tree'], ['test:classifications'], ['test:matrix', '--', '--current'], ['test:package']];
  if (report.coverageRequired) steps.push(['test:coverage']);
  for (const [name, ...args] of steps) {
    console.log(`Running ${name} on ${process.platform}/${process.arch}, Node ${process.versions.node}`);
    const log = `${name.replaceAll(':', '-')}.log`;
    const fd = openSync(join(directory, log), 'w');
    const start = performance.now();
    let result;
    try { result = spawnSync(process.execPath, [npm, 'run', name, ...args], { env, stdio: ['ignore', fd, fd], timeout: 15 * 60 * 1000 }); }
    finally { closeSync(fd); }
    report.steps.push({ name, pass: result.status === 0, exitCode: result.status,
      elapsedMs: Math.round(performance.now() - start), log });
    if (result.status !== 0) {
      console.error(readFileSync(join(directory, log), 'utf8'));
      throw Error(`${name} failed; see ${log}${result.error ? ` (${result.error.code})` : ''}`);
    }
  }
  report.matrix = JSON.parse(readFileSync(join(directory, 'matrix.json'), 'utf8'));
  if (report.coverageRequired) report.coverage = JSON.parse(readFileSync(join(directory, 'coverage.json'), 'utf8'));
  report.pass = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.pass ? 'PASS' : 'FAIL'}: ${report.package}; reports: ${directory}`);
  if (report.error) console.error(report.error);
}
