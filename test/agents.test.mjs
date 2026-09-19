import { rfc, contract } from './classification.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { EventEmitter, once } from 'node:events';
import { createHttpAgent, createHttpsAgent } from '../dist/esm/agents.js';
import { certs, listen, localResolver, delay } from './helpers.mjs';

function response(url, options) {
  return new Promise((resolve, reject) => {
    const request = (url.startsWith('https:') ? https : http).get(url, options, async res => {
      try { const resumed = res.socket.isSessionReused?.(); let body = ''; for await (const chunk of res) body += chunk; resolve({ body, request, resumed }); } catch (e) { reject(e); }
    });
    request.on('error', reject);
  });
}
contract('Node HTTP Agent error API', 'single refusal matches native ClientRequest errors', async t => {
  const server = http.createServer();
  const { port } = await listen(t, server);
  await new Promise(resolve => server.close(resolve));
  const url = `http://127.0.0.1:${port}/`;
  const native = await response(url, { agent: false }).catch(error => error);
  const agent = createHttpAgent(); t.after(() => agent.destroy());
  const replacement = await response(url, { agent }).catch(error => error);
  for (const key of ['name', 'code', 'message']) assert.equal(replacement[key], native[key]);
});
contract('Node HTTPS Agent error API', 'untrusted certificate matches native ClientRequest errors', async t => {
  const c = certs();
  const server = https.createServer(c, (_request, result) => result.end());
  server.on('tlsClientError', () => {});
  const { port } = await listen(t, server);
  const url = `https://127.0.0.1:${port}/`;
  const native = await response(url, { agent: false }).catch(error => error);
  const agent = createHttpsAgent(); t.after(() => agent.destroy());
  const replacement = await response(url, { agent }).catch(error => error);
  for (const key of ['name', 'code', 'message']) assert.equal(replacement[key], native[key]);
});
contract('Node HTTP Agent error API', 'remote reset matches native ClientRequest errors', async t => {
  const { port } = await listen(t, http.createServer(request => request.socket.destroy()));
  const url = `http://127.0.0.1:${port}/`;
  const native = await response(url, { agent: false }).catch(error => error);
  const agent = createHttpAgent(); t.after(() => agent.destroy());
  const replacement = await response(url, { agent }).catch(error => error);
  for (const key of ['name', 'code', 'message']) assert.equal(replacement[key], native[key]);
});
contract('Node HTTPS Agent error API', 'OpenSSL protocol errors match native ClientRequest errors', async t => {
  const { port } = await listen(t, net.createServer(socket => socket.end('HTTP/1.1 200 OK\r\n\r\n')));
  const url = `https://127.0.0.1:${port}/`;
  const native = await response(url, { agent: false }).catch(error => error);
  const agent = createHttpsAgent(); t.after(() => agent.destroy());
  const replacement = await response(url, { agent }).catch(error => error);
  for (const key of ['name', 'code', 'message', 'errno', 'syscall']) assert.equal(replacement[key], native[key]);
  assert.match(replacement.cause?.code ?? '', /^ERR_SSL_/);
});
contract('Node HTTPS Agent error API', 'protocol errors retain TLS shape until a request queues a write', async t => {
  const { port } = await listen(t, net.createServer(socket => socket.end('HTTP/1.1 200 OK\r\n\r\n')));
  const url = `https://127.0.0.1:${port}/`;
  for (const action of ['idle', 'flushHeaders', 'write', 'end']) {
    const failure = agent => new Promise(resolve => {
      const req = https.request(url, { agent });
      req.once('error', resolve);
      if (action === 'write') req.write('body');
      else if (action !== 'idle') req[action]();
    });
    const agent = createHttpsAgent(); t.after(() => agent.destroy());
    const expected = await failure(false), actual = await failure(agent);
    for (const key of ['name', 'code', 'message', 'errno', 'syscall']) assert.equal(actual[key], expected[key], `${action}: ${key}`);
  }
  const agent = createHttpsAgent(); t.after(() => agent.destroy());
  const error = await new Promise(resolve => agent.createConnection({ host: '127.0.0.1', port }, resolve));
  assert.match(error.code, /^ERR_SSL_/);
  assert.equal(error.syscall, undefined);
});
for (const module of [http, https]) contract('Node ClientRequest destroy and abort APIs', `${module === https ? 'HTTPS' : 'HTTP'} pending and queued cancellation preserves native errors`, async t => {
  for (const queued of [false, true]) for (const action of ['destroyError', 'destroy', 'abort', 'signal']) {
    const reason = Object.assign(new Error('caller stopped'), { name: 'AbortError', code: 'ABORT_ERR' });
    const failure = async replacement => {
      const options = { maxSockets: 1, lookup: () => {} };
      const agent = replacement ? (module === https ? createHttpsAgent : createHttpAgent)(options) : new module.Agent(options);
      t.after(() => agent.destroy());
      const controller = new AbortController();
      const url = `${module === https ? 'https' : 'http'}://fixture.test/`;
      if (queued) module.get(url, { agent }).on('error', () => {});
      const req = module.get(url, { agent, signal: controller.signal });
      const errors = []; let closes = 0;
      req.on('error', error => errors.push(error)).on('close', () => closes++);
      const closed = new Promise(resolve => req.once('close', resolve));
      if (action === 'destroyError') req.destroy(reason);
      else if (action === 'signal') controller.abort(reason);
      else req[action]();
      // Native queued requests receive their socket before completing close.
      if (queued && !replacement) agent.destroy();
      await closed;
      agent.destroy();
      await delay(0);
      assert.equal(closes, 1);
      assert.equal(Object.hasOwn(req, 'destroy'), false);
      if (replacement) {
        assert.equal(agent.totalSocketCount, 0);
        assert.equal(Object.keys(agent.requests).length, 0);
      }
      return errors;
    };
    const expected = await failure(false), actual = await failure(true);
    assert.equal(actual.length, expected.length, `${action}, queued=${queued}`);
    if (expected.length) {
      for (const key of ['name', 'code', 'message', 'cause']) assert.equal(actual[0][key], expected[0][key]);
      if (action === 'destroyError') assert.equal(actual[0], reason);
    }
  }
});
contract('Node HTTPS Agent error API', 'TLS version alerts match native ClientRequest errors', async t => {
  const c = certs();
  const server = https.createServer({ ...c, minVersion: 'TLSv1.3' }, (_request, result) => result.end());
  server.on('tlsClientError', () => {});
  const { port } = await listen(t, server);
  const url = `https://127.0.0.1:${port}/`;
  const options = { maxVersion: 'TLSv1.2', rejectUnauthorized: false };
  const native = await response(url, { agent: false, ...options }).catch(error => error);
  const agent = createHttpsAgent(options); t.after(() => agent.destroy());
  const replacement = await response(url, { agent }).catch(error => error);
  for (const key of ['name', 'code', 'message', 'errno', 'syscall']) assert.equal(replacement[key], native[key]);
  assert.match(replacement.cause?.code ?? '', /^ERR_SSL_/);
});
contract('Node HTTPS Agent error API', 'custom verifier errors keep their original code', async t => {
  const c = certs();
  const { port } = await listen(t, https.createServer(c, (_request, result) => result.end()));
  const url = `https://127.0.0.1:${port}/`;
  const custom = Object.assign(new Error('fixture verifier rejected'), { code: 'ERR_SSL_CUSTOM' });
  const options = { ca: c.ca, checkServerIdentity: () => custom };
  const native = await response(url, { agent: false, ...options }).catch(error => error);
  const agent = createHttpsAgent(options); t.after(() => agent.destroy());
  const replacement = await response(url, { agent }).catch(error => error);
  for (const key of ['name', 'code', 'message']) assert.equal(replacement[key], native[key]);
});
contract('Node HTTPS custom verifier API', 'numeric DOMException codes preserve the original error without throwing', async t => {
  const c = certs();
  const { port } = await listen(t, https.createServer(c, (_request, result) => result.end()));
  const reason = new DOMException('custom verifier rejected', 'SecurityError');
  const options = { ca: c.ca, checkServerIdentity: () => reason };
  const url = `https://127.0.0.1:${port}/`;
  const expected = await response(url, { agent: false, ...options }).catch(error => error);
  const agent = createHttpsAgent(options); t.after(() => agent.destroy());
  const actual = await response(url, { agent }).catch(error => error);
  assert.equal(expected, reason);
  assert.equal(actual, reason);
});
for (const module of [http, https]) contract('Node ClientRequest abort API', `${module === https ? 'HTTPS' : 'HTTP'} signal cancellation matches native error`, async t => {
  const lookup = () => {};
  const url = `${module === https ? 'https' : 'http'}://fixture.test/`;
  const error = agent => {
    const controller = new AbortController();
    const request = module.get(url, { agent, lookup, signal: controller.signal });
    const failed = new Promise(resolve => request.once('error', resolve));
    queueMicrotask(() => controller.abort('fixture'));
    return failed;
  };
  const native = await error(false);
  const agent = module === https ? createHttpsAgent({ lookup }) : createHttpAgent({ lookup });
  t.after(() => agent.destroy());
  const replacement = await error(agent);
  for (const key of ['name', 'code', 'message', 'cause']) assert.equal(replacement[key], native[key]);
});
for (const code of ['ENOTFOUND', 'EAI_AGAIN']) contract('Node HTTP Agent DNS error API', `${code} matches native ClientRequest errors`, async t => {
  const lookup = (_hostname, _options, callback) => queueMicrotask(() => callback(Object.assign(new Error(`lookup ${code} fixture.test`), { code })));
  const url = 'http://fixture.test/';
  const native = await response(url, { agent: false, lookup }).catch(error => error);
  const agent = createHttpAgent({ lookup }); t.after(() => agent.destroy());
  const replacement = await response(url, { agent }).catch(error => error);
  for (const key of ['name', 'code', 'message']) assert.equal(replacement[key], native[key]);
});
for (const module of [http, https]) contract('Node ClientRequest AbortSignal API', `${module === https ? 'HTTPS' : 'HTTP'} already-aborted requests settle without starting a race`, async t => {
  const reason = new Error('already cancelled');
  const signal = AbortSignal.abort(reason);
  const url = `${module === https ? 'https' : 'http'}://fixture.test/`;
  const native = await new Promise(resolve => module.get(url, { agent: false, signal, lookup: () => {} }).once('error', resolve));
  let lookups = 0;
  const events = [];
  const options = { connection: { resolver: () => { lookups++; throw Error('cancelled request started DNS'); }, onDiagnostic: event => events.push(event) } };
  const agent = (module === https ? createHttpsAgent : createHttpAgent)(options);
  t.after(() => agent.destroy());
  const request = module.get(url, { agent, signal });
  const closed = new Promise(resolve => request.once('close', resolve));
  const actual = await new Promise(resolve => request.once('error', resolve));
  await closed;
  for (const key of ['name', 'code', 'message', 'cause']) assert.equal(actual[key], native[key]);
  assert.equal(lookups, 0);
  assert.deepEqual(events, []);
  assert.equal(agent.totalSocketCount, 0);
  assert.equal(Object.hasOwn(request, 'destroy'), false);
});
contract('Node http.Agent and https.Agent APIs', 'native keep-alive reuse, pool limits, request hooks removed and no global patch', async t => {
  const originalDestroy = http.ClientRequest.prototype.destroy;
  let connections = 0, inFlight = 0, maximum = 0;
  const server = http.createServer((_req, res) => { maximum = Math.max(maximum, ++inFlight); setTimeout(() => { inFlight--; res.end('ok'); }, 10); });
  server.on('connection', () => connections++);
  const { port } = await listen(t, server);
  const agent = createHttpAgent({ keepAlive: true, maxSockets: 1, maxTotalSockets: 1, connection: { resolver: localResolver } }); t.after(() => agent.destroy());
  const responses = await Promise.all(Array.from({ length: 5 }, () => response(`http://localhost:${port}/`, { agent })));
  assert.equal(maximum, 1); assert.equal(connections, 1);
  for (const { body, request } of responses) { assert.equal(body, 'ok'); assert.equal(Object.hasOwn(request, 'destroy'), false); assert.equal(Object.hasOwn(request, 'setTimeout'), false); }
  assert.equal(http.ClientRequest.prototype.destroy, originalDestroy);
  assert.equal(Object.keys(agent.requests).length, 0);
});
for (const method of ['destroy', 'abort', 'signal', 'agent']) contract('Node http.Agent and https.Agent APIs', `pending native race cancellation via ${method}`, async () => {
  let publish, signal, attempts = 0;
  const agent = createHttpAgent({ connection: { resolver: (request, cb) => { signal = request.signal; publish = cb; }, onDiagnostic: e => { if (e.type === 'attempt') attempts++; } } });
  const controller = new AbortController();
  const req = http.get('http://example.test/', { agent, signal: controller.signal }); req.on('error', () => {});
  const closed = new Promise(resolve => req.once('close', resolve));
  if (method === 'agent') agent.destroy(); else if (method === 'signal') controller.abort(); else req[method]();
  await closed; assert.equal(signal.aborted, true); publish({ family: 4, addresses: ['127.0.0.1'], complete: true });
  await delay(15); assert.equal(attempts, 0); assert.equal(Object.hasOwn(req, 'destroy'), false);
  assert.equal(agent.totalSocketCount, 0); assert.equal(Object.keys(agent.sockets).length, 0); agent.destroy();
});
contract('Node http.Agent and https.Agent APIs', 'queued cancellation emits close promptly without starting a race', async () => {
  let resolutions = 0;
  const agent = createHttpAgent({ maxSockets: 1, connection: { resolver: () => { resolutions++; } } });
  const first = http.get('http://example.test/', { agent }); first.on('error', () => {});
  const second = http.get('http://example.test/', { agent }); second.on('error', () => {});
  const secondClosed = new Promise(resolve => second.once('close', resolve)); second.destroy(); await secondClosed;
  assert.equal(resolutions, 1); assert.equal(Object.keys(agent.requests).length, 0);
  const firstClosed = new Promise(resolve => first.once('close', resolve)); agent.destroy(); await firstClosed;
  assert.equal(agent.totalSocketCount, 0);
});
contract('Node http.Agent and https.Agent APIs', 'agent destruction closes both pending and queued requests', async () => {
  const agent = createHttpAgent({ maxSockets: 1, connection: { resolver: () => {} } });
  const requests = Array.from({ length: 3 }, () => http.get('http://example.test/', { agent }));
  const closed = requests.map(req => { req.on('error', () => {}); return new Promise(resolve => req.once('close', resolve)); });
  agent.destroy(); await Promise.all(closed); assert.equal(Object.keys(agent.requests).length, 0); assert.equal(agent.totalSocketCount, 0);
});
contract('Node http.Agent and https.Agent APIs', 'failed race releases reservation and admits queued requests', async () => {
  const agent = createHttpAgent({ maxSockets: 1, connection: { resolver: (_r, cb) => { setTimeout(() => { cb({ family: 6, addresses: [], complete: true }); cb({ family: 4, addresses: [], complete: true }); }, 5); } } });
  const requests = Array.from({ length: 3 }, () => http.get('http://example.test/', { agent }));
  await Promise.all(requests.map(req => new Promise(resolve => req.once('error', resolve))));
  assert.equal(agent.totalSocketCount, 0); assert.equal(Object.keys(agent.requests).length, 0); agent.destroy();
});
contract('Node https.Agent and TLS socket lifecycle APIs', 'failed TLS candidate closes before fallback serves queued requests', async t => {
  const c = certs();
  const { port } = await listen(t, https.createServer(c, (_req, res) => res.end('fallback')));
  let rejectedConnections = 0;
  await listen(t, net.createServer(socket => { rejectedConnections++; socket.end('invalid TLS'); }), '::1', port);
  const attempts = [], failures = [];
  const agent = createHttpsAgent({ ca: c.ca, keepAlive: true, maxSockets: 1, connection: {
    attemptDelayMs: 50, minAttemptDelayMs: 10,
    resolver: (_request, update) => {
      update({ family: 6, addresses: ['::1'], complete: true });
      update({ family: 4, addresses: ['127.0.0.1'], complete: true });
    },
    onDiagnostic: event => {
      if (event.type === 'attempt') attempts.push(event.candidate.family);
      if (event.type === 'failure') failures.push(event.candidate.family);
    },
  } });
  t.after(() => agent.destroy());
  const results = await Promise.all([response(`https://localhost:${port}/`, { agent }), response(`https://localhost:${port}/`, { agent })]);
  assert.deepEqual(results.map(result => result.body), ['fallback', 'fallback']);
  assert.deepEqual(attempts, [6, 4]); assert.deepEqual(failures, [6]);
  assert.equal(rejectedConnections, 1);
  assert.equal(results[0].request.socket, results[1].request.socket);
  assert.equal(Object.keys(agent.requests).length, 0);
  assert.equal(agent.totalSocketCount, 1);
});
contract('Node http.Agent and https.Agent APIs', 'HTTPS preserves original IP identity, including overridden Host header', async t => {
  const c = certs(); const server = https.createServer(c.dns, (_req, res) => res.end('should reject'));
  server.on('tlsClientError', () => {}); const { port } = await listen(t, server);
  const agent = createHttpsAgent({ ca: c.ca }); t.after(() => agent.destroy());
  await assert.rejects(response(`https://127.0.0.1:${port}/`, { agent, headers: { host: 'localhost' } }), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
});
contract('Node http.Agent and https.Agent APIs', 'HTTPS forwards establishment inactivity timeout; notification alone does not destroy', async t => {
  const { port } = await listen(t, net.createServer());
  let hookCalls = 0;
  const agent = createHttpsAgent({ connection: { connectTimeoutMs: 160, onTimeout: () => hookCalls++ } }); t.after(() => agent.destroy());
  const req = https.get(`https://127.0.0.1:${port}/`, { agent, timeout: 20 });
  let notified = 0; req.on('timeout', () => { notified++; assert.equal(req.destroyed, false); });
  const error = await new Promise(resolve => req.once('error', resolve));
  assert.equal(error.code, 'ETIMEDOUT'); assert.ok(notified >= 1); assert.ok(hookCalls >= 1);
});
contract('Node http.Agent and https.Agent APIs', 'setTimeout during establishment forwards notification and caller destruction cancels race', async t => {
  const { port } = await listen(t, net.createServer());
  const agent = createHttpsAgent(); t.after(() => agent.destroy());
  const req = https.get(`https://127.0.0.1:${port}/`, { agent });
  let notified = false;
  req.setTimeout(20, () => { notified = true; req.destroy(new Error('caller timed out')); });
  const error = await new Promise(resolve => req.once('error', resolve));
  assert.ok(notified); assert.match(error.cause?.message ?? error.message, /caller timed out/);
});
contract('Node http.Agent and https.Agent APIs', 'normal HTTP timeout after handoff remains notification-only', async t => {
  const { port } = await listen(t, http.createServer((_req, res) => setTimeout(() => res.end('late'), 80)));
  const agent = createHttpAgent(); t.after(() => agent.destroy());
  let notified = false;
  const result = await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/`, { agent, timeout: 20 }, async res => { let body = ''; for await (const chunk of res) body += chunk; resolve(body); });
    req.on('error', reject).on('timeout', () => { notified = true; assert.equal(req.destroyed, false); });
  });
  assert.equal(result, 'late'); assert.ok(notified);
});
contract('Node http.Agent and https.Agent APIs', 'cancellation exactly around selection prevents HTTP data handoff', async t => {
  let requests = 0;
  const { port } = await listen(t, http.createServer((_req, res) => { requests++; res.end(); }));
  let req;
  const agent = createHttpAgent({ connection: { onDiagnostic: e => { if (e.type === 'selection') req.destroy(); } } }); t.after(() => agent.destroy());
  req = http.get(`http://127.0.0.1:${port}/`, { agent }); req.on('error', () => {});
  await new Promise(resolve => req.once('close', resolve)); assert.equal(requests, 0); assert.equal(agent.totalSocketCount, 0);
});
contract('Node http.Agent and https.Agent APIs', 'explicit proxy and alternate connection ownership are not silently bypassed', () => {
  for (const create of [createHttpAgent, createHttpsAgent]) {
    assert.throws(() => create({ proxyEnv: {} }), /owning proxy agent/);
    assert.throws(() => create({ proxy: 'http://proxy.test' }), /owning proxy agent/);
    assert.throws(() => create({ connection: { proxy: 'http://proxy.test' } }), /owning proxy agent/);
    assert.throws(() => create({ connection: { tls: { proxy: 'http://proxy.test' } } }), /owning proxy agent/);
    assert.throws(() => create({ connection: { httpSocket: {} } }), /owning transport integration/);
    assert.throws(() => create({ createConnection: () => {} }), /retain the existing/);
  }
});
contract('Node http.Agent and https.Agent APIs', 'a proxy-marked native request cannot open a direct socket', async t => {
  let connections = 0;
  const server = http.createServer((_req, res) => res.end('wrong route'));
  server.on('connection', () => connections++);
  const { port } = await listen(t, server);
  const agent = createHttpAgent(); t.after(() => agent.destroy());
  const req = http.get(`http://127.0.0.1:${port}/`, { agent, proxy: 'http://proxy.test' });
  const error = await new Promise(resolve => req.once('error', resolve));
  assert.match(error.message, /owning proxy agent/);
  assert.equal(connections, 0);
});
for (const version of ['TLSv1.2', 'TLSv1.3']) contract('Node http.Agent and https.Agent APIs', `native HTTPS ${version} session resumption and agent isolation`, async t => {
  const c = certs();
  const { port } = await listen(t, https.createServer({ ...c, minVersion: version, maxVersion: version }, (_req, res) => res.end('ok')));
  const options = { ca: c.ca, minVersion: version, maxVersion: version, keepAlive: false };
  const first = createHttpsAgent(options), other = createHttpsAgent(options);
  t.after(() => { first.destroy(); other.destroy(); });
  const url = `https://127.0.0.1:${port}`;
  assert.equal((await response(url, { agent: first })).resumed, false);
  assert.equal((await response(url, { agent: first })).resumed, true);
  assert.equal((await response(url, { agent: other })).resumed, false);
});

contract('Node http.Agent API', 'destroyed and pre-aborted agents reject requests before lookup', async () => {
  const destroyed = createHttpAgent(); destroyed.destroy();
  let failure;
  destroyed.addRequest({ onSocket: (_socket, error) => { failure = error; } }, {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(failure.code, 'ABORT_ERR');
  const controller = new AbortController(); controller.abort();
  const agent = createHttpAgent({ connection: { signal: controller.signal, resolver: () => { throw Error('lookup should not run'); } } });
  const request = http.get('http://example.test/', { agent });
  const error = await once(request, 'error').then(([value]) => value);
  assert.equal(error.code, 'ABORT_ERR'); agent.destroy();
});

contract('Node http.Agent API', 'synchronous native addRequest failure restores request methods', () => {
  const agent = createHttpAgent();
  const request = new EventEmitter();
  request.destroy = function () { return this; };
  request.setTimeout = function () { return this; };
  request.getHeader = () => undefined;
  const originalDestroy = request.destroy, originalTimeout = request.setTimeout;
  agent.createSocket = () => { throw Error('native createSocket failed'); };
  assert.throws(() => agent.addRequest(request, { host: 'localhost', port: 80 }), /native createSocket failed/);
  assert.equal(request.destroy, originalDestroy);
  assert.equal(request.setTimeout, originalTimeout);
  agent.destroy();
});

contract('Node http.Agent createConnection API', 'unsupported direct transport options fail without opening sockets', async () => {
  const agent = createHttpAgent();
  assert.throws(() => agent.createConnection({ host: 'localhost', port: 80 }), /asynchronous/);
  const rejection = options => new Promise(resolve => agent.createConnection(options, error => resolve(error)));
  assert.match((await rejection({ proxy: 'http://proxy.test', host: 'localhost', port: 80 })).message, /owning proxy agent/);
  assert.match((await rejection({ socketPath: '/tmp/no-socket' })).message, /Direct agents/);
  assert.match((await rejection({ path: '/tmp/no-socket' })).message, /Direct agents/);
  agent.destroy();
});

contract('Node http.Agent lifecycle', 'destroy during direct createConnection handoff closes the selected socket', async t => {
  const { port, sockets } = await listen(t, net.createServer(socket => socket.end()));
  let agent;
  agent = createHttpAgent({ connection: { onDiagnostic: event => { if (event.type === 'selection') agent.destroy(); } } });
  const error = await new Promise(resolve => agent.createConnection({ host: '127.0.0.1', port }, value => resolve(value)));
  assert.equal(error.code, 'ABORT_ERR');
  await delay(10); assert.equal(sockets.size, 0);
});

contract('Node https.Agent TLS session API', 'bounded native session cache evicts older origin entries', async t => {
  const c = certs();
  const { port } = await listen(t, https.createServer({ ...c, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' }, (_req, res) => res.end('ok')));
  const agent = createHttpsAgent({ ca: c.ca, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2', maxCachedSessions: 1,
    connection: { resolver: localResolver } });
  t.after(() => agent.destroy());
  const open = host => response(`https://${host}:${port}/`, { agent });
  assert.equal((await open('localhost')).resumed, false);
  assert.equal((await open('127.0.0.1')).resumed, false);
  assert.equal((await open('localhost')).resumed, false);
});

contract('Node https.Agent TLS policy API', 'object TLS policies are keyed per agent and zero capacity disables resumption', async t => {
  const c = certs();
  const { port } = await listen(t, https.createServer({ ...c, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' }, (_req, res) => res.end('ok')));
  const verifier = (name, certificate) => tls.checkServerIdentity(name, certificate);
  const context = tls.createSecureContext({ ca: c.ca });
  const options = { keepAlive: false, connection: { resolver: localResolver,
    tls: { ca: c.ca, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2', checkServerIdentity: verifier, secureContext: context } } };
  const agent = createHttpsAgent(options), noCache = createHttpsAgent({ ...options, maxCachedSessions: 0 });
  t.after(() => { agent.destroy(); noCache.destroy(); });
  const url = `https://localhost:${port}/`;
  assert.equal((await response(url, { agent })).resumed, false);
  assert.equal((await response(url, { agent })).resumed, true);
  assert.equal((await response(url, { agent: noCache })).resumed, false);
  assert.equal((await response(url, { agent: noCache })).resumed, false);
});

contract('Node http.Agent createConnection API', 'default hostname and protocol ports are resolved locally', async t => {
  const { port } = await listen(t, net.createServer(socket => socket.end()));
  const agent = createHttpAgent({ connection: { resolver: localResolver } }); t.after(() => agent.destroy());
  const socket = await new Promise((resolve, reject) => agent.createConnection({ port }, (error, value) => error ? reject(error) : resolve(value)));
  socket.destroy();
  for (const create of [createHttpAgent, createHttpsAgent]) {
    const controller = new AbortController(); controller.abort();
    const aborted = create({ connection: { signal: controller.signal } });
    const error = await new Promise(resolve => aborted.createConnection({ hostname: 'localhost' }, value => resolve(value)));
    assert.equal(error.code, 'ABORT_ERR'); aborted.destroy();
  }
});

contract('Node ClientRequest method ownership', 'borrowed destroy only destroys its receiver', async t => {
  const { port } = await listen(t, http.createServer((_req, res) => res.end('ok')));
  let signal;
  const agent = createHttpAgent({ connection: { resolver: (request) => { signal = request.signal; } } });
  t.after(() => agent.destroy());
  const owner = http.get('http://example.test/', { agent }); owner.on('error', () => {});
  const other = http.get(`http://127.0.0.1:${port}/`, { agent: false }); other.on('error', () => {});
  const closedOther = new Promise(resolve => other.once('close', resolve));
  owner.destroy.call(other);
  await closedOther;
  assert.equal(signal.aborted, false);
  const closedOwner = new Promise(resolve => owner.once('close', resolve)); owner.destroy(); await closedOwner;
});

contract('Node http.Agent lifecycle', 'abort queued at selection prevents late request handoff', async t => {
  let requests = 0;
  const { port } = await listen(t, http.createServer((_req, res) => { requests++; res.end(); }));
  let request;
  const agent = createHttpAgent({ connection: { onDiagnostic: event => {
    if (event.type === 'selection') queueMicrotask(() => request.destroy());
  } } }); t.after(() => agent.destroy());
  request = http.get(`http://127.0.0.1:${port}/`, { agent }); request.on('error', () => {});
  await new Promise(resolve => request.once('close', resolve));
  assert.equal(requests, 0);
});

contract('Node http.Agent createConnection and destroy APIs', 'destroy cancels direct connections during DNS and rejects later calls', async () => {
  let signal, calls = 0;
  const agent = createHttpAgent({ connection: { connectTimeoutMs: 100,
    resolver: request => { signal = request.signal; calls++; } } });
  const pending = new Promise(resolve => agent.createConnection({ host: 'pending.test', port: 80 }, resolve));
  agent.destroy();
  const cancelledImmediately = signal.aborted;
  const error = await pending;
  assert.equal(cancelledImmediately, true);
  assert.equal(error.code, 'ABORT_ERR');
  assert.equal(agent.totalSocketCount, 0);
  const later = await new Promise(resolve => agent.createConnection({ host: 'pending.test', port: 80 }, resolve));
  assert.equal(later.code, 'ABORT_ERR');
  assert.equal(calls, 1);
});

contract('Agent connection configuration API', 'agent snapshots connection settings at construction', async t => {
  const { port } = await listen(t, http.createServer((_req, res) => res.end('snapshot')));
  const connection = { resolver: localResolver };
  const agent = createHttpAgent({ connection }); t.after(() => agent.destroy());
  connection.resolver = () => { throw Error('mutated resolver'); };
  assert.equal((await response(`http://snapshot.test:${port}/`, { agent })).body, 'snapshot');
});
