"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.systemResolver = void 0;
exports.createSystemResolver = createSystemResolver;
const node_dns_1 = require("node:dns");
const errors_js_1 = require("./errors.js");
/** OS-backed lookups preserve hosts files and system name-service policy. */
function createSystemResolver(lookup = node_dns_1.lookup, hints) {
    return ({ hostname, families, signal }, update) => {
        let subscribed = true;
        for (const family of families) {
            if (signal.aborted)
                break;
            try {
                lookup(hostname, { family, all: true, verbatim: true, hints }, (error, addresses) => {
                    if (!subscribed || signal.aborted)
                        return;
                    update({ family, addresses: error ? [] : typeof addresses === 'string' ? [addresses] : addresses.filter(a => a.family === family).map(a => a.address), complete: true, error: error ?? undefined });
                });
            }
            catch (error) {
                if (!signal.aborted && subscribed)
                    update({ family, addresses: [], complete: true, error: (0, errors_js_1.asError)(error) });
            }
        }
        return () => { subscribed = false; };
    };
}
exports.systemResolver = createSystemResolver();
//# sourceMappingURL=resolver.js.map