import { contract } from './classification.mjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import tls from 'node:tls';

contract('Node TLS session event and Undici Connector APIs', 'tickets before TLS readiness, cache eviction and handoff cancellation', async () => {
  const original = tls.connect, calls = [], sockets = [];
  class Socket extends EventEmitter {
    authorized = true;
    destroyed = false;
    setTimeout() { return this; }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } return this; }
  }
  tls.connect = options => {
    calls.push(options);
    const socket = new Socket(); sockets.push(socket);
    process.nextTick(() => { socket.emit('session', Buffer.from('ticket')); socket.emit('secureConnect'); });
    return socket;
  };
  syncBuiltinESMExports();
  try {
    const { createUndiciConnector } = await import('../dist/esm/undici.js');
    const resolver = (_request, update) => {
      update({ family: 6, addresses: [], complete: true });
      update({ family: 4, addresses: ['127.0.0.1'], complete: true });
    };
    const open = (connector, hostname) => new Promise((resolve, reject) => connector({ hostname, port: '443', protocol: 'https:' },
      (error, socket) => error ? reject(error) : resolve(socket)));
    const connector = createUndiciConnector({ resolver, maxCachedSessions: 1 });
    (await open(connector, 'one.test')).destroy();
    assert.equal(calls[0].session, undefined);
    (await open(connector, 'one.test')).destroy();
    assert.deepEqual(calls[1].session, Buffer.from('ticket'));
    (await open(connector, 'two.test')).destroy();
    (await open(connector, 'one.test')).destroy();
    assert.equal(calls[3].session, undefined);
    connector.destroy();

    const noCache = createUndiciConnector({ resolver, maxCachedSessions: 0 });
    (await open(noCache, 'one.test')).destroy();
    (await open(noCache, 'one.test')).destroy();
    assert.equal(calls[5].session, undefined);
    noCache.destroy();

    let cancelled;
    cancelled = createUndiciConnector({ resolver, onDiagnostic: event => {
      if (event.type === 'selection') queueMicrotask(() => cancelled.destroy('during handoff'));
    } });
    const error = await new Promise(resolve => cancelled({ hostname: 'one.test', port: '443', protocol: 'https:' }, value => resolve(value)));
    assert.equal(error.code, 'ABORT_ERR');
    assert.equal(sockets.at(-1).destroyed, true);

    const controller = new AbortController();
    const pending = createUndiciConnector({ signal: controller.signal, resolver: () => {} });
    const stopped = new Promise(resolve => pending({ hostname: 'one.test', port: '443', protocol: 'http:' }, value => resolve(value)));
    controller.abort('factory stopped');
    assert.equal((await stopped).cause, 'factory stopped');
    pending.destroy();
  } finally {
    tls.connect = original;
    syncBuiltinESMExports();
  }
});
