import type { Candidate } from './types.js';
export declare function asError(value: unknown): Error;
export declare function abortError(reason?: unknown): Error;
export declare class AttemptError extends Error {
    readonly address: string;
    readonly family: 4 | 6;
    readonly port: number;
    readonly code?: string;
    constructor(candidate: Candidate, port: number, cause: Error);
}
export declare class ConnectionError extends AggregateError {
    readonly code: 'ECONNFAILED' | 'ETIMEDOUT' | 'ENOTFOUND';
    constructor(errors: Error[], code: 'ECONNFAILED' | 'ETIMEDOUT' | 'ENOTFOUND');
}
