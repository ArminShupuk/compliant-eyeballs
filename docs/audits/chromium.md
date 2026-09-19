# Chromium / Chrome for Testing 153.0.8010.52

Pinned binary: Chrome for Testing `153.0.8010.52` for Linux x64 from the [stable-channel manifest](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json). Matching Chromium tag resolves to [`78e5e45d4bb41035e17ea4da2cc257f496416ac9`](https://chromium.googlesource.com/chromium/src/+/78e5e45d4bb41035e17ea4da2cc257f496416ac9). The build's [feature declarations](https://chromium.googlesource.com/chromium/src/+/78e5e45d4bb41035e17ea4da2cc257f496416ac9/net/base/features.cc#114) enable Happy Eyeballs v2 by default for desktop, while v3, adjusted fallback delay and RTT-based delay are disabled by default. The probe did not override these feature flags.

## Executable observations

Run `CHROME_BIN=/path/to/chrome node scripts/audit-comparators.mjs`. The fixture starts a fresh external profile for each case, maps only `chrome.he-audit.test` with `--host-resolver-rules`, maps all other names to `~NOTFOUND`, drives navigation over DevTools, closes the browser, and reads the target TCP endpoints from Chromium NetLog. [probe-results.json](probe-results.json) contains the exact flags, page result and NetLog summary. Full NetLogs and profiles stay outside the repository.

| Probe | Observation |
| --- | --- |
| `single-success` | Mapped `127.0.0.1`; page body was `ready`, and NetLog recorded the target TCP endpoint. |
| `single-failure` | Mapped refused `127.0.0.2`; Chrome displayed its connection-refused page, and NetLog recorded that endpoint. |
| `localhost-dual` | Mapped the test name to local `localhost`; NetLog recorded `::1` and `127.0.0.1` attempts, and the page succeeded via the live IPv4 listener. |
| `tls-stall` | Mapped one endpoint to the TCP listener that never begins TLS; the browser navigation was cancelled after about 1 s and NetLog recorded the stalled endpoint. It does not test a second TLS candidate. |

The `localhost-dual` rule receives the platform's localhost address set; it does not control A/AAAA arrival order or RFC 6724 policy. NetLog may contain preconnect attempts as well as the navigation; only target endpoint presence is concluded here.

## Source and upstream tests

The versioned [`TcpConnectJob`](https://chromium.googlesource.com/chromium/src/+/78e5e45d4bb41035e17ea4da2cc257f496416ac9/net/socket/tcp_connect_job.h#80) defines a 300 ms IPv6 fallback constant. Its [service-endpoint update path](https://chromium.googlesource.com/chromium/src/+/78e5e45d4bb41035e17ea4da2cc257f496416ac9/net/socket/tcp_connect_job.cc#261) can advance while resolver results change. Its [slow path](https://chromium.googlesource.com/chromium/src/+/78e5e45d4bb41035e17ea4da2cc257f496416ac9/net/socket/tcp_connect_job.cc#448) creates a separate IPv4 connector; the [fallback calculation](https://chromium.googlesource.com/chromium/src/+/78e5e45d4bb41035e17ea4da2cc257f496416ac9/net/socket/tcp_connect_job.cc#475) can use feature-gated values, but the defaults above apply here. Chromium's extensive [connect-job unit tests](https://chromium.googlesource.com/chromium/src/+/78e5e45d4bb41035e17ea4da2cc257f496416ac9/net/socket/tcp_connect_job_unittest.cc) cover delayed endpoints, crypto readiness, family fallback, updates, and two connectors with mocked sockets and time. These are source/test inferences and are distinct from the executable NetLog observations.

## RFC level and library disposition

| Finding | RFC 8305 level | Disposition |
| --- | --- | --- |
| Chromium's default 300 ms IPv6 fallback differs from this library's 250 ms candidate delay | [§§5,8](https://datatracker.ietf.org/doc/html/rfc8305#section-8) recommend 250 ms, not one mandatory default | Permitted profile choice; [timing tests](regressions.md#scheduler-tests) cover the library. The loopback probe cannot measure the slow-path timer because `::1` refused immediately. |
| Chromium can consume intermediate service-endpoint updates; this library consumes replacement snapshots supplied by a custom resolver | [§3](https://datatracker.ietf.org/doc/html/rfc8305#section-3) asynchronous family handling **SHOULD** avoid waiting, and [§6](https://datatracker.ietf.org/doc/html/rfc8305#section-6) addresses updates | Library [late-resolution and candidate-update tests](regressions.md#scheduler-tests) cover its public resolver contract. It does not autonomously monitor DNS TTLs. |
| Chromium's internal connector structure and browser TLS stack differ from this library's socket-level TLS winner criterion | §5 loser cancellation **SHOULD** follow success; TLS readiness is this library's API contract | Library [TLS readiness, slow candidate and abort tests](regressions.md#network-tests) plus [winner tests](regressions.md#scheduler-tests) cover ownership. This browser probe does not establish multi-address TLS fallback. |
| Full destination sorting is not established by NetLog address order | [§4](https://datatracker.ietf.org/doc/html/rfc8305#section-4) RFC 6724 sorting **MUST** occur before family interleaving | This library's known limitation is explicit in the [matrix](../PROFILE.md) and README. No comparator's observed ordering is treated as proof of complete sorting. |

Chromium was executable in headless mode and all four navigations were driven through DevTools. This local fixture cannot inject separate A/AAAA timings into Chrome's resolver, emulate a slow viable TCP SYN, or inspect individual loser socket ownership from NetLog alone.
