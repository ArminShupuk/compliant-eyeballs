import * as http from 'node:http';
import * as https from 'node:https';
import { Socket } from 'node:net';
import { getSystemErrorMap } from 'node:util';
import { tcp, secure } from './connect.js';
import { abortError, errorCode } from './errors.js';
import { directOnlyError, proxyOption, requireDirect, requireOwnedTransport, timing } from './config.js';
const entryKey = Symbol('compliant-eyeballs request');
function failRequest(req, error) {
    req.onSocket(undefined, error);
}
function nativeHttpsError(error) {
    // Native ClientRequest writes before TLS readiness and reports OpenSSL
    // protocol failures as write EPROTO. This agent waits for secureConnect.
    const code = errorCode(error);
    if (!code?.startsWith('ERR_SSL_') || error.library !== 'SSL routines')
        return error;
    // Node reports libuv errno values, which differ from OS errno on Windows.
    const errno = [...getSystemErrorMap()].find(([, [name]]) => name === 'EPROTO')[0];
    return Object.assign(new Error(`write EPROTO ${error.message}`, { cause: error }), {
        code: 'EPROTO', syscall: 'write', errno,
    });
}
function requireDirectOptions(options) {
    requireDirect(options);
    if ('createConnection' in options)
        throw new TypeError('Direct agents do not own createConnection; retain the existing connection integration');
}
function install(agent, connection, tls) {
    connection = { ...connection, tls: { ...connection.tls } };
    timing(connection);
    const originalAdd = agent.addRequest.bind(agent);
    const originalCreate = agent.createSocket.bind(agent);
    const originalDestroy = agent.destroy.bind(agent);
    const pending = new Map();
    const connecting = new Set();
    const sessions = new Map();
    const policies = new WeakMap();
    let policyId = 0;
    const policyKey = (value) => {
        if (!value)
            return 0;
        if (!policies.has(value))
            policies.set(value, ++policyId);
        return policies.get(value);
    };
    let destroyed = false;
    const removeQueued = (req) => {
        for (const [name, queue] of Object.entries(agent.requests)) {
            const index = queue.indexOf(req);
            if (index >= 0)
                queue.splice(index, 1);
            if (!queue.length)
                delete agent.requests[name];
        }
    };
    agent.addRequest = (req, options) => {
        // A pre-aborted request signal destroys ClientRequest before addRequest.
        // Report its saved error without waiting for DNS or the race deadline.
        if (req.destroyed) {
            process.nextTick(() => failRequest(req));
            return;
        }
        if (destroyed) {
            process.nextTick(() => failRequest(req, abortError('Agent destroyed')));
            return;
        }
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
        const restore = (name, descriptor) => {
            if (descriptor)
                Object.defineProperty(req, name, descriptor);
            else
                delete req[name];
        };
        const entry = {
            req, controller, active: false, handed: false, sockets: new Set(), closeHooks: new Map(),
            timeout: options.timeout ?? agent.options.timeout,
            cleanup() {
                pending.delete(req);
                if (req.destroy === wrappedDestroy)
                    restore('destroy', destroyDescriptor);
                if (req.setTimeout === wrappedTimeout)
                    restore('setTimeout', timeoutDescriptor);
                req.removeListener('socket', onSocket);
                req.removeListener('close', onClose);
                connection.signal?.removeEventListener('abort', onAbort);
                for (const [socket, listener] of entry.closeHooks)
                    socket.removeListener('close', listener);
                entry.closeHooks.clear();
                entry.sockets.clear();
            },
        };
        function wrappedDestroy(error) {
            const result = requestDestroy.call(this, error);
            if (this !== req)
                return result;
            controller.abort(error);
            for (const socket of entry.sockets)
                socket.destroy();
            removeQueued(req);
            if (!entry.active && !entry.handed) {
                entry.handed = true;
                failRequest(req);
            }
            return result;
        }
        function wrappedTimeout(ms, callback) {
            const result = requestTimeout.call(this, ms, callback);
            if (this === req) {
                entry.timeout = ms;
                for (const socket of entry.sockets)
                    socket.setTimeout(ms);
            }
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
        if (connection.signal?.aborted) {
            onAbort();
            return;
        }
        try {
            originalAdd(req, { ...options, [entryKey]: entry });
        }
        catch (error) {
            entry.cleanup();
            throw error;
        }
    };
    agent.createSocket = (req, options, callback) => {
        const entry = pending.get(req);
        if (entry)
            entry.active = true;
        originalCreate(req, { ...options, [entryKey]: entry }, callback);
    };
    agent.createConnection = (raw, callback) => {
        const options = raw;
        const finish = callback;
        if (!finish)
            throw new TypeError('This agent requires the asynchronous createConnection callback');
        if (destroyed) {
            process.nextTick(() => finish(abortError('Agent destroyed')));
            return undefined;
        }
        const entry = options[entryKey];
        const proxyKey = proxyOption(options);
        if (proxyKey) {
            process.nextTick(() => finish(directOnlyError(proxyKey)));
            return undefined;
        }
        if (options.socketPath || 'socket' in options || 'httpSocket' in options || options.path && !options.port) {
            process.nextTick(() => finish(new TypeError('Direct agents do not implement Unix sockets or proxy tunnels; keep the owning agent')));
            return undefined;
        }
        const hostname = options.hostname ?? options.host ?? 'localhost';
        const name = options._agentKey ?? agent.getName(options);
        const controller = entry?.controller ?? new AbortController();
        const cancel = () => controller.abort(connection.signal?.reason);
        connection.signal?.addEventListener('abort', cancel, { once: true });
        if (connection.signal?.aborted)
            cancel();
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
            const list = agent.sockets[name];
            const index = list.indexOf(reservation);
            if (index >= 0)
                list.splice(index, 1);
            if (!list.length)
                delete agent.sockets[name];
            agent.totalSocketCount--;
            reservation.destroy();
        };
        const settings = {
            ...connection, hostname, port: Number(options.port ?? (tls ? 443 : 80)),
            family: (options.family ?? connection.family),
            localAddress: options.localAddress ?? connection.localAddress,
            localPort: options.localPort ?? connection.localPort,
            lookup: options.lookup ?? connection.lookup,
            hints: options.hints ?? connection.hints,
            signal: controller.signal,
            socketTimeoutMs: entry?.timeout ?? options.timeout ?? connection.socketTimeoutMs,
            onTimeout: socket => { if (entry && !entry.controller.signal.aborted)
                entry.req.emit('timeout'); connection.onTimeout?.(socket); },
        };
        const tlsOptions = { ...connection.tls, ...options };
        // HTTPS request paths and ws's request-level createConnection are not
        // transport instructions for this Agent's TLS socket.
        delete tlsOptions.path;
        delete tlsOptions.createConnection;
        const sessionKey = JSON.stringify([name, hostname, policyKey(tlsOptions.checkServerIdentity), policyKey(tlsOptions.secureContext)]);
        const sessionLimit = agent.options.maxCachedSessions ?? 100;
        let winner;
        const tickets = new WeakMap();
        const cache = (session) => {
            if (destroyed || !winner?.authorized || sessionLimit <= 0)
                return;
            sessions.delete(sessionKey);
            sessions.set(sessionKey, session);
            while (sessions.size > sessionLimit)
                sessions.delete(sessions.keys().next().value);
        };
        const observe = (socket) => {
            entry?.sockets.add(socket);
            if (entry) {
                const closed = () => { entry.sockets.delete(socket); entry.closeHooks.delete(socket); };
                entry.closeHooks.set(socket, closed);
                socket.once('close', closed);
            }
            if (tls)
                socket.on('session', session => { if (winner === socket)
                    cache(session);
                else if (!winner)
                    tickets.set(socket, session); });
        };
        const promise = tls ? secure({ ...settings, tls: { ...tlsOptions, session: tlsOptions.session ?? sessions.get(sessionKey) } }, observe) : tcp(settings, observe);
        const failed = (error) => {
            if (entry) {
                entry.handed = true;
                removeQueued(entry.req);
            }
            // ClientRequest already owns the destroy error (including native signal
            // wrapping), and distinguishes destroy() from abort(). Let onSocket use it.
            if (entry?.req.destroyed)
                failRequest(entry.req);
            else
                finish(tls && entry?.req.writableLength ? nativeHttpsError(error) : error);
        };
        promise.then(socket => {
            release();
            if (controller.signal.aborted || destroyed) {
                socket.destroy();
                failed(abortError(controller.signal.reason));
                agent.removeSocket(reservation, options);
            }
            else {
                if (tls) {
                    winner = socket;
                    const ticket = tickets.get(socket);
                    if (ticket)
                        cache(ticket);
                }
                if (entry)
                    entry.handed = true;
                finish(null, socket);
            }
        }, error => {
            release();
            failed(error);
            agent.removeSocket(reservation, options);
        });
        return undefined;
    };
    agent.destroy = () => {
        destroyed = true;
        sessions.clear();
        for (const entry of [...pending.values()])
            entry.req.destroy(abortError('Agent destroyed'));
        for (const controller of connecting)
            controller.abort('Agent destroyed');
        originalDestroy();
    };
}
export class HappyEyeballsHttpAgent extends http.Agent {
    constructor({ connection = {}, ...options } = {}) {
        requireDirectOptions(options);
        requireDirect(connection);
        requireDirect(connection.tls ?? {});
        requireOwnedTransport(connection);
        requireOwnedTransport(connection.tls ?? {});
        super(options);
        install(this, connection, false);
    }
}
export class HappyEyeballsHttpsAgent extends https.Agent {
    constructor({ connection = {}, ...options } = {}) {
        requireDirectOptions(options);
        requireDirect(connection);
        requireDirect(connection.tls ?? {});
        requireOwnedTransport(connection);
        requireOwnedTransport(connection.tls ?? {});
        super(options);
        install(this, connection, true);
    }
}
export function createHttpAgent(options) { return new HappyEyeballsHttpAgent(options); }
export function createHttpsAgent(options) { return new HappyEyeballsHttpsAgent(options); }
//# sourceMappingURL=agents.js.map