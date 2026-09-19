import * as http from 'node:http';
import * as https from 'node:https';
import type { ConnectionOptions, TlsOptions } from './types.js';
export type AgentConnectionOptions = Omit<ConnectionOptions, 'hostname' | 'port'> & {
    tls?: TlsOptions;
};
export type HttpAgentOptions = http.AgentOptions & {
    connection?: AgentConnectionOptions;
};
export type HttpsAgentOptions = https.AgentOptions & {
    connection?: AgentConnectionOptions;
};
export declare class HappyEyeballsHttpAgent extends http.Agent {
    constructor({ connection, ...options }?: HttpAgentOptions);
}
export declare class HappyEyeballsHttpsAgent extends https.Agent {
    constructor({ connection, ...options }?: HttpsAgentOptions);
}
export declare function createHttpAgent(options?: HttpAgentOptions): HappyEyeballsHttpAgent;
export declare function createHttpsAgent(options?: HttpsAgentOptions): HappyEyeballsHttpsAgent;
