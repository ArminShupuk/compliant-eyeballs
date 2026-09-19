import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');
rmSync('dist', { recursive: true, force: true });
for (const args of [[], ['--module', 'CommonJS', '--moduleResolution', 'Node', '--outDir', 'dist/cjs']]) {
  const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json', ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
mkdirSync('dist/cjs', { recursive: true });
writeFileSync('dist/cjs/package.json', '{"type":"commonjs"}\n');
