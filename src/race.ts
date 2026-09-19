import { isIP, type Socket } from 'node:net';
import { performance } from 'node:perf_hooks';
import { destination, MAX_TIMER_MS, timing } from './config.js';
import { abortError, asError, AttemptError, ConnectionError, errorCode, exhaustedError } from './errors.js';
import { createSystemResolver } from './resolver.js';
import type { Candidate, ConnectionOptions, DiagnosticEvent, Family, ResolutionUpdate } from './types.js';

/** Internal injection seam, deliberately absent from package exports. */
export interface Clock { now(): number; set(fn: () => void, delay: number): unknown; clear(timer: unknown): void }
const clock: Clock = { now: () => performance.now(), set: (fn, ms) => setTimeout(fn, Math.min(MAX_TIMER_MS, Math.max(1, Math.ceil(ms)))), clear: id => clearTimeout(id as NodeJS.Timeout) };
function key(candidate: Candidate): string {
  let address = candidate.address;
  if (candidate.family === 6 && !address.includes('%')) address = new URL(`http://[${address}]/`).hostname;
  return `${candidate.family}:${address}`;
}

export function race<T extends Socket>(options: ConnectionOptions, create: (candidate: Candidate) => T, ready: 'connect' | 'secureConnect', time: Clock = clock): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const config = timing(options);
    const { hostname, family } = destination(options);
    const started = time.now();
    const deadline = started + config.connectTimeoutMs;
    const controller = new AbortController();
    const families: Family[] = family ? [family] : [6, 4];
    const complete = new Set<Family>();
    const addresses = new Map<Family, Candidate[]>([[6, []], [4, []]]);
    const attempted = new Set<string>();
    const active = new Map<T, () => void>();
    const errors: Error[] = [];
    let done = false;
    let lastStart = -Infinity;
    let firstFamily: Family | undefined;
    let lastFamily: Family | undefined;
    let initialCount = 0;
    let accelerated = false;
    let resolutionUntil: number | undefined;
    let timer: unknown;
    let unsubscribe: void | (() => void);

    const emit = (event: Omit<DiagnosticEvent, 'elapsedMs'>) => {
      // Diagnostic observers cannot change connection ownership by throwing.
      try { options.onDiagnostic?.(Object.freeze({ ...event, candidate: event.candidate && Object.freeze({ ...event.candidate }), elapsedMs: time.now() - started })); } catch { /* observer only */ }
    };
    const clearTimer = () => { if (timer !== undefined) time.clear(timer); timer = undefined; };
    const discard = (socket: T) => {
      // Errors already queued by a failed/cancelled socket may arrive before
      // close. Keep a guard for that interval, then release it.
      const ignore = () => {};
      socket.on('error', ignore);
      socket.once('close', () => socket.removeListener('error', ignore));
      socket.destroy();
    };
    const dispose = (winner?: T) => {
      clearTimer();
      options.signal?.removeEventListener('abort', cancel);
      controller.abort();
      try { unsubscribe?.(); } catch { /* cleanup must not prevent settlement */ }
      for (const [socket, detach] of active) {
        detach();
        if (socket !== winner) discard(socket);
      }
      active.clear();
    };
    const fail = (error: Error, cancelled = false) => {
      if (done) return;
      done = true;
      dispose();
      if (cancelled) emit({ type: 'cancellation', code: errorCode(error) });
      reject(error);
    };
    const cancel = () => fail(abortError(options.signal?.reason), true);
    const expired = () => {
      if (time.now() < deadline) return false;
      fail(new ConnectionError(errors, 'ETIMEDOUT', true), true); return true;
    };
    const pending = (f: Family) => addresses.get(f)!.filter(c => !attempted.has(key(c)));
    const next = (): Candidate | undefined => {
      const six = pending(6), four = pending(4);
      if (!firstFamily) {
        if (six.length) return six[0];
        if (!four.length) return;
        if (families.includes(6) && !complete.has(6)) {
          resolutionUntil ??= time.now() + config.resolutionDelayMs;
          if (time.now() < resolutionUntil) return;
        }
        return four[0];
      }
      const target = initialCount < config.firstAddressFamilyCount ? firstFamily : lastFamily === 6 ? 4 : 6;
      return (target === 6 ? six[0] ?? four[0] : four[0] ?? six[0]);
    };
    const launch = (candidate: Candidate) => {
      lastStart = time.now();
      accelerated = false;
      attempted.add(key(candidate));
      firstFamily ??= candidate.family;
      lastFamily = candidate.family;
      initialCount++;
      emit({ type: 'attempt', candidate });
      if (done || expired()) return;
      let socket: T;
      try { socket = create(candidate); } catch (cause) {
        errors.push(new AttemptError(candidate, options.port, asError(cause)));
        emit({ type: 'failure', candidate, code: errorCode(asError(cause)) });
        accelerated = true;
        return;
      }
      // A user hook may have aborted synchronously during socket creation.
      if (done) { discard(socket); return; }
      let finished = false;
      const detach = () => {
        socket.removeListener(ready, success);
        socket.removeListener('error', failure);
        socket.removeListener('close', closed);
        socket.removeListener('timeout', timeout);
      };
      const failure = (cause: Error, alreadyClosed = false) => {
        if (finished || done) return;
        finished = true;
        detach(); active.delete(socket);
        if (alreadyClosed) socket.destroy(); else discard(socket);
        errors.push(new AttemptError(candidate, options.port, cause));
        emit({ type: 'failure', candidate, code: errorCode(cause) });
        accelerated = true;
        pump();
      };
      const closed = () => failure(Object.assign(new Error('Closed before readiness'), { code: 'ECONNRESET' }), true);
      const timeout = () => options.onTimeout?.(socket);
      const success = () => {
        if (finished || done) { socket.destroy(); return; }
        if (expired()) return;
        finished = true; done = true;
        dispose(socket);
        emit({ type: 'selection', candidate });
        // Selection observers may abort at the ownership boundary.
        if (options.signal?.aborted) { discard(socket); reject(abortError(options.signal.reason)); }
        else resolve(socket);
      };
      active.set(socket, detach);
      socket.once(ready, success).once('error', failure).once('close', closed).on('timeout', timeout);
      if (options.socketTimeoutMs) socket.setTimeout(options.socketTimeoutMs);
      if (socket.destroyed) closed();
    };
    function pump(): void {
      if (done || expired()) return;
      clearTimer();
      const candidate = next();
      const due = lastStart + (accelerated ? config.minAttemptDelayMs : config.attemptDelayMs);
      if (candidate && time.now() >= due) {
        launch(candidate);
        if (done) return;
      }
      if (families.every(f => complete.has(f)) && !pending(4).length && !pending(6).length && !active.size) {
        fail(exhaustedError(errors)); return;
      }
      let wake = deadline;
      if (next()) wake = Math.min(wake, lastStart + (accelerated ? config.minAttemptDelayMs : config.attemptDelayMs));
      else if (!firstFamily && resolutionUntil !== undefined && resolutionUntil > time.now()) wake = Math.min(wake, resolutionUntil);
      timer = time.set(pump, Math.max(0, wake - time.now()));
    }
    const update = (value: ResolutionUpdate) => {
      if (done || expired() || !families.includes(value.family) || complete.has(value.family)) return;
      const unique = new Map<string, Candidate>();
      for (const address of value.addresses) {
        if (isIP(address) !== value.family) continue;
        const candidate: Candidate = { address, family: value.family };
        if (!unique.has(key(candidate))) unique.set(key(candidate), candidate);
      }
      addresses.set(value.family, [...unique.values()]);
      if (value.error) errors.push(value.error);
      if (value.complete) complete.add(value.family);
      emit({ type: 'resolution', family: value.family, count: unique.size, code: value.error && errorCode(value.error) });
      pump();
    };
    if (options.signal?.aborted) { cancel(); return; }
    options.signal?.addEventListener('abort', cancel, { once: true });
    pump();
    const literal = isIP(hostname);
    if (literal) {
      for (const f of families) update({ family: f, addresses: f === literal ? [hostname] : [], complete: true });
    } else {
      try {
        unsubscribe = (options.resolver ?? createSystemResolver(options.lookup, options.hints))({ hostname, families, signal: controller.signal }, update);
        if (done) { try { unsubscribe?.(); } catch { /* cleanup */ } }
      } catch (error) { fail(asError(error)); }
    }
  });
}
