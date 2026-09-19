"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectTcp = connectTcp;
exports.tcp = tcp;
exports.connectTls = connectTls;
exports.secure = secure;
const node_net_1 = require("node:net");
const node_tls_1 = require("node:tls");
const config_js_1 = require("./config.js");
const race_js_1 = require("./race.js");
function tcpOptions(options, candidate) {
    if (options.blockList?.check(candidate.address, candidate.family === 6 ? 'ipv6' : 'ipv4')) {
        throw Object.assign(new Error('Destination blocked'), { code: 'ERR_IP_BLOCKED' });
    }
    return {
        host: candidate.address, port: options.port, family: candidate.family, autoSelectFamily: false,
        localAddress: options.localAddress, localPort: options.localPort, blockList: options.blockList,
        noDelay: options.noDelay ?? true, keepAlive: options.keepAlive, keepAliveInitialDelay: options.keepAliveInitialDelay,
    };
}
function connectTcp(options) { return tcp(options); }
function tcp(options, observe) {
    return (0, race_js_1.race)(options, candidate => { const socket = (0, node_net_1.connect)(tcpOptions(options, candidate)); observe?.(socket); return socket; }, 'connect');
}
function connectTls(options) { return secure(options); }
function secure(options, observe) {
    try {
        (0, config_js_1.requireDirect)(options.tls ?? {});
        (0, config_js_1.requireOwnedTransport)(options.tls ?? {});
    }
    catch (error) {
        return Promise.reject(error);
    }
    return (0, race_js_1.race)(options, candidate => {
        const { hostname } = (0, config_js_1.destination)(options);
        const tls = options.tls ?? {};
        // Adapters may pass an object with extra HTTP fields. Never let a path,
        // supplied socket, lookup or signal bypass the race's transport ownership.
        const safe = { ...tls };
        for (const name of ['path', 'socket', 'socketPath', 'lookup', 'signal', 'timeout'])
            delete safe[name];
        const supplied = tls.servername ?? hostname;
        const servername = supplied && !(0, node_net_1.isIP)(supplied) ? supplied : '';
        const verify = tls.checkServerIdentity ?? node_tls_1.checkServerIdentity;
        const socket = (0, node_tls_1.connect)({
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