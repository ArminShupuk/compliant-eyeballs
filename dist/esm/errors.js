export function asError(value) { return value instanceof Error ? value : new Error(String(value)); }
export function abortError(reason) {
    return Object.assign(new Error('Connection cancelled', { cause: reason }), { name: 'AbortError', code: 'ABORT_ERR' });
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
        this.code = cause.code;
    }
}
export class ConnectionError extends AggregateError {
    code;
    constructor(errors, code) {
        super(errors, code === 'ETIMEDOUT' ? 'Connection deadline exceeded' : 'No connection could be established');
        this.code = code;
        this.name = 'ConnectionError';
    }
}
//# sourceMappingURL=errors.js.map