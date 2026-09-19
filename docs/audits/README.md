# Implementation comparisons

Audit frozen on 2026-09-19. [RFC 8305](https://datatracker.ietf.org/doc/html/rfc8305) is the normative reference. Comparator defaults are recorded as implementation choices, not RFC requirements. Each report separates executable observations from source and upstream-test inferences.

| Comparator | Stable binary used | Matching source commit | Report |
| --- | --- | --- | --- |
| curl | 8.22.0, locally built with OpenSSL 3.5.7 | [`01346829096c61b372692f6dc43ffa778c6caccd`](https://github.com/curl/curl/tree/01346829096c61b372692f6dc43ffa778c6caccd) | [curl](curl.md) |
| Go | 1.27.1 linux/amd64 | [`862c888e612ac346c7c4d99c9392bdfd265f33b0`](https://github.com/golang/go/tree/862c888e612ac346c7c4d99c9392bdfd265f33b0) | [Go](go.md) |
| Node.js | 26.9.0 linux/x64 | [`b469d3fd9401ecbd5de334f4b7043dd0286e4a7b`](https://github.com/nodejs/node/tree/b469d3fd9401ecbd5de334f4b7043dd0286e4a7b) | [Node.js](node.md) |
| Chrome for Testing | 153.0.8010.52 linux64 | [`78e5e45d4bb41035e17ea4da2cc257f496416ac9`](https://chromium.googlesource.com/chromium/src/+/78e5e45d4bb41035e17ea4da2cc257f496416ac9) | [Chromium](chromium.md) |

The stable versions came from the projects' [curl release page](https://curl.se/), [Go release page](https://go.dev/doc/devel/release), [Node release blog](https://nodejs.org/en/blog), and [Chrome for Testing stable channel](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json). The installed distro curl 8.14.1 and NVM Node 24.21.0 were run as secondary checks. Their distribution/build provenance differs from the pinned stable source commits and is not used for source conclusions.

## Reproduce the probes

Run `node scripts/audit-comparators.mjs` after setting `AUDIT_CACHE`, `CURL_BIN`, `GO_BIN`, `NODE_BIN`, and `CHROME_BIN` to binaries outside the repository. The commands and results are in [probe-results.json](probe-results.json); binary
and cache paths are replaced by the corresponding environment-variable placeholders.
Set optional `NVM_NODE_BIN` and `INSTALLED_CURL_BIN` for the secondary binaries. The Go helper is built from `scripts/audit-go.go`; Node's helper is `scripts/audit-node.mjs`. Browser profiles and full NetLogs remain in the external cache. No system DNS setting or hosts file is changed.

The shared fixture serves HTTP/TLS on `127.0.0.1`; `127.0.0.2` refuses HTTP or accepts TCP with a stalled or 300 ms delayed TLS handshake. `::1` refuses HTTP. A local UDP DNS responder supplies Go's A/AAAA records, including an 80 ms late AAAA answer. curl uses `--resolve`, Node uses a per-socket `lookup`, and Chromium uses per-process host resolver rules with all other hostnames mapped to `~NOTFOUND`. Chromium is driven through DevTools and its attempted target endpoints are read from NetLog.

| Scenario | Directly observable | Limit |
| --- | --- | --- |
| Mixed and same-family hard failure | Attempted endpoints in curl verbose output, Go `ConnectStart`, Node socket diagnostics, Chromium NetLog; selected address or page result | Loopback refusal is immediate, so it does not measure a slow viable TCP SYN |
| Late AAAA | Go resolver and attempt timestamps | curl's static `--resolve`, Node's single `lookup(..., all:true)` callback, and Chromium host rules cannot expose separate family arrival with this fixture |
| TLS stall and deadline | curl/Go/Node remain on the first TCP-connected endpoint until the 1 s deadline; Chromium's stalled TLS navigation is stopped by DevTools | Chromium gets one mapped endpoint in this case; no claim about multi-address TLS fallback |
| Slow viable TLS | curl/Go/Node complete the delayed first handshake after about 300 ms; this library's TLS regression selects a later fast address after its configured 50 ms delay | The delayed TLS handshake is observable; it does not emulate a slow TCP SYN or prove browser TLS fallback |
| Cancellation and winner cleanup | Go context, Node socket timeout, curl `--max-time`, Chromium `Browser.close`; library tests verify owned socket cleanup | Process and API cancellation mechanisms differ; loopback does not make simultaneous TCP winners deterministic |

Connection timing, exact minimum spacing under slow TCP, and true simultaneous winners therefore also use upstream synthetic tests and this library's deterministic scheduler tests. See [requirements matrix](../PROFILE.md), [scheduler tests](regressions.md#scheduler-tests), [network tests](regressions.md#network-tests), [agent tests](regressions.md#agent-tests), and [TLS event-order test](regressions.md#tls-event-order-tests).

## Conformance conclusion

[RFC 8305 §4](https://datatracker.ietf.org/doc/html/rfc8305#section-4) **MUST** sort received addresses using RFC 6724 destination selection before family interleaving. This library does not implement that full platform policy. The README and requirements matrix explicitly limit the claim to the connection-attempt procedure; full RFC 8305 conformance is not claimed. The comparison did not establish that any comparator's defaults are RFC mandates. All other differences identified below are either tested profile choices or stated platform/API limits.

The final audit adds [measured TCP timeout comparisons](timeouts.md), a
[regression index](regressions.md) and the [whole-library review](final.md).
