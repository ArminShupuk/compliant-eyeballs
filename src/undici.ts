import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { tcp, secure } from './connect.js';
import { abortError, asError } from './errors.js';
import { directOnlyError, proxyOption, requireDirect, requireOwnedTransport, timing } from './config.js';
import type { ConnectionOptions, TlsOptions } from './types.js';

/** Structural types keep Undici out of the dependency graph. */
export interface UndiciConnectOptions {
  hostname: string;
  protocol: string;
  port: string;
  host?: string;
  servername?: string;
  localAddress?: string | null;
  httpSocket?: Socket;
  socketPath?: string | null;
  signal?: AbortSignal;
}
export type ConnectCallback = (...args: [error: null, socket: Socket] | [error: Error, socket: null]) => void;
export type Connector = (options: UndiciConnectOptions, callback: ConnectCallback) => unknown;
export interface UndiciConnectorOptions extends Omit<ConnectionOptions, 'hostname' | 'port'> {
  tls?: TlsOptions;
  allowH2?: boolean;
  maxCachedSessions?: number;
  /** Owner for an existing tunnel, Unix socket or alternate protocol; its lifecycle stays with the caller. */
  fallbackConnector?: Connector;
}
export interface CancellableConnector {
  (options: UndiciConnectOptions, callback: ConnectCallback): void;
  destroy(reason?: unknown): void;
}

export function createUndiciConnector(config: UndiciConnectorOptions = {}): CancellableConnector {
  config = { ...config };
  requireDirect(config);
  requireDirect(config.tls ?? {});
  requireOwnedTransport(config);
  requireOwnedTransport(config.tls ?? {});
  timing(config);
  const capacity = config.maxCachedSessions ?? 100;
  if (!Number.isSafeInteger(capacity) || capacity < 0) throw new RangeError('maxCachedSessions must be a nonnegative integer');
  // Copy option properties; caller-owned buffers and SecureContext objects must
  // stay unchanged. Separate TLS policies require separate connectors and caches.
  const tls = { ...config.tls };
  const sessions = new Map<string, Buffer>();
  const pending = new Set<AbortController>();
  let destroyed = false;
  const connector: CancellableConnector = (options, callback) => {
    if (destroyed) { queueMicrotask(() => callback(abortError('Connector destroyed'), null)); return; }
    const proxyKey = proxyOption(options);
    if (proxyKey) { queueMicrotask(() => callback(directOnlyError(proxyKey), null)); return; }
    if (options.httpSocket || options.socketPath || !['http:', 'https:'].includes(options.protocol)) {
      // Delegation is only for a transport already selected by another owner.
      // A proxy route cannot be inferred from an ordinary origin connection.
      if (config.fallbackConnector) { config.fallbackConnector(options, callback); return; }
      queueMicrotask(() => callback(new TypeError('A proxy tunnel, Unix socket or alternate protocol requires its owning fallbackConnector'), null));
      return;
    }
    const controller = new AbortController();
    pending.add(controller);
    const signals = [...new Set([options.signal, config.signal].filter((s): s is AbortSignal => !!s))];
    const listeners = signals.map(signal => {
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      return { signal, abort };
    });
    const cleanup = () => { pending.delete(controller); for (const { signal, abort } of listeners) signal.removeEventListener('abort', abort); };
    const port = Number(options.port || (options.protocol === 'https:' ? 443 : 80));
    const settings: ConnectionOptions = { ...config, hostname: options.hostname, port, localAddress: options.localAddress ?? config.localAddress, signal: controller.signal };
    const servername = options.servername ?? tls.servername;
    const key = JSON.stringify([options.hostname, port, servername, settings.localAddress]);
    let selected: TLSSocket | undefined;
    const tickets = new WeakMap<TLSSocket, Buffer>();
    const cache = (session: Buffer) => {
      if (!capacity || destroyed || !selected?.authorized) return;
      sessions.delete(key); sessions.set(key, session);
      while (sessions.size > capacity) sessions.delete(sessions.keys().next().value!);
    };
    const promise = options.protocol === 'https:'
      ? secure({ ...settings, tls: { ...tls, servername, ALPNProtocols: tls.ALPNProtocols ?? (config.allowH2 ? ['h2', 'http/1.1'] : ['http/1.1']), session: tls.session ?? sessions.get(key) } }, socket => {
        // Tickets from failed/losing connections never enter the cache.
        socket.on('session', session => { if (selected === socket) cache(session); else if (!selected) tickets.set(socket, session); });
      })
      : tcp(settings);
    promise.then(socket => {
      cleanup();
      if (controller.signal.aborted || destroyed) { socket.destroy(); callback(abortError(controller.signal.reason), null); return; }
      if ('authorized' in socket) { selected = socket as TLSSocket; const ticket = tickets.get(selected); if (ticket) cache(ticket); }
      callback(null, socket);
    }, error => { cleanup(); callback(asError(error), null); });
  };
  connector.destroy = reason => { destroyed = true; for (const controller of pending) controller.abort(reason); sessions.clear(); };
  return connector;
}
