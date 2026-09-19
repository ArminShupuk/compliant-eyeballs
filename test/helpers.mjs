import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export const localResolver = ({ families, signal }, update) => {
  for (const family of families) if (!signal.aborted) update({ family, addresses: family === 4 ? ['127.0.0.1'] : [], complete: true });
};
export async function listen(t, server, host = '127.0.0.1', port = 0) {
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.listen(port, host); await once(server, 'listening');
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  });
  return { port: server.address().port, sockets };
}
let material;
export function certs() {
  if (material) return material;
  const directory = mkdtempSync(join(tmpdir(), 'eyeballs-cert-'));
  process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
  const run = args => execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' });
  run(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=Ephemeral Test CA']);
  for (const name of ['server', 'client', 'dns']) {
    run(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${name === 'client' ? 'test-client' : 'localhost'}`]);
    writeFileSync(join(directory, `${name}.ext`), name === 'client' ? 'extendedKeyUsage=clientAuth\n' : `subjectAltName=DNS:localhost${name === 'server' ? ',IP:127.0.0.1,IP:::1' : ''}\nextendedKeyUsage=serverAuth\n`);
    run(['x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', `${name}.pem`, '-days', '2', '-extfile', `${name}.ext`]);
  }
  const read = path => readFileSync(join(directory, path));
  material = { ca: read('ca.pem'), key: read('server.key'), cert: read('server.pem'), dns: { key: read('dns.key'), cert: read('dns.pem') }, client: { key: read('client.key'), cert: read('client.pem') } };
  return material;
}
