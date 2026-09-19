import net from 'node:net';
import tls from 'node:tls';

const [host, portText, mode, timeoutText] = process.argv.slice(2);
const port = Number(portText), timeout = Number(timeoutText);
const addresses = mode === 'mixed' ? [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }]
  : mode === 'late6' ? [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }]
  : [{ address: '127.0.0.2', family: 4 }, { address: '127.0.0.1', family: 4 }];
const lookup = (_name, _options, callback) => callback(null, addresses);
const started = performance.now();
const secure = mode === 'tls' || mode === 'tls-slow';
const socket = (secure ? tls : net).connect({ host, port, lookup,
  autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 50, rejectUnauthorized: false });
socket.setTimeout(timeout, () => socket.destroy(Object.assign(new Error('deadline'), { code: 'ETIMEDOUT' })));
socket.once(secure ? 'secureConnect' : 'connect', () => {
  console.log(JSON.stringify({ remote: socket.remoteAddress, attempted: socket.autoSelectFamilyAttemptedAddresses,
    elapsedMs: Math.round(performance.now() - started) }));
  socket.end();
});
socket.once('error', error => {
  console.log(JSON.stringify({ error: error.code ?? error.message, attempted: socket.autoSelectFamilyAttemptedAddresses,
    elapsedMs: Math.round(performance.now() - started) }));
  process.exitCode = 2;
});
