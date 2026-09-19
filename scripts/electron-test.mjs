import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const electron = process.env.EYEBALLS_ELECTRON ?? require('electron');
const result = spawnSync(electron, ['--test', 'test/runtime.test.mjs', 'test/agents.test.mjs', 'test/network.test.mjs', 'test/scheduler.test.mjs', 'test/undici-order.test.mjs', 'fixtures/consumers.test.mjs'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', EYEBALLS_UNDICI: 'undici-810' }, stdio: 'inherit', timeout: 90000,
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
