import { connect, isIP } from 'node:net';
import { connect as tlsConnect, checkServerIdentity } from 'node:tls';
import { destination, requireDirect, requireOwnedTransport } from './config.js';
import { race } from './race.js';
function tcpOptions(options, candidate) {
    if (options.blockList?.check(candidate.address, candidate.family === 6 ? 'ipv6' : 'ipv4')) {
        throw Object.assign(new Error(`IP(${candidate.address}) is blocked by net.BlockList`), { code: 'ERR_IP_BLOCKED' });
    }
    return {
        host: candidate.address, port: options.port, family: candidate.family, autoSelectFamily: false,
        localAddress: options.localAddress, localPort: options.localPort, blockList: options.blockList,
        noDelay: options.noDelay ?? true, keepAlive: options.keepAlive, keepAliveInitialDelay: options.keepAliveInitialDelay,
    };
}
export function connectTcp(options) { return tcp(options); }
export function tcp(options, observe) {
    return race(options, candidate => { const socket = connect(tcpOptions(options, candidate)); observe?.(socket); return socket; }, 'connect');
}
export function connectTls(options) { return secure(options); }
export function secure(options, observe) {
    try {
        requireDirect(options.tls ?? {});
        requireOwnedTransport(options.tls ?? {});
    }
    catch (error) {
        return Promise.reject(error);
    }
    return race(options, candidate => {
        const { hostname } = destination(options);
        const tls = options.tls ?? {};
        // Adapters may pass an object with extra HTTP fields. Never let a path,
        // supplied socket, lookup or signal bypass the race's transport ownership.
        const safe = { ...tls };
        for (const name of ['path', 'socket', 'socketPath', 'lookup', 'signal', 'timeout'])
            delete safe[name];
        const supplied = tls.servername ?? hostname;
        const servername = supplied && !isIP(supplied) ? supplied : '';
        const verify = tls.checkServerIdentity ?? checkServerIdentity;
        const socket = tlsConnect({
            ...safe, ...tcpOptions(options, candidate), servername,
            // Node would otherwise verify the raced address or SNI name. The destination
            // remains authoritative even when SNI is disabled or explicitly overridden.
            checkServerIdentity: (_name, certificate) => verify(hostname, certificate),
        });
        observe?.(socket);
        return socket;
    }, 'secureConnect');
}
//# sourceMappingURL=connect.js.map