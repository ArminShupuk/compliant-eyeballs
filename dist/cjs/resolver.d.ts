import type { LookupFunction } from 'node:net';
import type { Resolver } from './types.js';
/** OS-backed lookups preserve hosts files and system name-service policy. */
export declare function createSystemResolver(lookup?: LookupFunction, hints?: number): Resolver;
export declare const systemResolver: Resolver;
