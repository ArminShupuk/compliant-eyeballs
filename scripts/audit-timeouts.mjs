// Linux loopback only. A child temporarily pauses accept(), leaving a two-entry
// TCP listen queue full. No firewall, routes, system DNS or external hosts change.
import net from 'node:net';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connectTcp } from '../dist/esm/index.js';

if (process.argv[2] === '--listener') {
  const server = net.createServer(socket => socket.on('error', () => {}));
  server.listen({ host: '127.0.0.2', port: Number(process.argv[3]), backlog: 1 }, () => {
    process.send('ready');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.argv[4]));
  });
} else {
  if (process.platform !== 'linux') throw Error('The listen-queue fixture is verified on Linux only');
  const results = [];
  for (const scenario of ['stalled-first', 'slow-viable-first']) {
    for (const [implementation, attemptTimeoutMs, deadlineMs] of [
      ['node', 250, 4000], ['node', 1500, 4000], ['library', 250, 4000], ['library', 250, 20000],
    ]) {
      const live = net.createServer(socket => socket.on('error', () => {}));
      live.listen(0, '127.0.0.1'); await once(live, 'listening');
      const port = live.address().port;
      const child = fork(fileURLToPath(import.meta.url), ['--listener', String(port), scenario === 'slow-viable-first' ? '650' : '8000'], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      const fillers = [];
      let winner;
      try {
        await once(child, 'message');
        for (let i = 0; i < 2; i++) {
          const socket = net.connect(port, '127.0.0.2'); socket.on('error', () => {});
          fillers.push(socket); await once(socket, 'connect');
        }
        const addresses = ['127.0.0.2', scenario === 'stalled-first' ? '127.0.0.1' : '127.0.0.3'];
        const events = [];
        const started = performance.now();
        const record = { scenario, implementation, attemptTimeoutMs, deadlineMs, events };
        try {
          if (implementation === 'node') {
            winner = await new Promise((resolve, reject) => {
              const socket = net.connect({ host: 'timeout.test', port, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: attemptTimeoutMs,
                lookup: (_host, _options, callback) => callback(null, addresses.map(address => ({ address, family: 4 }))) });
              const timer = setTimeout(() => socket.destroy(Object.assign(Error('deadline'), { code: 'ETIMEDOUT' })), deadlineMs);
              socket.on('connectionAttempt', address => events.push({ type: 'attempt', address, elapsedMs: Math.round(performance.now() - started) }));
              socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
              socket.once('error', error => { clearTimeout(timer); reject(error); });
            });
          } else {
            winner = await connectTcp({ hostname: 'timeout.test', port, connectTimeoutMs: deadlineMs,
              resolver: (_request, update) => {
                update({ family: 6, addresses: [], complete: true });
                update({ family: 4, addresses, complete: true });
              }, onDiagnostic: event => { if (event.type === 'attempt') events.push({ type: 'attempt', address: event.candidate.address, elapsedMs: Math.round(event.elapsedMs) }); } });
          }
          record.remote = winner.remoteAddress;
          record.success = true;
        } catch (error) { record.success = false; record.error = error.code; }
        record.elapsedMs = Math.round(performance.now() - started);
        results.push(record); console.log(JSON.stringify(record));
      } finally {
        winner?.destroy(); for (const socket of fillers) socket.destroy();
        child.kill('SIGKILL'); await once(child, 'exit');
        await new Promise(resolve => live.close(resolve));
      }
    }
  }
  const report = { checked: new Date().toISOString(), node: process.versions.node, platform: process.platform,
    fixture: 'loopback listener backlog=1 with two filler connections; accept paused for 650ms (slow) or 8000ms (stalled)', results };
  writeFileSync(process.env.EYEBALLS_TIMEOUT_REPORT ?? 'docs/audits/timeout-results.json', JSON.stringify(report, null, 2) + '\n');
  const expected = results.every(r => r.success === !(r.scenario === 'slow-viable-first' && r.implementation === 'node' && r.attemptTimeoutMs === 250));
  if (!expected) throw Error('Fixture did not reproduce the expected connection outcomes; inspect results before citing them');
}
