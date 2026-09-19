import { rfc, contract } from './classification.mjs';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import http2 from 'node:http2';
import { once } from 'node:events';
import { connectTcp, connectTls } from '../dist/esm/index.js';
import { tcp } from '../dist/esm/connect.js';
import { createUndiciConnector } from '../dist/esm/undici.js';
import { certs, listen, localResolver, delay } from './helpers.mjs';

contract('Node net/tls and Undici connector APIs', 'TCP literal and OS localhost lookup connect with local binding', async t => {
  const { port } = await listen(t, net.createServer(socket => socket.end('hello')));
  for (const hostname of ['127.0.0.1', 'localhost']) {
    const socket = await connectTcp({ hostname, port, localAddress: '127.0.0.1' });
    assert.equal(socket.localAddress, '127.0.0.1');
    let data = ''; for await (const chunk of socket) data += chunk; assert.equal(data, 'hello');
  }
});
contract('Node net/tls and Undici connector APIs', 'caller block list is honored even on the minimum Node version', async t => {
  let connections = 0;
  const { port } = await listen(t, net.createServer(() => connections++));
  const blockList = new net.BlockList(); blockList.addAddress('127.0.0.1');
  await assert.rejects(connectTcp({ hostname: '127.0.0.1', port, blockList }), e => e.errors[0].code === 'ERR_IP_BLOCKED');
  assert.equal(connections, 0);
});
contract('Node net/tls and Undici connector APIs', 'DNS and IP TLS identities, custom trust, SNI and ALPN', async t => {
  const c = certs(), names = [];
  const server = tls.createServer({ ...c, ALPNProtocols: ['h2', 'http/1.1'] }, socket => { names.push(socket.servername); socket.end(); });
  const { port } = await listen(t, server);
  for (const hostname of ['localhost', '127.0.0.1']) {
    const socket = await connectTls({ hostname, port, resolver: localResolver, tls: { ca: c.ca, ALPNProtocols: ['h2'] } });
    assert.equal(socket.authorized, true); assert.equal(socket.alpnProtocol, 'h2'); await once(socket, 'close');
  }
  assert.deepEqual(names, ['localhost', false]);
});
contract('Node net/tls and Undici connector APIs', 'IP certificate mismatch is rejected, even with explicit DNS SNI', async t => {
  const c = certs(); const server = tls.createServer(c.dns, s => s.end()); server.on('tlsClientError', () => {});
  const { port } = await listen(t, server);
  for (const servername of [undefined, 'localhost']) {
    await assert.rejects(connectTls({ hostname: '127.0.0.1', port, tls: { ca: c.ca, servername } }), e => e.errors[0].code === 'ERR_TLS_CERT_ALTNAME_INVALID');
  }
});
contract('Node net/tls and Undici connector APIs', 'DNS mismatch and untrusted issuer are rejected; custom verifier sees original hostname', async t => {
  const c = certs(), server = tls.createServer(c, s => s.end()); server.on('tlsClientError', () => {});
  const { port } = await listen(t, server);
  await assert.rejects(connectTls({ hostname: 'wrong.test', port, resolver: localResolver, tls: { ca: c.ca } }), e => e.errors[0].code === 'ERR_TLS_CERT_ALTNAME_INVALID');
  await assert.rejects(connectTls({ hostname: 'localhost', port, resolver: localResolver }), e => e.errors.length === 1);
  let checked;
  const socket = await connectTls({ hostname: 'localhost', port, resolver: localResolver, tls: { ca: c.ca, servername: '', checkServerIdentity: (name, cert) => { checked = name; return tls.checkServerIdentity(name, cert); } } });
  socket.destroy(); assert.equal(checked, 'localhost');
});
contract('Node net/tls and Undici connector APIs', 'client certificates are preserved', async t => {
  const c = certs(); let peer;
  const server = tls.createServer({ ...c, requestCert: true, rejectUnauthorized: true }, s => { peer = s.getPeerCertificate().subject.CN; s.end(); });
  const { port } = await listen(t, server);
  const socket = await connectTls({ hostname: 'localhost', port, resolver: localResolver, tls: { ca: c.ca, ...c.client } });
  await once(socket, 'close'); assert.equal(peer, 'test-client');
});
contract('Node net/tls and Undici connector APIs', 'TLS handshake stall reaches overall deadline and abort closes the pending candidate', async t => {
  const { port, sockets } = await listen(t, net.createServer());
  await assert.rejects(connectTls({ hostname: '127.0.0.1', port, connectTimeoutMs: 50 }), { code: 'ETIMEDOUT' });
  const controller = new AbortController();
  const promise = connectTls({ hostname: '127.0.0.1', port, signal: controller.signal });
  await delay(20); controller.abort(); await assert.rejects(promise, { code: 'ABORT_ERR' });
  for (const socket of sockets) socket.resume(); await delay(20); assert.equal(sockets.size, 0);
});
contract('Node TLS readiness and RFC 8305 §5 attempt liveness', 'slow viable TLS survives a later failed address', async t => {
  const c = certs(); const tlsServer = tls.createServer(c, s => s.end());
  const timers = new Set(); t.after(() => timers.forEach(clearTimeout));
  const front = net.createServer(socket => { const timer = setTimeout(() => { timers.delete(timer); tlsServer.emit('connection', socket); }, 120); timers.add(timer); });
  const { port } = await listen(t, front);
  const starts = [];
  const socket = await connectTls({ hostname: 'localhost', port, attemptDelayMs: 20, minAttemptDelayMs: 10, connectTimeoutMs: 1500,
    tls: { ca: c.ca }, onDiagnostic: e => { if (e.type === 'attempt') starts.push(e.candidate.address); },
    resolver: (_r, update) => { update({ family: 6, addresses: [], complete: true }); update({ family: 4, addresses: ['127.0.0.1', '127.0.0.2'], complete: true }); },
  });
  assert.deepEqual(starts, ['127.0.0.1', '127.0.0.2']); socket.destroy();
});
contract('Node TLS readiness and RFC 8305 §5 winner cleanup', 'faster TLS candidate wins and closes a slow viable TLS connection', async t => {
  const c = certs();
  const fast = tls.createServer(c, socket => socket.end());
  const { port } = await listen(t, fast, '127.0.0.1');
  const delayed = tls.createServer(c, socket => socket.end());
  const slow = net.createServer(socket => {
    const timer = setTimeout(() => delayed.emit('connection', socket), 300);
    socket.once('close', () => clearTimeout(timer));
  });
  const { sockets: slowSockets } = await listen(t, slow, '127.0.0.2', port);
  const attempts = [];
  const winner = await connectTls({ hostname: 'localhost', port, attemptDelayMs: 50, minAttemptDelayMs: 10,
    tls: { ca: c.ca }, onDiagnostic: event => { if (event.type === 'attempt') attempts.push(event.candidate.address); },
    resolver: (_request, update) => {
      update({ family: 6, addresses: [], complete: true });
      update({ family: 4, addresses: ['127.0.0.2', '127.0.0.1'], complete: true });
    },
  });
  assert.deepEqual(attempts, ['127.0.0.2', '127.0.0.1']);
  assert.equal(winner.remoteAddress, '127.0.0.1');
  assert.equal(slowSockets.size, 1);
  const closed = Promise.all([...slowSockets].map(socket => {
    socket.resume();
    return once(socket, 'close');
  }));
  winner.destroy();
  await Promise.race([closed, delay(500).then(() => { throw new Error('losing TLS socket remained open'); })]);
  assert.equal(slowSockets.size, 0);
});
contract('Node TLS readiness and RFC 8305 §5 attempt liveness', 'stalled IPv6 TLS falls back to IPv4 without waiting for the deadline', async t => {
  const c = certs(), starts = [];
  const tlsServer = tls.createServer(c, socket => socket.end());
  const server = net.createServer(socket => { if (socket.localAddress !== '::1') tlsServer.emit('connection', socket); });
  let fixture;
  try { fixture = await listen(t, server, '::'); } catch (e) { if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(e.code)) return t.skip('IPv6 loopback unavailable'); throw e; }
  const socket = await connectTls({ hostname: 'localhost', port: fixture.port, attemptDelayMs: 30, minAttemptDelayMs: 10, connectTimeoutMs: 2000, tls: { ca: c.ca },
    resolver: (_r, cb) => { cb({ family: 6, addresses: ['::1'], complete: true }); cb({ family: 4, addresses: ['127.0.0.1'], complete: true }); },
    onDiagnostic: e => { if (e.type === 'attempt') starts.push(e.candidate.family); },
  });
  assert.deepEqual(starts, [6, 4]); assert.equal(socket.remoteFamily, 'IPv4'); socket.destroy();
});
contract('Node net/tls and Undici connector APIs', 'native HTTP/2 multiplexes, streams, cancels and receives GOAWAY over connectTls', async t => {
  const c = certs(), server = http2.createSecureServer(c);
  let serverSession, streams = 0, maximum = 0;
  server.on('session', session => { serverSession = session; });
  server.on('stream', (stream, headers) => {
    maximum = Math.max(maximum, ++streams); stream.on('error', () => {}); stream.once('close', () => streams--);
    stream.respond();
    if (headers[':path'] === '/cancel') { stream.write('first'); return; }
    let body = ''; stream.on('data', chunk => body += chunk);
    stream.on('end', () => setTimeout(() => { if (!stream.destroyed) stream.end(body || 'h2'); }, 10));
  });
  const { port } = await listen(t, server);
  const socket = await connectTls({ hostname: 'localhost', port, resolver: localResolver, tls: { ca: c.ca, ALPNProtocols: ['h2'] } });
  const session = http2.connect(`https://localhost:${port}`, { createConnection: () => socket }); t.after(() => session.destroy());
  const request = async body => {
    const stream = session.request({ ':method': body ? 'POST' : 'GET' }); stream.end(body);
    let result = ''; for await (const chunk of stream) result += chunk; return result;
  };
  assert.deepEqual(await Promise.all([request(), request(), request('upload')]), ['h2', 'h2', 'upload']); assert.ok(maximum >= 2);
  const cancelled = session.request({ ':path': '/cancel' }); cancelled.end(); await once(cancelled, 'data');
  const closed = new Promise(resolve => cancelled.once('close', resolve)); cancelled.close(http2.constants.NGHTTP2_CANCEL); await closed;
  const goaway = once(session, 'goaway'); serverSession.goaway(); await goaway; session.close();
});
for (const version of ['TLSv1.2', 'TLSv1.3']) contract('Node net/tls and Undici connector APIs', `Undici connector isolated session caches and ${version} resumption`, async t => {
  const c = certs(); const server = tls.createServer({ ...c, minVersion: version, maxVersion: version }, s => { s.write('ticket trigger'); });
  const { port } = await listen(t, server);
  const config = { resolver: localResolver, tls: { ca: c.ca, minVersion: version, maxVersion: version } };
  const connector = createUndiciConnector(config); t.after(() => connector.destroy());
  const open = connector => new Promise((resolve, reject) => connector({ hostname: 'localhost', port: String(port), protocol: 'https:' }, (e, s) => e ? reject(e) : resolve(s)));
  const first = await open(connector); first.resume(); await delay(60); assert.equal(first.isSessionReused(), false); first.destroy();
  const second = await open(connector); assert.equal(second.isSessionReused(), true); second.destroy();
  const isolated = createUndiciConnector(config); t.after(() => isolated.destroy());
  const third = await open(isolated); assert.equal(third.isSessionReused(), false); third.destroy();
});
contract('Node net/tls and Undici connector APIs', 'connector cancellation, explicit fallback ownership and callback once', async () => {
  let update, calls = 0;
  const connector = createUndiciConnector({ resolver: (_r, cb) => { update = cb; } });
  const done = new Promise(resolve => connector({ hostname: 'example.test', port: '80', protocol: 'http:' }, (e, s) => { calls++; assert.equal(e.code, 'ABORT_ERR'); assert.equal(s, null); resolve(); }));
  connector.destroy(); update({ family: 4, addresses: ['127.0.0.1'], complete: true }); await done; assert.equal(calls, 1);
  const tunnel = new net.Socket();
  const fallback = createUndiciConnector({ fallbackConnector: (options, callback) => { assert.equal(options.httpSocket, tunnel); callback(null, tunnel); } });
  fallback({ hostname: 'a', protocol: 'https:', port: '443', httpSocket: tunnel }, (e, s) => assert.equal(s, tunnel));
  fallback.destroy(); assert.equal(tunnel.destroyed, false); tunnel.destroy();
  await new Promise(resolve => createUndiciConnector()({ hostname: 'a', protocol: 'https:', port: '443', httpSocket: tunnel }, e => { assert.match(e.message, /owning/); resolve(); }));
});
contract('Node net/tls and Undici connector APIs', 'proxy settings cannot silently turn direct TCP/TLS or Undici into a proxy route', async () => {
  let lookups = 0;
  const resolver = () => { lookups++; };
  await assert.rejects(connectTcp({ hostname: 'origin.test', port: 443, proxy: 'http://proxy.test', resolver }), /owning proxy agent/);
  await assert.rejects(connectTls({ hostname: 'origin.test', port: 443, resolver, tls: { proxy: 'http://proxy.test' } }), /owning proxy agent/);
  await assert.rejects(connectTcp({ hostname: 'origin.test', port: 443, httpSocket: {}, resolver }), /owning transport integration/);
  await assert.rejects(connectTls({ hostname: 'origin.test', port: 443, resolver, tls: { socket: {} } }), /owning transport integration/);
  assert.throws(() => createUndiciConnector({ proxyEnv: { HTTPS_PROXY: 'http://proxy.test' } }), /owning proxy agent/);
  assert.throws(() => createUndiciConnector({ tls: { proxy: 'http://proxy.test' } }), /owning proxy agent/);
  assert.throws(() => createUndiciConnector({ tls: { socket: {} } }), /owning transport integration/);
  const connector = createUndiciConnector({ resolver });
  await new Promise(resolve => connector({ hostname: 'origin.test', port: '443', protocol: 'https:', proxy: 'http://proxy.test' }, error => {
    assert.match(error.message, /owning proxy agent/); resolve();
  }));
  assert.equal(lookups, 0); connector.destroy();
});

