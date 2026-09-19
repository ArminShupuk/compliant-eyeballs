import type { Candidate } from './types.js';
export declare function asError(value: unknown): Error;
/** Custom errors (including DOMException) may have non-Node numeric codes. */
export declare function errorCode(error: Error): string | undefined;
export declare function abortError(reason?: unknown): Error;
export declare class AttemptError extends Error {
    readonly address: string;
    readonly family: 4 | 6;
    readonly port: number;
    readonly code?: string;
    constructor(candidate: Candidate, port: number, cause: Error);
}
export declare class ConnectionError extends AggregateError {
    readonly code: string;
    constructor(errors: Error[], code: string, deadlineExceeded?: boolean);
}
/** A single failed candidate has the same error shape as a native connection. */
export declare function exhaustedError(errors: Error[]): Error;
