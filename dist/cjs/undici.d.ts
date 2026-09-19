import type { Socket } from 'node:net';
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
export declare function createUndiciConnector(config?: UndiciConnectorOptions): CancellableConnector;
