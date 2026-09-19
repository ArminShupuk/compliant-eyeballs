import type { Candidate } from './types.js';
export function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
/** Custom errors (including DOMException) may have non-Node numeric codes. */
export function errorCode(error: Error): string | undefined {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' ? code : undefined;
}
export function abortError(reason?: unknown): Error {
  return Object.assign(new Error('The operation was aborted', { cause: reason }), { name: 'AbortError', code: 'ABORT_ERR' });
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
    this.code = errorCode(cause);
  }
}
export class ConnectionError extends AggregateError {
  constructor(errors: Error[], readonly code: string, deadlineExceeded = code === 'ETIMEDOUT') {
    const codes = [...new Set(errors.map(errorCode).filter((value): value is string => !!value))];
    const detail = codes.length > 1 ? ` (${codes.join(', ')})` : '';
    super(errors, `${deadlineExceeded ? 'Connection deadline exceeded' : 'No connection could be established'}${detail}`);
    this.name = 'ConnectionError';
  }
}

/** A single failed candidate has the same error shape as a native connection. */
export function exhaustedError(errors: Error[]): Error {
  const attempts = errors.filter((error): error is AttemptError => error instanceof AttemptError);
  if (attempts.length === 1) return attempts[0]!.cause as Error;

  const relevant = attempts.length ? attempts : errors;
  const codes = relevant.map(errorCode);
  const commonCode = codes.length && codes[0] && codes.every(code => code === codes[0]) ? codes[0] : undefined;
  if (!attempts.length && (errors.length === 1 || commonCode)) return errors[0]!;
  const code = attempts.length
    ? commonCode ?? 'ECONNFAILED'
    : commonCode ?? (codes.includes('EAI_AGAIN') ? 'EAI_AGAIN' : errors.length ? 'ECONNFAILED' : 'ENOTFOUND');
  return new ConnectionError(errors, code, false);
}