contract('Connection options API', 'invalid destination and binding combinations reject before socket creation', async () => {
  const base = { hostname: '127.0.0.1', port: 443 };
  for (const change of [
    { hostname: '' }, { localAddress: 'not-an-ip' }, { localPort: 65536 },
    { socketTimeoutMs: 2 ** 31 }, { resolver: () => {}, lookup: () => {} },
  ]) await assert.rejects(connectTcp({ ...base, ...change }), e => e instanceof TypeError || e instanceof RangeError);
});

contract('Node net.Socket API', 'IPv6 block list and internal socket observer preserve candidate ownership', async t => {
  const blocked = new net.BlockList(); blocked.addAddress('::1', 'ipv6');
  await assert.rejects(connectTcp({ hostname: '::1', port: 12345, blockList: blocked }),
    error => error.errors[0].code === 'ERR_IP_BLOCKED');
  const { port } = await listen(t, net.createServer(socket => socket.end()));
  let observed;
  const socket = await tcp({ hostname: '127.0.0.1', port }, value => { observed = value; });
  assert.equal(socket, observed); socket.destroy();
});

contract('Undici Connector API', 'destroyed, pre-aborted and handoff-aborted connectors close their candidates', async t => {
  assert.throws(() => createUndiciConnector({ maxCachedSessions: -1 }), RangeError);
  const destroyed = createUndiciConnector(); destroyed.destroy();
  await new Promise(resolve => destroyed({ hostname: '127.0.0.1', port: '80', protocol: 'http:' }, error => {
    assert.equal(error.code, 'ABORT_ERR'); resolve();
  }));
  for (const protocol of ['http:', 'https:']) {
    const controller = new AbortController(); controller.abort('before connect');
    const connector = createUndiciConnector();
    await new Promise(resolve => connector({ hostname: '127.0.0.1', port: '', protocol, signal: controller.signal }, error => {
      assert.equal(error.code, 'ABORT_ERR'); resolve();
    }));
    connector.destroy();
  }
  const { port, sockets } = await listen(t, net.createServer());
  let connector;
  connector = createUndiciConnector({ onDiagnostic: event => { if (event.type === 'selection') connector.destroy(); } });
  await new Promise(resolve => connector({ hostname: '127.0.0.1', port: String(port), protocol: 'http:' }, (error, socket) => {
    assert.equal(error.code, 'ABORT_ERR'); assert.equal(socket, null); resolve();
  }));
  await delay(10); assert.equal(sockets.size, 0);
});

