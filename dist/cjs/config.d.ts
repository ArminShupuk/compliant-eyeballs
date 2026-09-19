import type { ConnectionOptions, TimingOptions } from './types.js';
export declare const defaults: Readonly<Required<TimingOptions>>;
export declare const MAX_TIMER_MS: number;
export declare function proxyOption(options: object): string | undefined;
export declare function directOnlyError(key: string): TypeError;
export declare function requireDirect(options: object): void;
export declare function requireOwnedTransport(options: object): void;
export declare function timing(options: TimingOptions): Required<TimingOptions>;
export declare function destination(options: ConnectionOptions): {
    hostname: string;
    family: 0 | 4 | 6;
};
