import { rfc, contract } from './classification.mjs';
import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { race } from '../dist/esm/race.js';
import { createSystemResolver } from '../dist/esm/resolver.js';

class Clock {
  value = 0; id = 0; jobs = new Map();
  now = () => this.value;
  set = (fn, ms) => { const id = ++this.id; this.jobs.set(id, { fn, at: this.value + ms }); return id; };
  clear = id => this.jobs.delete(id);
  tick(ms) {
    const end = this.value + ms;
    for (let count = 0; count < 10000; count++) {
      const job = [...this.jobs.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!job || job[1].at > end) { this.value = end; return; }
      this.jobs.delete(job[0]); this.value = Math.max(this.value, job[1].at); job[1].fn();
    }
    throw new Error('Scheduler did not make progress');
  }
}
class Socket extends EventEmitter {
  destroyed = false;
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } return this; }
  setTimeout(ms) { this.timeout = ms; return this; }
}
const v6 = ['::1', '::2', '::3'];
const v4 = ['127.0.0.1', '127.0.0.2', '127.0.0.3'];
function setup(options = {}, factory) {
  const time = new Clock(), starts = [], sockets = [], events = [], controller = new AbortController();
  let publish, resolverSignal, unsubscribed = 0;
  const promise = race({ hostname: 'example.test', port: 443, connectTimeoutMs: 1000,
    signal: controller.signal, onDiagnostic: e => events.push(e),
    resolver: (request, update) => { publish = update; resolverSignal = request.signal; return () => unsubscribed++; }, ...options,
  }, candidate => {
    starts.push([time.now(), candidate.address]);
    const socket = factory?.(candidate, starts.length) ?? new Socket(); sockets.push(socket); return socket;
  }, 'connect', time);
  promise.catch(() => {});
  return { time, starts, sockets, events, controller, promise,
    update: (family, addresses, complete = true, error) => publish({ family, addresses, complete, error }),
    get unsubscribed() { return unsubscribed; }, get resolverSignal() { return resolverSignal; },
  };
}
rfc('3', 'IPv6 proceeds without waiting for IPv4; active slow attempt survives fallback', async () => {
  const s = setup(); s.update(6, v6); s.update(4, v4);
  assert.deepEqual(s.starts, [[0, '::1']]); s.time.tick(250);
  assert.equal(s.sockets[0].destroyed, false); assert.deepEqual(s.starts[1], [250, '127.0.0.1']);
  s.time.tick(50); s.sockets[0].emit('connect'); assert.equal(await s.promise, s.sockets[0]);
  assert.equal(s.sockets[1].destroyed, true); assert.equal(s.time.jobs.size, 0);
  assert.equal(s.unsubscribed, 1); assert.equal(s.resolverSignal.aborted, true);
  assert.equal(getEventListeners(s.controller.signal, 'abort').length, 0);
  for (const socket of s.sockets) assert.equal(socket.eventNames().length, 0);
});
for (const delay of [0, 49, 50, 51]) rfc('3', `IPv4-first resolution boundary ${delay}ms retains late IPv6`, async () => {
  const s = setup(); s.update(4, v4); s.time.tick(delay); s.update(6, v6);
  assert.equal(s.starts[0][1], delay < 50 ? '::1' : '127.0.0.1');
  s.time.tick(250); assert.equal(s.starts[1][1], delay < 50 ? '127.0.0.1' : '::1');
  s.sockets[1].emit('connect'); await s.promise;
});
rfc('3', 'definitive empty AAAA ends the resolution window early; errors retained', async () => {
  const s = setup(); s.update(4, [v4[0]]); s.time.tick(3);
  const cause = Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' });
  s.update(6, [], true, cause); assert.deepEqual(s.starts, [[3, v4[0]]]);
  s.sockets[0].emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
  await assert.rejects(s.promise, e => e.errors[0] === cause && e.errors[1].address === v4[0] && e.errors[1].code === 'ECONNREFUSED');
  assert.equal(s.time.jobs.size, 0);
});
rfc('3', 'empty results exhaust only when both families complete', async () => {
  const s = setup(); s.update(6, []); assert.equal(s.time.jobs.size, 1); s.update(4, []);
  await assert.rejects(s.promise, { code: 'ENOTFOUND' });
});
rfc('4', 'same-family candidates, canonical duplicates and first-address count', async () => {
  const s = setup({ firstAddressFamilyCount: 2 });
  s.update(6, ['::1', '0:0:0:0:0:0:0:1', '::2', '::3']); s.update(4, [v4[0], v4[0]]);
  s.time.tick(750); assert.deepEqual(s.starts.map(x => x[1]), ['::1', '::2', v4[0], '::3']);
  s.sockets[3].emit('connect'); await s.promise;
});
rfc('6', 'candidate updates remove queued addresses without cancelling active sockets', async () => {
  const s = setup(); s.update(6, v6, false); s.update(4, [], false);
  s.update(6, ['::3', '::4'], true); s.update(4, [v4[0]], true);
  s.time.tick(500); assert.deepEqual(s.starts.map(x => x[1]), ['::1', v4[0], '::3']);
  assert.equal(s.sockets[0].destroyed, false); s.sockets[0].emit('connect'); await s.promise;
});
for (const minAttemptDelayMs of [undefined, 10]) for (const synchronous of [true, false]) rfc('5', `hard failure spacing (${synchronous ? 'synchronous' : 'asynchronous'}, ${minAttemptDelayMs === undefined ? 'default 100ms' : 'explicit 10ms'} minimum)`, async () => {
  const spacing = minAttemptDelayMs ?? 100;
  const s = setup(minAttemptDelayMs === undefined ? {} : { minAttemptDelayMs }, () => { if (synchronous) throw new Error('failed immediately'); });
  s.update(6, v6); s.update(4, []);
  if (!synchronous) s.sockets[0].emit('error', new Error('failed asynchronously'));
  s.time.tick(spacing - 1); assert.equal(s.starts.length, 1); s.time.tick(1); assert.equal(s.starts.length, 2);
  if (!synchronous) s.sockets[1].emit('error', new Error('failed asynchronously'));
  s.time.tick(spacing); if (!synchronous) s.sockets[2].emit('error', new Error('failed asynchronously'));
  await assert.rejects(s.promise, e => e.errors.length === 3 && e.code === 'ECONNFAILED');
  assert.deepEqual(s.starts.map(x => x[0]), [0, spacing, spacing * 2]);
});
rfc('5', 'delayed event loop execution measures spacing from actual launch', async () => {
  const s = setup(); s.update(6, v6); s.update(4, v4);
  s.time.value = 700; s.time.tick(0);
  assert.deepEqual(s.starts.map(x => x[0]), [0, 700]); s.time.tick(249); assert.equal(s.starts.length, 2);
  s.time.tick(1); assert.equal(s.starts[2][0], 950); s.sockets[0].emit('connect'); await s.promise;
});

