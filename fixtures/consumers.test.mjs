import { rfc, contract } from '../test/classification.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHttpAgent, createHttpsAgent } from '../dist/esm/agents.js';
import { connectTcp } from '../dist/esm/index.js';
import { createUndiciConnector } from '../dist/esm/undici.js';
import { certs, listen, localResolver, delay } from '../test/helpers.mjs';
const require = createRequire(import.meta.url);
const undici = require(process.env.EYEBALLS_UNDICI ?? 'undici');
const undiciVersion = require(`${process.env.EYEBALLS_UNDICI ?? 'undici'}/package.json`).version;
const protocolSuite = process.env.EYEBALLS_TEST_PROTOCOL;
const nonH2Test = protocolSuite === 'http2' ? contract.skip : contract;
const fetch = require('node-fetch-v2');
const fetchV3 = (await import(pathToFileURL(require.resolve('node-fetch-v3')))).default;
const { WebSocket, WebSocketServer } = require('ws');

contract('Undici Dispatcher API and HTTP/2', 'HTTP/2 multiplexing, streaming, cancellation, GOAWAY and reconnect', { skip: protocolSuite === 'http1' ? 'HTTP/2 is tested separately' : Number(undiciVersion.split('.')[0]) < 8 ? 'Undici 8+ is required for the supported HTTP/2 integration (see docs/COMPATIBILITY.md)' : false }, async t => {
  const c = certs(); let sessions = 0, concurrent = 0, maximum = 0, lastSession;
  const server = http2.createSecureServer({ ...c, allowHTTP1: true });
  server.on('session', session => { sessions++; lastSession = session; });
  server.on('stream', (stream, headers) => {
    stream.on('error', () => {});
    maximum = Math.max(maximum, ++concurrent); stream.once('close', () => concurrent--);
    if (headers[':path'] === '/cancel') { stream.respond(); stream.write('first'); return; }
    const chunks = []; stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => { setTimeout(() => { if (!stream.destroyed) { stream.respond(); stream.end(Buffer.concat(chunks).length ? Buffer.concat(chunks) : 'ok'); } }, 20); });
  });
  const { port } = await listen(t, server);
  const connector = createUndiciConnector({ allowH2: true, resolver: localResolver, tls: { ca: c.ca } });
  const dispatcher = new undici.Agent({ connections: 1, pipelining: 10, allowH2: true, connect: connector });
  t.after(async () => { connector.destroy(); await dispatcher.destroy(); });
  const url = `https://localhost:${port}`;
  // Establish the H2 session before concurrent requests to avoid testing client bootstrap policy.
  assert.equal(await (await undici.request(url, { dispatcher })).body.text(), 'ok');
  const values = await Promise.all(Array.from({ length: 3 }, () => undici.request(url, { dispatcher }).then(r => r.body.text())));
  assert.deepEqual(values, ['ok', 'ok', 'ok']); assert.equal(sessions, 1); assert.ok(maximum >= 2);
  const upload = await undici.request(url, { dispatcher, method: 'POST', body: Readable.from(['a'.repeat(65536), 'b'.repeat(65536)]) });
  assert.equal((await upload.body.text()).length, 131072);
  const controller = new AbortController(); const cancelled = await undici.request(`${url}/cancel`, { dispatcher, signal: controller.signal });
  const iterator = cancelled.body[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.toString(), 'first');
  const read = iterator.next(); controller.abort(); await assert.rejects(read);
  const old = lastSession; old.goaway(); await delay(30);
  const reconnected = await undici.request(url, { dispatcher }); assert.equal(await reconnected.body.text(), 'ok'); assert.ok(sessions >= 2); old.close();
});
nonH2Test('Undici Dispatcher and Node HTTPS APIs', 'ALPN HTTP/1.1 fallback and separate native HTTPS agent', async t => {
  const c = certs(), { port } = await listen(t, https.createServer(c, (_req, res) => res.end('h1')));
  const connector = createUndiciConnector({ allowH2: true, resolver: localResolver, tls: { ca: c.ca } });
  const dispatcher = new undici.Agent({ allowH2: true, connect: connector });
  const native = createHttpsAgent({ ca: c.ca, connection: { resolver: localResolver } });
  t.after(async () => { native.destroy(); connector.destroy(); await dispatcher.destroy(); });
  const url = `https://localhost:${port}`;
  assert.equal(await (await undici.request(url, { dispatcher })).body.text(), 'h1');
  assert.equal(await (await fetch(url, { agent: native })).text(), 'h1');
});
nonH2Test('node-fetch 2.6.7 and WebDAV', 'node-fetch 2.6.7 WebDAV, multiple IPv4 candidates, upload and abort', async t => {
  let method, body;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/slow') return;
    method = req.method; body = ''; for await (const chunk of req) body += chunk;
    res.statusCode = method === 'PROPFIND' ? 207 : 201; res.end('<multistatus/>');
  });
  const { port } = await listen(t, server);
  const attempts = [];
  const agent = createHttpAgent({ keepAlive: true, connection: { resolver: (_r, update) => {
    update({ family: 6, addresses: [], complete: true }); update({ family: 4, addresses: ['127.0.0.2', '127.0.0.1'], complete: true });
  }, onDiagnostic: e => { if (e.type === 'attempt') attempts.push(e.candidate.address); } } }); t.after(() => agent.destroy());
  const url = `http://webdav.test:${port}`;
  const result = await fetch(url, { agent, method: 'PROPFIND', body: '<propfind/>', headers: { Depth: '1' } });
  assert.equal(result.status, 207); assert.equal(await result.text(), '<multistatus/>'); assert.equal(method, 'PROPFIND'); assert.equal(body, '<propfind/>');
  assert.deepEqual(attempts, ['127.0.0.2', '127.0.0.1']);
  const controller = new AbortController(); const pending = fetch(`${url}/slow`, { agent, signal: controller.signal });
  await delay(15); controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
});
nonH2Test('node-fetch 3.3.2 and Node HTTPS Agent', 'native-agent download redirects, streaming and cancellation (node-fetch 3.3.2)', async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/book' }); res.end(); }
    else if (req.url === '/stall') { res.write('start'); }
    else Readable.from(Array.from({ length: 32 }, () => Buffer.alloc(8192, 'x'))).pipe(res);
  });
  const { port } = await listen(t, server);
  const agent = createHttpAgent({ keepAlive: true, connection: { resolver: localResolver } }); t.after(() => agent.destroy());
  const url = `http://download.test:${port}`;
  const result = await fetchV3(`${url}/redirect`, { agent }); let bytes = 0;
  for await (const chunk of result.body) bytes += chunk.length;
  assert.equal(bytes, 262144); assert.equal(result.redirected, true);
  const controller = new AbortController(); const stalled = await fetchV3(`${url}/stall`, { agent, signal: controller.signal });
  const read = stalled.text(); controller.abort(); await assert.rejects(read, { name: 'AbortError' });
});
nonH2Test('Node net/http and ws APIs', 'raw TCP, HTTP API, custom lookup, ws and wss with custom trust', async t => {
  const c = certs();
  const raw = await listen(t, net.createServer(s => s.end('raw')));
  const socket = await connectTcp({ hostname: '127.0.0.1', port: raw.port }); let data = ''; for await (const c of socket) data += c; assert.equal(data, 'raw');
  for (const secure of [false, true]) {
    const server = secure ? https.createServer(c, (_req, res) => res.end('{"ok":true}')) : http.createServer((_req, res) => res.end('{"ok":true}'));
    const { port } = await listen(t, server);
    const wsServer = new WebSocketServer({ server }); t.after(() => wsServer.close());
    wsServer.on('connection', ws => ws.on('message', message => ws.send(message)));
    let lookups = 0;
    const lookup = (_hostname, options, callback) => { lookups++; queueMicrotask(() => callback(null, options.family === 4 ? [{ family: 4, address: '127.0.0.1' }] : [])); };
    const agent = secure ? createHttpsAgent({ ca: c.ca, lookup }) : createHttpAgent({ lookup }); t.after(() => agent.destroy());
    const response = await fetch(`${secure ? 'https' : 'http'}://localhost:${port}`, { agent }); assert.deepEqual(await response.json(), { ok: true });
    const ws = new WebSocket(`${secure ? 'wss' : 'ws'}://localhost:${port}`, { agent, ca: c.ca });
    await once(ws, 'open'); const received = once(ws, 'message'); ws.send('echo'); assert.equal((await received)[0].toString(), 'echo');
    const closed = once(ws, 'close'); ws.close(); await closed; assert.ok(lookups >= 2);
  }
});
nonH2Test('Node fetch Dispatcher API', 'Node built-in fetch dispatcher generation compatibility is explicit', async t => {
  const { port } = await listen(t, http.createServer((_req, res) => res.end('builtin')));
  const connector = createUndiciConnector({ resolver: localResolver });
  const dispatcher = new undici.Agent({ connect: connector }); t.after(async () => { connector.destroy(); await dispatcher.destroy(); });
  const externalMajor = Number(undiciVersion.split('.')[0]);
  const bundledMajor = Number((process.versions.undici ?? '5').split('.')[0]);
  if (externalMajor >= 8 && bundledMajor < 8 || externalMajor < 7 && bundledMajor >= 8) {
    await assert.rejects(globalThis.fetch(`http://localhost:${port}`, { dispatcher }), e => e.cause?.code === 'UND_ERR_INVALID_ARG');
    t.diagnostic('Expected incompatibility between dispatcher handler generations; use the matching external undici.fetch');
    const res = await undici.fetch(`http://localhost:${port}`, { dispatcher }); assert.equal(await res.text(), 'builtin');
  } else {
    const res = await globalThis.fetch(`http://localhost:${port}`, { dispatcher }); assert.equal(await res.text(), 'builtin');
  }
});
