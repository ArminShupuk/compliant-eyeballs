import type { Candidate } from './types.js';
export function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
export function abortError(reason?: unknown): Error {
  return Object.assign(new Error('Connection cancelled', { cause: reason }), { name: 'AbortError', code: 'ABORT_ERR' });
}
export class AttemptError extends Error {
  readonly address: string;
  readonly family: 4 | 6;
  readonly port: number;
  readonly code?: string;
  constructor(candidate: Candidate, port: number, cause: Error) {
    super(`Connection attempt to ${candidate.address}:${port} failed`, { cause });
    this.name = 'AttemptError';
    this.address = candidate.address; this.family = candidate.family; this.port = port;
    this.code = (cause as NodeJS.ErrnoException).code;
  }
}
export class ConnectionError extends AggregateError {
  constructor(errors: Error[], readonly code: 'ECONNFAILED' | 'ETIMEDOUT' | 'ENOTFOUND') {
    super(errors, code === 'ETIMEDOUT' ? 'Connection deadline exceeded' : 'No connection could be established');
    this.name = 'ConnectionError';
  }
}