rfc('5', 'a larger overall deadline leaves fallback spacing unchanged and keeps a slow earlier attempt viable', async () => {
  for (const connectTimeoutMs of [2000, 20000]) {
    const s = setup({ connectTimeoutMs }); s.update(6, [v6[0]]); s.update(4, [v4[0]]);
    s.time.tick(250);
    assert.deepEqual(s.starts, [[0, v6[0]], [250, v4[0]]]);
    s.sockets[1].emit('error', Error('fallback refused'));
    s.time.tick(1000);
    assert.equal(s.sockets[0].destroyed, false);
    s.sockets[0].emit('connect');
    assert.equal(await s.promise, s.sockets[0]);
  }
});
contract('Node net API and library lifecycle', 'deadline wins at boundary even if timer execution is late', async () => {
  const s = setup(); s.update(6, v6); s.time.value = 1000; s.sockets[0].emit('connect');
  await assert.rejects(s.promise, { code: 'ETIMEDOUT' }); assert.ok(s.sockets.every(x => x.destroyed));
  assert.equal(s.time.jobs.size, 0);
});
contract('Node net API and library lifecycle', 'abort before/during resolution ignores late answers and removes timers', async () => {
  const early = new AbortController(); early.abort();
  const a = setup({ signal: early.signal }); await assert.rejects(a.promise, { code: 'ABORT_ERR' }); assert.equal(a.starts.length, 0);
  const b = setup(); b.controller.abort(); b.update(6, v6); b.time.tick(2000);
  await assert.rejects(b.promise, { code: 'ABORT_ERR' }); assert.equal(b.starts.length, 0); assert.equal(b.time.jobs.size, 0);
});
contract('Node net API and library lifecycle', 'abort while connecting destroys all candidates, and late winners stay destroyed', async () => {
  const s = setup(); s.update(6, v6); s.time.tick(500); s.controller.abort();
  await assert.rejects(s.promise, { code: 'ABORT_ERR' });
  s.sockets.forEach(x => { x.emit('connect'); assert.equal(x.destroyed, true); assert.equal(x.eventNames().length, 0); });
});
rfc('5', 'near-simultaneous winners select exactly one; post-handoff abort does not close it', async () => {
  const s = setup(); s.update(6, v6); s.time.tick(250);
  s.sockets[1].emit('connect'); s.sockets[0].emit('connect'); s.controller.abort();
  assert.equal(await s.promise, s.sockets[1]); assert.equal(s.sockets[1].destroyed, false); assert.equal(s.sockets[0].destroyed, true);
});
contract('Node net API and library lifecycle', 'selection observer abort at handoff destroys the selected socket', async () => {
  const controller = new AbortController();
  const s = setup({ signal: controller.signal, onDiagnostic: e => { if (e.type === 'selection') controller.abort(); } });
  s.update(6, v6); s.sockets[0].emit('connect'); await assert.rejects(s.promise, { code: 'ABORT_ERR' });
  assert.equal(s.sockets[0].destroyed, true);
});
contract('Node net API and library lifecycle', 'family and local binding constrain resolution; literals bypass the resolver', async () => {
  let called = false;
  const p = race({ hostname: '127.0.0.1', port: 1, family: 6, resolver: () => { called = true; } }, () => new Socket(), 'connect', new Clock());
  await assert.rejects(p, { code: 'ENOTFOUND' }); assert.equal(called, false);
  await assert.rejects(race({ hostname: 'a', port: 1, family: 6, localAddress: '127.0.0.1' }, () => new Socket(), 'connect'), /conflicts/);
});
rfc('3', 'system resolver launches both jobs immediately and ignores callbacks after cancellation', () => {
  const calls = [], updates = [], controller = new AbortController();
  const resolver = createSystemResolver((host, options, callback) => calls.push({ host, options, callback }));
  resolver({ hostname: 'example.test', families: [6, 4], signal: controller.signal }, u => updates.push(u));
  assert.deepEqual(calls.map(x => x.options.family), [6, 4]);
  assert.ok(calls.every(x => x.options.all && x.options.verbatim));
  calls[1].callback(null, [{ address: v4[0], family: 4 }]); assert.equal(updates.length, 1);
  controller.abort(); calls[0].callback(null, [{ address: v6[0], family: 6 }]); assert.equal(updates.length, 1);
});
for (const options of [
  { resolutionDelayMs: -1 }, { attemptDelayMs: NaN }, { attemptDelayMs: 9 }, { attemptDelayMs: 2001 },
  { minAttemptDelayMs: 9 }, { maxAttemptDelayMs: Infinity }, { maxAttemptDelayMs: 9 },
  { firstAddressFamilyCount: 0 }, { firstAddressFamilyCount: 1.5 }, { connectTimeoutMs: 0 },
  { connectTimeoutMs: 2 ** 31 }, { resolutionDelayMs: Infinity }, { preferredFamily: 4 }, { defaultFamily: 6 },
  { port: 0 }, { localPort: -1 }, { family: 5 }, { socketTimeoutMs: -1 },
]) contract('Node net API and library lifecycle', `reject invalid configuration ${JSON.stringify(options)}`, async () => {
  await assert.rejects(setup(options).promise, e => e instanceof RangeError || e instanceof TypeError);
});
rfc('8', 'recommendations do not impose invented upper limits', async () => {
  const s = setup({ minAttemptDelayMs: 100, maxAttemptDelayMs: 10000, attemptDelayMs: 3000, resolutionDelayMs: 2 ** 32 });
  s.update(6, v6); s.sockets[0].emit('connect'); await s.promise;
});

