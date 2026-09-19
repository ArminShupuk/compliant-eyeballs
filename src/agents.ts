import * as http from 'node:http';
import * as https from 'node:https';
import { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import type { Duplex } from 'node:stream';
import { tcp, secure } from './connect.js';
import { abortError } from './errors.js';
import { directOnlyError, proxyOption, requireDirect, requireOwnedTransport, timing } from './config.js';
import type { ConnectionOptions, TlsOptions } from './types.js';

export type AgentConnectionOptions = Omit<ConnectionOptions, 'hostname' | 'port'> & { tls?: TlsOptions };
export type HttpAgentOptions = http.AgentOptions & { connection?: AgentConnectionOptions };
export type HttpsAgentOptions = https.AgentOptions & { connection?: AgentConnectionOptions };
type Request = http.ClientRequest;
type NativeOptions = https.RequestOptions & { _agentKey?: string; [entryKey]?: Entry };
type Callback = (error: Error | null, socket?: Duplex) => void;
type NativeAgent = Omit<http.Agent, 'sockets' | 'requests'> & {
  sockets: Record<string, Socket[] | undefined>;
  requests: Record<string, Request[] | undefined>;
  options: https.AgentOptions;
  totalSocketCount: number;
  addRequest(req: Request, options: NativeOptions): void;
  createSocket(req: Request, options: NativeOptions, callback: Callback): void;
  removeSocket(socket: Socket, options: NativeOptions): void;
};
interface Entry {
  req: Request;
  controller: AbortController;
  active: boolean;
  handed: boolean;
  sockets: Set<Socket>;
  closeHooks: Map<Socket, () => void>;
  timeout?: number;
  cleanup(): void;
}
const entryKey = Symbol('compliant-eyeballs request');
function failRequest(req: Request, error: Error): void {
  (req.onSocket as (socket: Socket | undefined, error?: Error) => void)(undefined, error);
}
function requireDirectOptions(options: object): void {
  requireDirect(options);
  if ('createConnection' in options) throw new TypeError('Direct agents do not own createConnection; retain the existing connection integration');
}

function install(agent: NativeAgent, connection: AgentConnectionOptions, tls: boolean): void {
  connection = { ...connection, tls: { ...connection.tls } };
  timing(connection);
  const originalAdd = agent.addRequest.bind(agent);
  const originalCreate = agent.createSocket.bind(agent);
  const originalDestroy = agent.destroy.bind(agent);
  const pending = new Map<Request, Entry>();
  const connecting = new Set<AbortController>();
  const sessions = new Map<string, Buffer>();
  const policies = new WeakMap<object, number>();
  let policyId = 0;
  const policyKey = (value: object | undefined) => {
    if (!value) return 0;
    if (!policies.has(value)) policies.set(value, ++policyId);
    return policies.get(value);
  };
  let destroyed = false;
  const removeQueued = (req: Request) => {
    for (const [name, queue] of Object.entries(agent.requests)) {
      const index = queue!.indexOf(req);
      if (index >= 0) queue!.splice(index, 1);
      if (!queue!.length) delete agent.requests[name];
    }
  };

  agent.addRequest = (req, options) => {
    if (destroyed) { process.nextTick(() => failRequest(req, abortError('Agent destroyed'))); return; }
    // ws supplies a request-level createConnection even when an Agent owns the
    // socket. It is not evidence that this direct Agent owns a proxy route.
    const proxyKey = proxyOption(options);
    if (proxyKey) {
      process.nextTick(() => failRequest(req, directOnlyError(proxyKey)));
      return;
    }
    const controller = new AbortController();
    const destroyDescriptor = Object.getOwnPropertyDescriptor(req, 'destroy');
    const timeoutDescriptor = Object.getOwnPropertyDescriptor(req, 'setTimeout');
    const requestDestroy = req.destroy;
    const requestTimeout = req.setTimeout;
    const restore = (name: 'destroy' | 'setTimeout', descriptor?: PropertyDescriptor) => {
      if (descriptor) Object.defineProperty(req, name, descriptor);
      else delete (req as unknown as Record<string, unknown>)[name];
    };
    const entry: Entry = {
      req, controller, active: false, handed: false, sockets: new Set(), closeHooks: new Map(),
      timeout: options.timeout ?? agent.options.timeout,
      cleanup() {
        pending.delete(req);
        if (req.destroy === wrappedDestroy) restore('destroy', destroyDescriptor);
        if (req.setTimeout === wrappedTimeout) restore('setTimeout', timeoutDescriptor);
        req.removeListener('socket', onSocket); req.removeListener('close', onClose);
        connection.signal?.removeEventListener('abort', onAbort);
        for (const [socket, listener] of entry.closeHooks) socket.removeListener('close', listener);
        entry.closeHooks.clear();
        entry.sockets.clear();
      },
    };
    function wrappedDestroy(this: Request, error?: Error): Request {
      const result = requestDestroy.call(this, error);
      if (this !== req) return result;
      controller.abort(error);
      for (const socket of entry.sockets) socket.destroy();
      removeQueued(req);
      if (!entry.active && !entry.handed) {
        entry.handed = true;
        failRequest(req, error ?? abortError());
      }
      return result;
    }
    function wrappedTimeout(this: Request, ms: number, callback?: () => void): Request {
      const result = requestTimeout.call(this, ms, callback);
      if (this === req) { entry.timeout = ms; for (const socket of entry.sockets) socket.setTimeout(ms); }
      return result;
    }
    const onSocket = () => { entry.handed = true; entry.cleanup(); };
    const onClose = () => { controller.abort(); entry.cleanup(); };
    const onAbort = () => req.destroy(abortError(connection.signal?.reason));
    pending.set(req, entry);
    req.destroy = wrappedDestroy;
    req.setTimeout = wrappedTimeout;
    req.once('socket', onSocket).once('close', onClose);
    connection.signal?.addEventListener('abort', onAbort, { once: true });
    if (connection.signal?.aborted) { onAbort(); return; }
    try { originalAdd(req, { ...options, [entryKey]: entry }); }
    catch (error) { entry.cleanup(); throw error; }
  };

  agent.createSocket = (req, options, callback) => {
    const entry = pending.get(req);
    if (entry) entry.active = true;
    originalCreate(req, { ...options, [entryKey]: entry }, callback);
  };

  agent.createConnection = (raw, callback) => {
    const options = raw as NativeOptions;
    const finish = callback as Callback | undefined;
    if (!finish) throw new TypeError('This agent requires the asynchronous createConnection callback');
    if (destroyed) { process.nextTick(() => finish(abortError('Agent destroyed'))); return undefined; }
    const entry = options[entryKey];
    const proxyKey = proxyOption(options);
    if (proxyKey) { process.nextTick(() => finish(directOnlyError(proxyKey))); return undefined; }
    if (options.socketPath || 'socket' in options || 'httpSocket' in options || options.path && !options.port) {
      process.nextTick(() => finish(new TypeError('Direct agents do not implement Unix sockets or proxy tunnels; keep the owning agent')));
      return undefined;
    }
    const hostname = options.hostname ?? options.host ?? 'localhost';
    const name = options._agentKey ?? agent.getName(options);
    const controller = entry?.controller ?? new AbortController();
    const cancel = () => controller.abort(connection.signal?.reason);
    connection.signal?.addEventListener('abort', cancel, { once: true });
    if (connection.signal?.aborted) cancel();
    connecting.add(controller);
    // Native Agent only accounts for a socket after asynchronous completion.
    // Reserve one pool slot for the whole race so maxSockets/maxTotalSockets
    // also constrain DNS and handshakes. No candidate reaches HTTP prematurely.
    const reservation = new Socket();
    (agent.sockets[name] ??= []).push(reservation);
    agent.totalSocketCount++;
    const release = () => {
      connecting.delete(controller);
      connection.signal?.removeEventListener('abort', cancel);
      // This reservation remains in the named bucket until release; normal
      // Agent destruction destroys sockets but does not remove the bucket.
      const list = agent.sockets[name]!;
      const index = list.indexOf(reservation);
      if (index >= 0) list.splice(index, 1);
      if (!list.length) delete agent.sockets[name];
      agent.totalSocketCount--;
      reservation.destroy();
    };
    const settings: ConnectionOptions = {
      ...connection, hostname, port: Number(options.port ?? (tls ? 443 : 80)),
      family: (options.family ?? connection.family) as ConnectionOptions['family'],
      localAddress: options.localAddress ?? connection.localAddress,
      localPort: options.localPort ?? connection.localPort,
      lookup: options.lookup ?? connection.lookup,
      hints: options.hints ?? connection.hints,
      signal: controller.signal,
      socketTimeoutMs: entry?.timeout ?? options.timeout ?? connection.socketTimeoutMs,
      onTimeout: socket => { if (entry && !entry.controller.signal.aborted) entry.req.emit('timeout'); connection.onTimeout?.(socket); },
    };
    const tlsOptions = { ...connection.tls, ...options };
    // HTTPS request paths and ws's request-level createConnection are not
    // transport instructions for this Agent's TLS socket.
    delete tlsOptions.path;
    delete tlsOptions.createConnection;
    const sessionKey = JSON.stringify([name, hostname, policyKey(tlsOptions.checkServerIdentity), policyKey(tlsOptions.secureContext)]);
    const sessionLimit = agent.options.maxCachedSessions ?? 100;
    let winner: TLSSocket | undefined;
    const tickets = new WeakMap<Socket, Buffer>();
    const cache = (session: Buffer) => {
      if (destroyed || !winner?.authorized || sessionLimit <= 0) return;
      sessions.delete(sessionKey); sessions.set(sessionKey, session);
      while (sessions.size > sessionLimit) sessions.delete(sessions.keys().next().value!);
    };
    const observe = (socket: Socket) => {
      entry?.sockets.add(socket);
      if (entry) {
        const closed = () => { entry.sockets.delete(socket); entry.closeHooks.delete(socket); };
        entry.closeHooks.set(socket, closed); socket.once('close', closed);
      }
      if (tls) socket.on('session', session => { if (winner === socket) cache(session); else if (!winner) tickets.set(socket, session); });
    };
    const promise = tls ? secure({ ...settings, tls: { ...tlsOptions, session: tlsOptions.session ?? sessions.get(sessionKey) } }, observe) : tcp(settings, observe);
    promise.then(socket => {
      release();
      if (controller.signal.aborted || destroyed) {
        socket.destroy(); finish(abortError(controller.signal.reason));
        agent.removeSocket(reservation, options);
      } else {
        if (tls) { winner = socket as TLSSocket; const ticket = tickets.get(socket); if (ticket) cache(ticket); }
        if (entry) entry.handed = true;
        finish(null, socket);
      }
    }, error => {
      release();
      if (entry) { entry.handed = true; removeQueued(entry.req); }
      finish(error);
      agent.removeSocket(reservation, options);
    });
    return undefined;
  };

  agent.destroy = () => {
    destroyed = true;
    sessions.clear();
    for (const entry of [...pending.values()]) entry.req.destroy(abortError('Agent destroyed'));
    for (const controller of connecting) controller.abort('Agent destroyed');
    originalDestroy();
  };
}

export class HappyEyeballsHttpAgent extends http.Agent {
  constructor({ connection = {}, ...options }: HttpAgentOptions = {}) {
    requireDirectOptions(options);
    requireDirect(connection);
    requireDirect(connection.tls ?? {});
    requireOwnedTransport(connection);
    requireOwnedTransport(connection.tls ?? {});
    super(options);
    install(this as unknown as NativeAgent, connection, false);
  }
}
export class HappyEyeballsHttpsAgent extends https.Agent {
  constructor({ connection = {}, ...options }: HttpsAgentOptions = {}) {
    requireDirectOptions(options);
    requireDirect(connection);
    requireDirect(connection.tls ?? {});
    requireOwnedTransport(connection);
    requireOwnedTransport(connection.tls ?? {});
    super(options);
    install(this as unknown as NativeAgent, connection, true);
  }
}
export function createHttpAgent(options?: HttpAgentOptions): HappyEyeballsHttpAgent { return new HappyEyeballsHttpAgent(options); }
export function createHttpsAgent(options?: HttpsAgentOptions): HappyEyeballsHttpsAgent { return new HappyEyeballsHttpsAgent(options); }
