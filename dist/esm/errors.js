export function asError(value) { return value instanceof Error ? value : new Error(String(value)); }
/** Custom errors (including DOMException) may have non-Node numeric codes. */
export function errorCode(error) {
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
}
export function abortError(reason) {
    return Object.assign(new Error('The operation was aborted', { cause: reason }), { name: 'AbortError', code: 'ABORT_ERR' });
}
export class AttemptError extends Error {
    address;
    family;
    port;
    code;
    constructor(candidate, port, cause) {
        super(`Connection attempt to ${candidate.address}:${port} failed`, { cause });
        this.name = 'AttemptError';
        this.address = candidate.address;
        this.family = candidate.family;
        this.port = port;
        this.code = errorCode(cause);
    }
}
export class ConnectionError extends AggregateError {
    code;
    constructor(errors, code, deadlineExceeded = code === 'ETIMEDOUT') {
        const codes = [...new Set(errors.map(errorCode).filter((value) => !!value))];
        const detail = codes.length > 1 ? ` (${codes.join(', ')})` : '';
        super(errors, `${deadlineExceeded ? 'Connection deadline exceeded' : 'No connection could be established'}${detail}`);
        this.code = code;
        this.name = 'ConnectionError';
    }
}
/** A single failed candidate has the same error shape as a native connection. */
export function exhaustedError(errors) {
    const attempts = errors.filter((error) => error instanceof AttemptError);
    if (attempts.length === 1)
        return attempts[0].cause;
    const relevant = attempts.length ? attempts : errors;
    const codes = relevant.map(errorCode);
    const commonCode = codes.length && codes[0] && codes.every(code => code === codes[0]) ? codes[0] : undefined;
    if (!attempts.length && (errors.length === 1 || commonCode))
        return errors[0];
    const code = attempts.length
        ? commonCode ?? 'ECONNFAILED'
        : commonCode ?? (codes.includes('EAI_AGAIN') ? 'EAI_AGAIN' : errors.length ? 'ECONNFAILED' : 'ENOTFOUND');
    return new ConnectionError(errors, code, false);
}
//# sourceMappingURL=errors.js.map