contract('Resolver subscription lifecycle API', 'a synchronously complete resolver releases its subscription', async () => {
  let released = 0;
  const promise = race({ hostname: 'sync.test', port: 443, resolver: (_request, update) => {
    update({ family: 6, addresses: [], complete: true });
    update({ family: 4, addresses: [], complete: true });
    return () => { released++; throw Error('late cleanup failure'); };
  } }, () => new Socket(), 'connect', new Clock());
  await assert.rejects(promise, { code: 'ENOTFOUND' });
  assert.equal(released, 1);
});

contract('Resolver callback and diagnostic observer APIs', 'resolver and observer failures preserve settlement and cleanup', async () => {
  await assert.rejects(race({ hostname: 'throw.test', port: 443, resolver: () => { throw 'resolver failed'; } },
    () => new Socket(), 'connect', new Clock()), /resolver failed/);
  const s = setup({ onDiagnostic: () => { throw Error('observer failed'); },
    resolver: (_request, update) => { update({ family: 6, addresses: ['::1'], complete: true });
      update({ family: 4, addresses: [], complete: true });
      return () => { throw Error('unsubscribe failed'); }; } });
  s.sockets[0].emit('connect');
  assert.equal(await s.promise, s.sockets[0]);
});

contract('AbortSignal and Node Socket APIs', 'synchronous abort during a candidate hook destroys the new socket', async () => {
  let s;
  s = setup({}, () => { s.controller.abort(); return new Socket(); });
  s.update(6, ['::1']);
  await assert.rejects(s.promise, { code: 'ABORT_ERR' });
  assert.equal(s.sockets[0].destroyed, true);
  assert.doesNotThrow(() => s.sockets[0].emit('error', Error('queued after abort')));
  assert.equal(s.time.jobs.size, 0);
});

