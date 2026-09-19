# Go 1.27.1

Pinned binary: official `go1.27.1 linux/amd64` archive. Matching source tag: [`862c888e612ac346c7c4d99c9392bdfd265f33b0`](https://github.com/golang/go/tree/862c888e612ac346c7c4d99c9392bdfd265f33b0). The executable helper is `scripts/audit-go.go`. It uses `net.Dialer{FallbackDelay: 50ms, Resolver: &net.Resolver{PreferGo: true, Dial: local UDP DNS}}`, a 2 s HTTP dial context, and a 1 s TLS context. The 50 ms value is probe configuration; Go's [default is 300 ms](https://github.com/golang/go/blob/862c888e612ac346c7c4d99c9392bdfd265f33b0/src/net/dial.go#L295-L301).

## Executable observations

Run `GO_BIN=/path/to/go1.27.1/bin/go node scripts/audit-comparators.mjs`; [probe-results.json](probe-results.json) records the exact build and probe commands and `httptrace.ConnectStart` timestamps.

| Probe | Observation |
| --- | --- |
| `mixed` | Refused `::1` and then successful `127.0.0.1` were started about 5 ms and 6 ms after invocation. |
| `same` | Refused `127.0.0.2` and then successful `127.0.0.1` were started about 1 ms after invocation. |
| `late6` | A answer was immediate; AAAA was withheld for 80 ms. The first TCP attempt was still IPv6 at about 82 ms and IPv4 followed in the same millisecond. The dial therefore waited for the delayed family in this setup. |
| `tls` | TCP reached the stalled `127.0.0.2`; `HandshakeContext` ended at its 1 s context deadline. No second address was attempted after TCP connected. |
| `tls-slow` | TCP reached `127.0.0.2`; the delayed first TLS handshake completed in 307 ms and the helper returned that address. The fast second address was not attempted. |

The Go helper closes any connection it receives; its context deadline bounds DNS, TCP and the explicitly added TLS handshake. The TLS step is helper code around `DialContext`, not built-in TLS racing by `net.Dialer`.

## Source and upstream tests

[DialContext](https://github.com/golang/go/blob/862c888e612ac346c7c4d99c9392bdfd265f33b0/src/net/dial.go#L532-L562) first resolves an address list, partitions primary and fallback families, then invokes [`dialParallel`](https://github.com/golang/go/blob/862c888e612ac346c7c4d99c9392bdfd265f33b0/src/net/dial.go#L655-L730). That function runs at most two family racers; each runs [`dialSerial`](https://github.com/golang/go/blob/862c888e612ac346c7c4d99c9392bdfd265f33b0/src/net/dial.go#L730-L775). A primary error starts the fallback immediately, and the first successful connection wins. Go's [parallel dial test](https://github.com/golang/go/blob/862c888e612ac346c7c4d99c9392bdfd265f33b0/src/net/dial_test.go#L179-L316) injects slow and refused addresses, cancellation, and timer cases; [spurious-connection test](https://github.com/golang/go/blob/862c888e612ac346c7c4d99c9392bdfd265f33b0/src/net/dial_test.go#L385-L480) checks two near-simultaneous successes and loser closure. These source tests support behavior that the local loopback probe cannot force deterministically.

## RFC level and library disposition

| Finding | RFC 8305 level | Disposition |
| --- | --- | --- |
| Go's observed late-AAAA dial waited for both families; this library starts from the available family, with a bounded IPv4-first window | [§3](https://datatracker.ietf.org/doc/html/rfc8305#section-3) **SHOULD NOT** wait for both answers | Library behavior is covered by [arrival-boundary and late-answer tests](regressions.md#scheduler-tests). Go's behavior is an executable observation for this resolver fixture, not a claim about all Go resolver configurations. |
| Go partitions into two family racers with serial addresses inside each; this library alternates remaining family candidates | [§4](https://datatracker.ietf.org/doc/html/rfc8305#section-4) family interleaving **SHOULD** follow sorting | Intentional library behavior; [same-family and first-family-count tests](regressions.md#scheduler-tests) cover it. |
| Go's 300 ms default and the probe's 50 ms override differ from this library's 250 ms default | §§5,8 recommend 250 ms, without requiring one fixed default | Permitted configuration difference; [timing tests](regressions.md#scheduler-tests) cover the library. |
| Go's rapid hard-failure fallthrough differs from this library's minimum spacing | §5 **MUST NOT** start the next attempt within 10 ms | The observed timestamps have millisecond resolution; source confirms immediate fallback. This library's [spacing tests](regressions.md#scheduler-tests) assert the 10 ms floor. |
| Go returns at TCP readiness; this library's TLS API waits for authenticated TLS readiness | §5 generally counts TCP handshake as success; TLS is an API contract | Intentional, covered by [network TLS tests](regressions.md#network-tests). |
| Complete destination selection policy is outside this library | §4 RFC 6724 sorting **MUST** precede interleaving | Explicit limitation in [requirements matrix](../PROFILE.md); the README no longer claims full RFC conformance. |

The probe does not inject a slow viable TCP SYN, independently observe Go's internal loser file descriptors, or validate the full RFC 6724 destination policy.