contract('Undici Connector API and Node TLS', 'default HTTP/2 ALPN and per-call cancellation work', async t => {
  const c = certs();
  const { port } = await listen(t, tls.createServer({ ...c, ALPNProtocols: ['h2', 'http/1.1'] }, socket => socket.end()));
  const connector = createUndiciConnector({ allowH2: true, resolver: localResolver, tls: { ca: c.ca } });
  t.after(() => connector.destroy());
  const socket = await new Promise((resolve, reject) => connector({ hostname: 'localhost', port: String(port), protocol: 'https:' },
    (error, value) => error ? reject(error) : resolve(value)));
  assert.equal(socket.alpnProtocol, 'h2'); socket.destroy();
  const controller = new AbortController();
  const waiting = createUndiciConnector({ resolver: () => {} });
  const result = new Promise(resolve => waiting({ hostname: 'example.test', port: '80', protocol: 'http:', signal: controller.signal },
    error => { assert.equal(error.code, 'ABORT_ERR'); resolve(); }));
  controller.abort(); await result; waiting.destroy();
});

contract('Undici connector configuration API', 'connector snapshots factory settings and removes the original abort listener', async t => {
  const { getEventListeners } = await import('node:events');
  const { port } = await listen(t, net.createServer(socket => socket.end()));
  const controller = new AbortController();
  const config = { resolver: localResolver, signal: controller.signal };
  const connector = createUndiciConnector(config); t.after(() => connector.destroy());
  config.resolver = () => { throw Error('mutated resolver'); };
  const socket = await new Promise((resolve, reject) => connector({ hostname: 'snapshot.test', port: String(port), protocol: 'http:' },
    (error, value) => error ? reject(error) : resolve(value)));
  socket.destroy();
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