contract('AbortSignal and diagnostic observer APIs', 'attempt observer abort prevents socket creation', async () => {
  const controller = new AbortController();
  const s = setup({ signal: controller.signal, onDiagnostic: event => {
    if (event.type === 'attempt') controller.abort();
  } });
  s.update(6, ['::1']);
  await assert.rejects(s.promise, { code: 'ABORT_ERR' });
  assert.equal(s.sockets.length, 0);
});

contract('Resolver input validation API', 'invalid addresses are ignored before candidate scheduling', async () => {
  const s = setup();
  s.update(6, ['127.0.0.1', 'not-an-address', '::1']); s.update(4, []);
  assert.deepEqual(s.starts, [[0, '::1']]);
  s.sockets[0].emit('connect'); await s.promise;
});

contract('Node Socket close and error APIs', 'closed-before-ready and already-destroyed sockets count as failed attempts', async () => {
  const first = setup(); first.update(6, ['::1']); first.update(4, []);
  first.sockets[0].emit('close');
  await assert.rejects(first.promise, { code: 'ECONNFAILED' });
  const second = setup({}, () => { const socket = new Socket(); socket.destroyed = true; return socket; });
  second.update(6, ['::1']); second.update(4, []);
  await assert.rejects(second.promise, { code: 'ECONNFAILED' });
});

rfc('5', 'callbacks queued before winner cleanup cannot replace the winner', async () => {
  const s = setup(); s.update(6, ['::1', '::2']); s.update(4, []); s.time.tick(250);
  const staleSuccess = s.sockets[1].listeners('connect')[0];
  const staleFailure = s.sockets[1].listeners('error')[0];
  s.sockets[0].emit('connect');
  staleSuccess(); staleFailure(new Error('late failure'));
  assert.equal(await s.promise, s.sockets[0]);
  assert.equal(s.sockets[1].destroyed, true);
});

contract('Node dns.lookup callback API', 'system resolver accepts string answers, lookup errors and thrown lookups', () => {
  const updates = [], controller = new AbortController();
  createSystemResolver((_host, options, callback) => {
    if (options.family === 6) callback(null, '::1');
    else callback(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));
  })({ hostname: 'example.test', families: [6, 4], signal: controller.signal }, value => updates.push(value));
  assert.deepEqual(updates[0].addresses, ['::1']);
  assert.equal(updates[1].error.code, 'ENOTFOUND');
  const thrown = [];
  createSystemResolver(() => { throw 'lookup threw'; })({ hostname: 'example.test', families: [6], signal: controller.signal }, value => thrown.push(value));
  assert.match(thrown[0].error.message, /lookup threw/);
});

contract('Resolver cancellation API', 'system resolver stops launching jobs after a synchronous cancellation', () => {
  const controller = new AbortController(), calls = [];
  createSystemResolver((_host, options) => { calls.push(options.family); controller.abort(); })
    ({ hostname: 'example.test', families: [6, 4], signal: controller.signal }, () => {});
  assert.deepEqual(calls, [6]);
});

contract('Node Socket error and close APIs', 'queued errors on a losing socket are suppressed until close', async () => {
  const s = setup({}, (_candidate, count) => {
    const socket = new Socket();
    if (count === 2) socket.destroy = function () { this.destroyed = true; return this; };
    return socket;
  });
  s.update(6, ['::1', '::2']); s.update(4, []); s.time.tick(250);
  s.sockets[0].emit('connect');
  assert.doesNotThrow(() => s.sockets[1].emit('error', Error('queued loser error')));
  s.sockets[1].emit('close');
  assert.equal(await s.promise, s.sockets[0]);
});

contract('Resolver callback lifecycle API', 'late resolver exceptions cannot replace an already settled result', async () => {
  const promise = race({ hostname: 'example.test', port: 443, resolver: (_request, update) => {
    update({ family: 6, addresses: [], complete: true });
    update({ family: 4, addresses: [], complete: true });
    throw Error('after completion');
  } }, () => new Socket(), 'connect', new Clock());
  await assert.rejects(promise, { code: 'ENOTFOUND' });
});
