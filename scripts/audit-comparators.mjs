// Local loopback probes. Downloads, Chrome profiles and NetLogs stay outside
// the repository. Set AUDIT_CACHE, CURL_BIN, GO_BIN, NODE_BIN and CHROME_BIN.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dgram from 'node:dgram';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { certs } from '../test/helpers.mjs';

const cache = process.env.AUDIT_CACHE ?? join(homedir(), '.cache', 'compliant-eyeballs-audit');
const binaries = {
  curl: process.env.CURL_BIN ?? '/usr/bin/curl',
  installedCurl: process.env.INSTALLED_CURL_BIN ?? '/usr/bin/curl',
  go: process.env.GO_BIN ?? join(cache, 'go/go/bin/go'),
  node: process.env.NODE_BIN ?? process.execPath,
  nvmNode: process.env.NVM_NODE_BIN ?? process.execPath,
  chrome: process.env.CHROME_BIN ?? join(cache, 'chrome/chrome-linux64/chrome'),
};
mkdirSync(cache, { recursive: true });
const results = { date: new Date().toISOString(), platform: process.platform, binaries, probes: [] };
const sockets = new Set();
const servers = [];
async function listen(server, host, port = 0) {
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, host, resolve));
  servers.push(server);
  return server.address().port;
}
async function run(name, executable, args, timeoutMs = 5000) {
  const started = performance.now();
  const child = spawn(executable, args, { env: { ...process.env, ALL_PROXY: '', HTTPS_PROXY: '', HTTP_PROXY: '', NO_PROXY: '*' } });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  const status = await new Promise(resolve => {
    child.once('error', error => resolve({ code: null, signal: null, error: error.message }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  const result = { name, command: [executable, ...args], ...status, timedOut,
    elapsedMs: Math.round(performance.now() - started), stdout: stdout.trim().slice(0, 1600), stderr: stderr.trim().slice(-1600) };
  results.probes.push(result);
  return result;
}
async function runBrowser(name, map, port, tlsStall = false) {
  const profile = mkdtempSync(join(cache, `chrome-${name}-`));
  const log = join(cache, `chrome-${name}.netlog.json`);
  const host = 'chrome.he-audit.test';
  const url = `${tlsStall ? 'https' : 'http'}://${host}:${port}/`;
  const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-background-networking', '--disable-sync',
    '--disable-extensions', '--disable-component-update', '--no-proxy-server', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, `--host-resolver-rules=MAP ${host} ${map}, MAP * ~NOTFOUND`, `--log-net-log=${log}`,
    '--net-log-capture-mode=IncludeSensitive', '--remote-debugging-port=0', 'about:blank'];
  const started = performance.now();
  const child = spawn(binaries.chrome, args, { env: { ...process.env, ALL_PROXY: '', HTTPS_PROXY: '', HTTP_PROXY: '', NO_PROXY: '*' } });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  let stderr = '', ws;
  child.stderr.on('data', data => { stderr += data; });
  const result = { name: `chromium-${name}`, command: [binaries.chrome, ...args], code: null, timedOut: false, stderr: '' };
  const delayUntil = async (predicate, ms) => {
    const until = Date.now() + ms;
    while (!predicate()) { if (Date.now() > until) throw Error('DevTools startup timeout'); await new Promise(resolve => setTimeout(resolve, 50)); }
  };
  try {
    await delayUntil(() => existsSync(join(profile, 'DevToolsActivePort')), 4000);
    const [debugPort, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n');
    ws = new WebSocket(`ws://127.0.0.1:${debugPort}${path}`);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    const pending = new Map(), events = new Map();
    let id = 0;
    ws.addEventListener('message', message => {
      const packet = JSON.parse(message.data);
      if (packet.id && pending.has(packet.id)) { const done = pending.get(packet.id); pending.delete(packet.id); done(packet); }
      else if (packet.method && events.has(packet.method)) { const done = events.get(packet.method); events.delete(packet.method); done(packet); }
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const key = ++id;
      pending.set(key, packet => packet.error ? reject(Error(packet.error.message)) : resolve(packet.result));
      ws.send(JSON.stringify({ id: key, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const created = await send('Target.createTarget', { url: 'about:blank' });
    const attached = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
    await send('Page.enable', {}, attached.sessionId);
    const loaded = new Promise(resolve => events.set('Page.loadEventFired', resolve));
    if (tlsStall) {
      ws.send(JSON.stringify({ id: ++id, method: 'Page.navigate', params: { url }, sessionId: attached.sessionId }));
      await new Promise(resolve => setTimeout(resolve, 1000));
      result.pageText = 'stalled TLS navigation cancelled by Browser.close after 1000ms';
    } else {
      await send('Page.navigate', { url }, attached.sessionId);
      await Promise.race([loaded, new Promise((_, reject) => setTimeout(() => reject(Error('navigation timeout')), 4000))]);
      const evaluated = await send('Runtime.evaluate', { expression: 'document.body?.textContent ?? ""', returnByValue: true }, attached.sessionId);
      result.pageText = String(evaluated.result.value ?? '').slice(0, 200);
    }
    ws.send(JSON.stringify({ id: ++id, method: 'Browser.close' }));
    const status = await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(Error('browser close timeout')), 2000))]);
    Object.assign(result, status);
  } catch (error) {
    result.error = error.message;
    result.timedOut = true;
    child.kill('SIGTERM');
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 1000))]);
    child.kill('SIGKILL');
  } finally {
    ws?.close();
    result.stderr = stderr.trim().slice(-400);
    result.elapsedMs = Math.round(performance.now() - started);
    try {
      const netlog = JSON.parse(readFileSync(log, 'utf8'));
      const attempts = netlog.events.map(event => event.params?.address).filter(address => typeof address === 'string' && address.endsWith(`:${port}`));
      result.netlog = { eventCount: netlog.events.length, targetConnectAddresses: [...new Set(attempts)] };
    } catch (error) { result.netlogError = error.message; }
    rmSync(profile, { recursive: true, force: true });
    results.probes.push(result);
  }
  return result;
}
function dnsPacket(query) {
  let pos = 12;
  while (query[pos] && pos < query.length) pos += query[pos] + 1;
  const name = query.subarray(12, pos).toString('hex');
  const type = query.readUInt16BE(pos + 1);
  const question = query.subarray(12, pos + 5);
  const records = type === 28 && (name.includes(Buffer.from('mixed').toString('hex')) || name.includes(Buffer.from('late6').toString('hex')))
    ? [Buffer.from('00000000000000000000000000000001', 'hex')]
    : type === 1 ? ((name.includes(Buffer.from('mixed').toString('hex')) || name.includes(Buffer.from('late6').toString('hex'))) ? ['127.0.0.1'] : ['127.0.0.2', '127.0.0.1'])
      .map(ip => Buffer.from(ip.split('.').map(Number))) : [];
  const header = Buffer.alloc(12); query.copy(header, 0, 0, 2);
  header.writeUInt16BE(0x8180, 2); header.writeUInt16BE(1, 4); header.writeUInt16BE(records.length, 6);
  const answers = records.map(address => {
    const prefix = Buffer.alloc(12); prefix.writeUInt16BE(0xc00c, 0);
    prefix.writeUInt16BE(type, 2); prefix.writeUInt16BE(1, 4); prefix.writeUInt32BE(10, 6); prefix.writeUInt16BE(address.length, 10);
    return Buffer.concat([prefix, address]);
  });
  return Buffer.concat([header, question, ...answers]);
}
const dns = dgram.createSocket('udp4');
dns.on('message', (query, peer) => {
  try {
    const text = query.toString('latin1');
    let position = 12;
    while (query[position] && position < query.length) position += query[position] + 1;
    const slowAAAA = text.includes('late6') && query.readUInt16BE(position + 1) === 28;
    if (slowAAAA) setTimeout(() => dns.send(dnsPacket(query), peer.port, peer.address), 80);
    else dns.send(dnsPacket(query), peer.port, peer.address);
  } catch {}
});

try {
  const httpPort = await listen(http.createServer((_req, res) => res.end('ready')), '127.0.0.1');
  const { key, cert } = certs();
  const httpsPort = await listen(https.createServer({ key, cert }, (_req, res) => res.end('ready')), '127.0.0.1');
  await listen(net.createServer(() => {}), '127.0.0.2', httpsPort); // TCP works; TLS never starts.
  const slowTlsServer = https.createServer({ key, cert }, (_req, res) => res.end('ready'));
  const slowTlsPort = await listen(slowTlsServer, '127.0.0.1');
  await listen(net.createServer(socket => {
    const timer = setTimeout(() => slowTlsServer.emit('connection', socket), 300);
    socket.once('close', () => clearTimeout(timer));
  }), '127.0.0.2', slowTlsPort);
  await new Promise(resolve => dns.bind(0, '127.0.0.1', resolve));
  const dnsPort = String(dns.address().port);
  await run('build-go-probe', binaries.go, ['build', '-o', join(cache, 'audit-go'), 'scripts/audit-go.go'], 120000);
  for (const mode of ['mixed', 'same', 'late6']) {
    const host = `${mode}.he-audit.test`;
    const list = mode === 'mixed' ? '[::1],127.0.0.1' : mode === 'late6' ? '127.0.0.1,[::1]' : '127.0.0.2,127.0.0.1';
    await run(`curl-${mode}`, binaries.curl, ['--silent', '--show-error', '--noproxy', '*', '--verbose', '--max-time', '2', '--happy-eyeballs-timeout-ms', '50', '--resolve', `${host}:${httpPort}:${list}`, '--write-out', ' remote=%{remote_ip} connect=%{time_connect}', `http://${host}:${httpPort}/`]);
    await run(`curl-installed-${mode}`, binaries.installedCurl, ['--silent', '--show-error', '--noproxy', '*', '--verbose', '--max-time', '2', '--happy-eyeballs-timeout-ms', '50', '--resolve', `${host}:${httpPort}:${list}`, '--write-out', ' remote=%{remote_ip} connect=%{time_connect}', `http://${host}:${httpPort}/`]);
    await run(`go-${mode}`, join(cache, 'audit-go'), [host, String(httpPort), dnsPort, mode, '2000']);
    await run(`node-${mode}`, binaries.node, ['scripts/audit-node.mjs', host, String(httpPort), mode, '2000']);
    await run(`node-nvm-${mode}`, binaries.nvmNode, ['scripts/audit-node.mjs', host, String(httpPort), mode, '2000']);
  }
  const tlsHost = 'tls.he-audit.test';
  await run('curl-tls', binaries.curl, ['--silent', '--show-error', '--noproxy', '*', '--verbose', '--insecure', '--max-time', '1', '--resolve', `${tlsHost}:${httpsPort}:127.0.0.2,127.0.0.1`, `https://${tlsHost}:${httpsPort}/`], 3000);
  await run('curl-installed-tls', binaries.installedCurl, ['--silent', '--show-error', '--noproxy', '*', '--verbose', '--insecure', '--max-time', '1', '--resolve', `${tlsHost}:${httpsPort}:127.0.0.2,127.0.0.1`, `https://${tlsHost}:${httpsPort}/`], 3000);
  await run('go-tls', join(cache, 'audit-go'), [tlsHost, String(httpsPort), dnsPort, 'tls', '1000'], 3000);
  await run('node-tls', binaries.node, ['scripts/audit-node.mjs', tlsHost, String(httpsPort), 'tls', '1000'], 3000);
  await run('node-nvm-tls', binaries.nvmNode, ['scripts/audit-node.mjs', tlsHost, String(httpsPort), 'tls', '1000'], 3000);
  const slowTlsHost = 'slowtls.he-audit.test';
  await run('curl-tls-slow', binaries.curl, ['--silent', '--show-error', '--noproxy', '*', '--verbose', '--insecure', '--max-time', '2', '--resolve', `${slowTlsHost}:${slowTlsPort}:127.0.0.2,127.0.0.1`, `https://${slowTlsHost}:${slowTlsPort}/`]);
  await run('curl-installed-tls-slow', binaries.installedCurl, ['--silent', '--show-error', '--noproxy', '*', '--verbose', '--insecure', '--max-time', '2', '--resolve', `${slowTlsHost}:${slowTlsPort}:127.0.0.2,127.0.0.1`, `https://${slowTlsHost}:${slowTlsPort}/`]);
  await run('go-tls-slow', join(cache, 'audit-go'), [slowTlsHost, String(slowTlsPort), dnsPort, 'tls-slow', '2000']);
  await run('node-tls-slow', binaries.node, ['scripts/audit-node.mjs', slowTlsHost, String(slowTlsPort), 'tls-slow', '2000']);
  await run('node-nvm-tls-slow', binaries.nvmNode, ['scripts/audit-node.mjs', slowTlsHost, String(slowTlsPort), 'tls-slow', '2000']);
  for (const [mode, map] of [['single-success', '127.0.0.1'], ['single-failure', '127.0.0.2'], ['localhost-dual', 'localhost']])
    await runBrowser(mode, map, httpPort);
  await runBrowser('tls-stall', '127.0.0.2', httpsPort, true);
  mkdirSync('docs/audits', { recursive: true });
  // Preserve complete local commands privately; published commands use portable placeholders.
  const raw = JSON.stringify(results, null, 2);
  writeFileSync(join(cache, 'probe-results-raw.json'), raw + '\n', { mode: 0o600 });
  let portable = raw;
  const variables = { curl: 'CURL_BIN', installedCurl: 'INSTALLED_CURL_BIN', go: 'GO_BIN', node: 'NODE_BIN', nvmNode: 'NVM_NODE_BIN', chrome: 'CHROME_BIN' };
  for (const [name, path] of Object.entries(binaries).sort((a, b) => b[1].length - a[1].length))
    portable = portable.replaceAll(path, '${' + variables[name] + '}');
  portable = portable.replaceAll(cache, '${AUDIT_CACHE}');
  writeFileSync('docs/audits/probe-results.json', portable + '\n');
  const infrastructureFailure = results.probes.some(probe => probe.timedOut || probe.error || probe.netlogError || probe.name === 'build-go-probe' && probe.code !== 0);
  if (infrastructureFailure) process.exitCode = 1;
  console.log(JSON.stringify(results.probes.map(({ name, code, timedOut, elapsedMs, stdout, netlog }) => ({ name, code, timedOut, elapsedMs, stdout, netlog })), null, 2));
} finally {
  dns.close();
  for (const socket of sockets) socket.destroy();
  for (const server of servers) server.close();
}
