import type { LookupFunction, Socket, BlockList } from 'node:net';
import type { ConnectionOptions as NodeTlsOptions } from 'node:tls';

export type Family = 4 | 6;
export interface Candidate { address: string; family: Family }
/** Each update replaces the unattempted candidates for this family. */
export interface ResolutionUpdate {
  family: Family;
  addresses: readonly string[];
  /** No further updates for this family. Empty results are definitive negatives. */
  complete?: boolean;
  error?: Error;
}
export interface ResolutionRequest {
  hostname: string;
  families: readonly Family[];
  signal: AbortSignal;
}
/** Return an optional unsubscribe function. Observe signal for cancellation. */
export type Resolver = (request: ResolutionRequest, update: (value: ResolutionUpdate) => void) => void | (() => void);
export interface TimingOptions {
  resolutionDelayMs?: number;
  attemptDelayMs?: number;
  minAttemptDelayMs?: number;
  maxAttemptDelayMs?: number;
  firstAddressFamilyCount?: number;
  connectTimeoutMs?: number;
}
export interface DiagnosticEvent {
  type: 'resolution' | 'attempt' | 'failure' | 'selection' | 'cancellation';
  elapsedMs: number;
  candidate?: Candidate;
  family?: Family;
  count?: number;
  code?: string;
}
export interface ConnectionOptions extends TimingOptions {
  hostname: string;
  port: number;
  family?: 0 | Family;
  localAddress?: string;
  localPort?: number;
  signal?: AbortSignal;
  resolver?: Resolver;
  lookup?: LookupFunction;
  hints?: number;
  noDelay?: boolean;
  keepAlive?: boolean;
  keepAliveInitialDelay?: number;
  /** Inactivity notification only; distinct from the overall connection deadline. */
  socketTimeoutMs?: number;
  onTimeout?: (socket: Socket) => void;
  onDiagnostic?: (event: Readonly<DiagnosticEvent>) => void;
  blockList?: BlockList;
}
export type TlsOptions = Omit<NodeTlsOptions, 'host' | 'port' | 'socket' | 'path' | 'lookup' | 'family' | 'localAddress' | 'localPort' | 'signal' | 'timeout'>;
export interface TlsConnectionOptions extends ConnectionOptions { tls?: TlsOptions }
