# Node.js 26.9.0

Pinned binary: official Node.js `v26.9.0 linux-x64`; matching tag [`b469d3fd9401ecbd5de334f4b7043dd0286e4a7b`](https://github.com/nodejs/node/tree/b469d3fd9401ecbd5de334f4b7043dd0286e4a7b). `net.getDefaultAutoSelectFamily()` returned `true` and `net.getDefaultAutoSelectFamilyAttemptTimeout()` returned `500` ms. The `scripts/audit-node.mjs` explicitly uses `autoSelectFamily: true`, a 50 ms attempt timeout, and a per-socket `lookup`. Installed NVM Node 24.21.0 was also run and gave the same probe outcomes.

## Executable observations

Run `NODE_BIN=/path/to/node-v26.9.0/bin/node node scripts/audit-comparators.mjs`; [probe-results.json](probe-results.json) contains complete commands and the socket's `autoSelectFamilyAttemptedAddresses`.

| Probe | Observation |
| --- | --- |
| `mixed` | Attempted `::1`, then `127.0.0.1`; TCP selected IPv4. |
| `same` | Attempted refused `127.0.0.2`, then live `127.0.0.1`; TCP selected the second IPv4 address. |
| `late6` | The injected `lookup` returned IPv4 first in one callback; only IPv4 was attempted. This tests batch order, not a separately arriving AAAA reply. |
| `tls` | TCP connected to stalled `127.0.0.2`; the helper's 1 s socket timeout ended the TLS attempt without trying live `127.0.0.1`. |
| `tls-slow` | The first address `127.0.0.2` completed TLS in about 320 ms; the socket reported only that attempted address. NVM Node 24.21.0 agreed. The fast second address was not attempted. |

## Source and upstream tests

[Node's multi-address lookup path](https://github.com/nodejs/node/blob/b469d3fd9401ecbd5de334f4b7043dd0286e4a7b/lib/net.js#L1815-L1918) waits for one `lookup(..., all:true)` callback, filters duplicates, and alternates families based on the first valid address. [Attempt setup](https://github.com/nodejs/node/blob/b469d3fd9401ecbd5de334f4b7043dd0286e4a7b/lib/net.js#L1417-L1516) starts the next address immediately after a hard error, while a pending attempt gets a timer. [Timeout handling](https://github.com/nodejs/node/blob/b469d3fd9401ecbd5de334f4b7043dd0286e4a7b/lib/net.js#L2075-L2131) closes the timed-out handle before advancing, so this is not a race that keeps every earlier TCP candidate viable. Values below 10 ms are [clamped](https://github.com/nodejs/node/blob/b469d3fd9401ecbd5de334f4b7043dd0286e4a7b/lib/net.js#L1697-L1711). Upstream's [auto-selection test](https://github.com/nodejs/node/blob/b469d3fd9401ecbd5de334f4b7043dd0286e4a7b/test/parallel/test-net-autoselectfamily.js) asserts attempted-address order, error fallback and single-family cases. The code and upstream tests are source evidence; the local probe observed only its fixture cases.

## RFC level and library disposition

| Finding | RFC 8305 level | Disposition |
| --- | --- | --- |
| Node waits for a single batch lookup; this library starts independent IPv6/IPv4 lookup jobs and handles late snapshots | [§3](https://datatracker.ietf.org/doc/html/rfc8305#section-3) **SHOULD NOT** wait for both families | Library's [resolution tests](regressions.md#scheduler-tests) cover both arrival orders and late updates. Node's custom-lookup probe cannot observe independent DNS arrival. |
| Node's 500 ms default and this library's 250 ms default differ | [§§5,8](https://datatracker.ietf.org/doc/html/rfc8305#section-8) recommend 250 ms, not a universal fixed value | Permitted default choice, covered by [timing tests](regressions.md#scheduler-tests). |
| Node can advance immediately after a hard error; this library enforces a configurable floor of at least 10 ms | [§5](https://datatracker.ietf.org/doc/html/rfc8305#section-5) **MUST NOT** start a subsequent attempt within 10 ms | Library [failure-spacing tests](regressions.md#scheduler-tests) assert the floor. The probe reports address order, not sub-millisecond start timing. |
| Node closes a timed-out TCP handle before starting the next; this library keeps slow earlier candidates active | §5 says later starts do not affect previous attempts | Library [slow-candidate and winner tests](regressions.md#scheduler-tests) and [slow TLS test](regressions.md#network-tests) preserve the candidate until settlement. |
| Node's `tls.connect` first establishes TCP with the selected address; this library races until authenticated TLS readiness | §5 generally treats a TCP handshake as success; TLS readiness is an API contract | Intentional difference, covered by [TLS fallback tests](regressions.md#network-tests). |
| Full RFC 6724 destination policy is absent from this library | [§4](https://datatracker.ietf.org/doc/html/rfc8305#section-4) sorting **MUST** precede interleaving | Explicit [requirements-matrix limitation](../PROFILE.md) and narrowed README claim. |

The original four-comparator fixture cannot emulate a slow viable TCP SYN. The
additional [timeout comparison](timeouts.md) now exercises a slow viable TCP
connection and delayed fallback on Linux with Node 24.21.0 and 26.9.0. Neither
fixture establishes simultaneous TCP winners or complete network policy. Native Node timeout/cancellation semantics must not be inferred from this library's own deadline and ownership contract.
