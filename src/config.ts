import { isIP } from 'node:net';
import type { ConnectionOptions, TimingOptions } from './types.js';

export const defaults: Readonly<Required<TimingOptions>> = Object.freeze({
  resolutionDelayMs: 50, attemptDelayMs: 250, minAttemptDelayMs: 100,
  maxAttemptDelayMs: 2000, firstAddressFamilyCount: 1, connectTimeoutMs: 20000,
});
export const MAX_TIMER_MS = 2 ** 31 - 1;
const proxyKeys = ['proxy', 'proxyEnv', 'proxyAgent', 'proxyUrl', 'proxyUri', 'httpProxy', 'httpsProxy', 'socksProxy', 'pac', 'pacUrl'];
const externalTransportKeys = ['httpSocket', 'socket', 'socketPath', 'path', 'createConnection'];
export function proxyOption(options: object): string | undefined {
  const values = options as Record<string, unknown>;
  return proxyKeys.find(key => values[key] !== undefined && values[key] !== null);
}
export function directOnlyError(key: string): TypeError {
  return new TypeError(`${key} is a proxy setting; use the owning proxy agent or dispatcher instead of a direct connection`);
}
export function requireDirect(options: object): void {
  const key = proxyOption(options);
  if (key) throw directOnlyError(key);
}
export function requireOwnedTransport(options: object): void {
  const values = options as Record<string, unknown>;
  const key = externalTransportKeys.find(name => values[name] !== undefined && values[name] !== null);
  if (key) throw new TypeError(`${key} requires its owning transport integration; direct connections do not use it`);
}
export function timing(options: TimingOptions): Required<TimingOptions> {
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof TimingOptions)[]) {
    if (options[key] !== undefined) result[key] = options[key];
    if (!Number.isFinite(result[key])) throw new RangeError(`${key} must be finite`);
  }
  if (result.resolutionDelayMs < 0) throw new RangeError('resolutionDelayMs must be nonnegative');
  if (result.minAttemptDelayMs < 10) throw new RangeError('minAttemptDelayMs must be at least 10');
  if (result.maxAttemptDelayMs < result.minAttemptDelayMs) throw new RangeError('maxAttemptDelayMs must be at least minAttemptDelayMs');
  if (result.attemptDelayMs < result.minAttemptDelayMs || result.attemptDelayMs > result.maxAttemptDelayMs) throw new RangeError('attemptDelayMs must lie between minAttemptDelayMs and maxAttemptDelayMs');
  if (!Number.isSafeInteger(result.firstAddressFamilyCount) || result.firstAddressFamilyCount < 1) throw new RangeError('firstAddressFamilyCount must be a positive integer');
  if (result.connectTimeoutMs <= 0 || result.connectTimeoutMs > MAX_TIMER_MS) throw new RangeError('connectTimeoutMs must be positive and at most 2147483647');
  return result;
}
export function destination(options: ConnectionOptions): { hostname: string; family: 0 | 4 | 6 } {
  requireDirect(options);
  requireOwnedTransport(options);
  for (const key of ['preferredFamily', 'defaultFamily']) {
    if (key in options) throw new TypeError(`${key} is not supported`);
  }
  const hostname = options.hostname?.replace(/^\[([^\]]+)\]$/, '$1');
  if (!hostname || typeof hostname !== 'string') throw new TypeError('hostname is required');
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new RangeError('port must be between 1 and 65535');
  if (options.family !== undefined && ![0, 4, 6].includes(options.family)) throw new RangeError('family must be 0, 4 or 6');
  const localFamily = options.localAddress === undefined ? 0 : isIP(options.localAddress);
  if (options.localAddress !== undefined && !localFamily) throw new TypeError('localAddress must be an IP literal');
  if (options.family && localFamily && options.family !== localFamily) throw new TypeError('family conflicts with localAddress');
  if (options.localPort !== undefined && (!Number.isInteger(options.localPort) || options.localPort < 0 || options.localPort > 65535)) throw new RangeError('invalid localPort');
  if (options.socketTimeoutMs !== undefined && (!Number.isFinite(options.socketTimeoutMs) || options.socketTimeoutMs < 0 || options.socketTimeoutMs > MAX_TIMER_MS)) throw new RangeError('invalid socketTimeoutMs');
  if (options.resolver && options.lookup) throw new TypeError('provide resolver or lookup, not both');
  return { hostname, family: (options.family || localFamily) as 0 | 4 | 6 };
}
