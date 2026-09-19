import { lookup as systemLookup } from 'node:dns';
import { asError } from './errors.js';
/** OS-backed lookups preserve hosts files and system name-service policy. */
export function createSystemResolver(lookup = systemLookup, hints) {
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
                    update({ family, addresses: [], complete: true, error: asError(error) });
            }
        }
        return () => { subscribed = false; };
    };
}
export const systemResolver = createSystemResolver();
//# sourceMappingURL=resolver.js.map