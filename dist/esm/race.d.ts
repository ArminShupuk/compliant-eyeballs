import { type Socket } from 'node:net';
import type { Candidate, ConnectionOptions } from './types.js';
/** Internal injection seam, deliberately absent from package exports. */
export interface Clock {
    now(): number;
    set(fn: () => void, delay: number): unknown;
    clear(timer: unknown): void;
}
export declare function race<T extends Socket>(options: ConnectionOptions, create: (candidate: Candidate) => T, ready: 'connect' | 'secureConnect', time?: Clock): Promise<T>;
