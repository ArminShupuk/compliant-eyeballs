import { spawnSync } from 'node:child_process';

// One test-runner process combines the core and Undici 8 consumer fixtures.
// The included files are the compiled ESM runtime; CommonJS is exercised by
// the packed-install check, and declarations/test tooling have no runtime lines.
const result = spawnSync(process.execPath, [
  '--experimental-test-coverage',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=./scripts/coverage-report.mjs',
  `--test-reporter-destination=${process.env.EYEBALLS_COVERAGE_REPORT ?? 'docs/coverage-results.json'}`,
  '--test-coverage-include=dist/esm/*.js',
  '--test-coverage-lines=100',
  '--test-coverage-branches=100',
  '--test-coverage-functions=100',
  '--test',
  'test/runtime.test.mjs', 'test/agents.test.mjs', 'test/network.test.mjs', 'test/scheduler.test.mjs', 'test/undici-order.test.mjs',
  'fixtures/consumers.test.mjs',
], { stdio: 'inherit', env: { ...process.env, EYEBALLS_UNDICI: 'undici-810' } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
