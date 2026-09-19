import { type Socket } from 'node:net';
import { type TLSSocket } from 'node:tls';
import type { ConnectionOptions, TlsConnectionOptions } from './types.js';
export declare function connectTcp(options: ConnectionOptions): Promise<Socket>;
export declare function tcp(options: ConnectionOptions, observe?: (socket: Socket) => void): Promise<Socket>;
export declare function connectTls(options: TlsConnectionOptions): Promise<TLSSocket>;
export declare function secure(options: TlsConnectionOptions, observe?: (socket: TLSSocket) => void): Promise<TLSSocket>;
