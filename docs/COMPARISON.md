# Package comparison

Verified 2026-09-19 against the npm registry metadata and the published tarball
source. Release dates do not establish abandonment or maintainer availability.
No other package's source is included in this implementation.

| Package / inspected version | npm publication | Verified architecture |
| --- | --- | --- |
| [happy-eyeballs 0.0.15](https://www.npmjs.com/package/happy-eyeballs/v/0.0.15) | 2021-10-01 | Native agent subclasses plus explicit patch/unpatch and a side-effect `eye-patch` entry; combined lookup awaited before scheduling; last-success family cache; scheduled batches |
| [@balena/happy-eyeballs 0.0.6](https://www.npmjs.com/package/@balena/happy-eyeballs/v/0.0.6) | 2021-11-30 | Native agent subclasses bind their own createConnection; combined lookup and family cache; published implementation uses tslib/abort-controller |
| [@balena/eye-patch 1.0.0](https://www.npmjs.com/package/@balena/eye-patch/v/1.0.0) | 2021-09-30 | Main `eye-patch.js` invokes `patch.patch()` on import, changing native agent prototypes |
| compliant-eyeballs 1.0.0 | — | Separate OS family jobs and incremental snapshots; deadline/abort-owned race; staggered overlapping attempts with minimum spacing; TCP/TLS-ready APIs; native request lifecycle integration; structural Undici adapter; no preferred-family cache or global patch |

Primary repositories: [happy-eyeballs](https://github.com/zwhitchcox/happy-eyeballs),
[balena happy-eyeballs](https://github.com/balena-io-modules/happy-eyeballs),
[balena eye-patch](https://github.com/balena-io-modules/eye-patch).
The comparisons concern the exact npm artifacts, not unreviewed current branches.

These are architectural comparisons, not throughput or Internet-wide latency
benchmarks. In this package's loopback test, a viable TLS handshake delayed by
120ms survives a fallback launched after 20ms with an explicit 10ms minimum.
Deterministic hard-failure tests start at 0/100/200ms by default and at
0/10/20ms when the caller selects the 10ms minimum.
