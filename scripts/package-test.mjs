import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { checkPackage } from './package-content.mjs';
import { certs } from '../test/helpers.mjs';
const require = createRequire(import.meta.url);
const directory = mkdtempSync(join(tmpdir(), 'eyeballs-package-'));
const npm = process.env.npm_execpath;
const sourcePackage = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
assert.equal(lock.version, sourcePackage.version);
assert.equal(lock.packages[''].version, sourcePackage.version);
if (!npm) throw new Error('Run with npm run test:package so npm_execpath is available');
function run(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
try {
  const report = JSON.parse(run(process.execPath, [npm, 'pack', '--json', '--foreground-scripts=false', '--pack-destination', directory], process.cwd()));
  const packed = Array.isArray(report) ? report[0] : report['compliant-eyeballs'];
  assert.ok(packed?.files, 'npm pack did not return a file list');
  run(process.execPath, [require.resolve('typescript/bin/tsc'), '--strict', '--noEmit', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'fixtures/types.mts'], process.cwd());
  assert.ok(packed.files.some(f => f.path === 'LICENSE'));
  assert.ok(packed.files.some(f => f.path === 'dist/cjs/package.json'));
  assert.ok(!packed.files.some(f => /node_modules|\.key$|\.env$|\.tgz$/.test(f.path)));
  writeFileSync(join(directory, 'package.json'), '{"name":"install-fixture","private":true,"type":"module"}\n');
  run(process.execPath, [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, packed.filename)], directory);
  const installed = JSON.parse(readFileSync(join(directory, 'node_modules/compliant-eyeballs/package.json'), 'utf8'));
  assert.equal(packed.version, sourcePackage.version);
  assert.equal(installed.version, sourcePackage.version); assert.equal(Object.keys(installed.dependencies ?? {}).length, 0);
  checkPackage(join(directory, 'node_modules/compliant-eyeballs'), packed.files);
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(installed.scripts?.[hook], undefined);
  const material = certs();
  for (const name of ['ca', 'key', 'cert']) writeFileSync(join(directory, `${name}.pem`), material[name], { mode: 0o600 });
  const smoke = `import assert from 'node:assert/strict';
import net from 'node:net'; import https from 'node:https'; import tls from 'node:tls'; import { readFileSync } from 'node:fs'; import { once } from 'node:events'; import { createRequire } from 'node:module';
import { connectTcp } from 'compliant-eyeballs'; import { createHttpAgent } from 'compliant-eyeballs/agents'; import { createUndiciConnector } from 'compliant-eyeballs/undici';
const require = createRequire(import.meta.url);
for (const path of ['compliant-eyeballs','compliant-eyeballs/agents','compliant-eyeballs/undici']) assert.ok(Object.keys(require(path)).length);
const server = net.createServer(s => s.end('packed')); server.listen(0,'127.0.0.1'); await once(server,'listening');
for (const connect of [connectTcp, require('compliant-eyeballs').connectTcp]) { const socket=await connect({hostname:'127.0.0.1',port:server.address().port}); let body=''; for await(const c of socket) body+=c; assert.equal(body,'packed'); }
createHttpAgent().destroy(); createUndiciConnector().destroy(); await new Promise(r=>server.close(r));
const material = Object.fromEntries(['ca','key','cert'].map(name => [name,readFileSync(name+'.pem')]));
const secure = https.createServer(material, (_req,res)=>res.end('packed-tls'));
secure.listen(0,'127.0.0.1'); await once(secure,'listening');
const port=secure.address().port;
for (const load of [name=>import(name),async name=>require(name)]) {
  const core=await load('compliant-eyeballs'), agents=await load('compliant-eyeballs/agents'), adapter=await load('compliant-eyeballs/undici');
  const socket=await core.connectTls({hostname:'127.0.0.1',port,tls:{ca:material.ca}});
  assert.equal(socket.authorized,true); socket.destroy();
  const agent=agents.createHttpsAgent({ca:material.ca});
  const body=await new Promise((resolve,reject)=>https.get('https://127.0.0.1:'+port,{agent},async res=>{
    let text=''; for await(const chunk of res) text+=chunk; resolve(text);
  }).on('error',reject));
  assert.equal(body,'packed-tls'); agent.destroy();
  const connector=adapter.createUndiciConnector({tls:{ca:material.ca}});
  const connected=await new Promise((resolve,reject)=>connector({hostname:'127.0.0.1',port:String(port),protocol:'https:'},(error,value)=>error?reject(error):resolve(value)));
  assert.ok(connected instanceof tls.TLSSocket); assert.equal(connected.authorized,true);
  connected.destroy(); connector.destroy();
}
await new Promise(resolve=>secure.close(resolve));
`;
  writeFileSync(join(directory, 'smoke.mjs'), smoke); run(process.execPath, ['smoke.mjs'], directory);
  const types = readFileSync('fixtures/package-types.ts', 'utf8');
  for (const extension of ['mts', 'cts']) writeFileSync(join(directory, `consumer.${extension}`), types);
  run(process.execPath, [require.resolve('typescript/bin/tsc'), '--strict', '--noEmit', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--typeRoots', resolve('node_modules/@types'), 'consumer.mts', 'consumer.cts'], directory);
  run(process.execPath, [require.resolve('typescript/bin/tsc'), '--strict', '--noEmit', '--skipLibCheck', '--target', 'ES2022', '--module', 'Node16', '--moduleResolution', 'Node16', '--typeRoots', resolve('node_modules/@types'), 'consumer.mts', 'consumer.cts'], directory);
  run(process.execPath, [require.resolve('typescript/bin/tsc'), '--strict', '--noEmit', '--skipLibCheck', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--typeRoots', resolve('node_modules/@types'), 'consumer.mts'], directory);
  // Contract: TypeScript's CommonJS default uses legacy Node resolution.
  // https://www.typescriptlang.org/tsconfig/moduleResolution
  const legacy = join(directory, 'legacy-commonjs');
  mkdirSync(legacy);
  writeFileSync(join(legacy, 'package.json'), '{"private":true,"type":"commonjs"}\n');
  writeFileSync(join(legacy, 'consumer.ts'), types);
  writeFileSync(join(legacy, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { module: 'commonjs', target: 'es2017', esModuleInterop: true,
      strict: true, noEmitOnError: true, skipLibCheck: true,
      types: ['node'], typeRoots: [resolve('node_modules/@types')] },
    files: ['consumer.ts'],
  }, null, 2) + '\n');
  const tsc = require.resolve('typescript/bin/tsc');
  run(process.execPath, [tsc, '--project', 'tsconfig.json'], legacy);
  run(process.execPath, ['consumer.js'], legacy);
  run(process.execPath, [tsc, '--project', 'tsconfig.json', '--moduleResolution', 'node', '--noEmit'], legacy);
  run(process.execPath, [tsc, '--project', 'tsconfig.json', '--moduleResolution', 'node10', '--noEmit'], legacy);
  console.log('TypeScript package imports passed: NodeNext/Node16 ESM/CommonJS, Bundler and legacy CommonJS (default/node/node10); emitted CommonJS executed.');
  console.log(`Packed ${installed.name}@${installed.version} installation passed: contents, links, ESM, CommonJS, declarations, TCP, TLS, HTTPS agents and connector (${packed.size} bytes).`);
  if (process.env.EYEBALLS_KEEP_PACKAGE) {
    const { copyFileSync } = await import('node:fs');
    copyFileSync(join(directory, packed.filename), process.env.EYEBALLS_KEEP_PACKAGE);
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
