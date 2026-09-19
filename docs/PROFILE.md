# RFC 8305 TCP/TLS implementation

<!-- Conformance sections: 3, 4, 5, 6, 8 -->

Review baseline: [RFC 8305](https://www.rfc-editor.org/rfc/rfc8305) and
[v3 draft -04](https://datatracker.ietf.org/doc/html/draft-ietf-happy-happyeyeballs-v3-04),
confirmed as the latest published draft on 2026-09-19. The draft is work in
progress. The TCP/TLS connection-attempt scheduler follows RFC 8305 Section 5,
and the Node.js socket layer implements the complete TCP/TLS connection race.
Full RFC 8305 conformance is not claimed: §4 requires RFC 6724 destination sorting. That
depends on route, source-address and policy state that portable Node.js APIs
do not expose. The complete RFC therefore has a platform-level requirement
beyond this library. Levels below describe the source; profile choices are not
RFC mandates.
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119.html) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174.html) define normative keywords.

| Area | Source section | Source level / profile choice | Status and evidence |
| --- | --- | --- | --- |
| Independent asynchronous family results | RFC §3; draft §4.2 | SHOULD | Implemented: [scheduler tests](audits/regressions.md#scheduler-tests), IPv6 immediate and both arrival orders |
| IPv4-first resolution window | RFC §3; draft §4.2 | SHOULD; 50ms recommendation | Implemented: boundary 0/49/50/51ms and negative-result tests |
| All addresses and interleaving | RFC §4; draft §5.3 | SHOULD; first-family count MAY | Implemented within this profile: same-family lists, canonical deduplication, configurable initial count |
| Complete destination selection policy | RFC §4 / RFC 6724 §6; draft §5.3 | MUST in RFC 8305 | Platform-level: OS order retained within each family; complete cross-family sorting requires route, source-address and administrative policy data unavailable through portable Node.js APIs |
| Overlapping attempts | RFC §5; draft §6 | Prior attempts unaffected; stagger SHOULD | Implemented: slow viable TCP/TLS survives later attempts, [scheduler](audits/regressions.md#scheduler-tests) and [loopback](audits/regressions.md#network-tests) |
| Minimum spacing | RFC §5; draft §6 | MUST NOT start within 10ms; 100ms recommended minimum | Implemented: default 100ms; explicit 10ms opt-in; synchronous/asynchronous failure and delayed-loop tests |
| Attempt and maximum delays | RFC §§5,8 | 250ms default recommended; upper bound SHOULD, 2s recommended | Implemented; configuration validation rejects invalid values without treating recommendations as mandatory caps |
| Extend delay after TCP progress while TLS is pending | Draft §6.1 | SHOULD | Not implemented: the fixed attempt timer can start another candidate while an earlier TLS handshake is progressing |
| Winner and loser ownership | RFC §5; draft §6.1 | Loser cancellation SHOULD; TLS readiness is the profile's success criterion | Implemented: near-simultaneous winners, stalled TLS, certificate/ALPN tests |
| Updated candidate sets | RFC §6; draft §§4.3–4.4 | Removed active attempts SHOULD continue; removed unattempted addresses SHOULD be dropped | Implemented through replacement snapshots; active sockets survive removals; no autonomous TTL monitoring |
| Hosts files and system name service | OS resolver delegation | Profile choice | `dns.lookup` per family; custom-lookup launch/cancel tests; OS hosts policy not reimplemented |
| Abort and overall deadline | Node lifecycle / profile choice | Required by this API | Implemented before resolution, during TLS, queued requests and handoff; native/connector cancellation tests |
| Native request timeout notification | Node HTTP/socket behavior | API compatibility requirement | [Agent tests](audits/regressions.md#agent-tests): notification alone leaves race alive; explicit destroy and overall deadline close it |
| TLS identity, custom CA, mTLS, SNI, ALPN, sessions | Node TLS; draft §6.1 | Profile authentication requirement | [Network tests](audits/regressions.md#network-tests), including rejected IP mismatch and TLS 1.2/1.3 cache isolation |
| HTTP/2 and HTTP/1.1 handoff | draft §6.2; client API | Profile optional integrations | Native H2 tests; Undici 8.x H2 fixture and Undici 6.x–8.x direct HTTP/1.1 fixture; [minor-version results](undici-minor-results.json) and [limits](COMPATIBILITY.md) |
| Proxy transport boundary | API integration choice | Optional hook, not RFC 8305 proxy support | Raw TCP/TLS can race the proxy endpoint; direct adapters reject proxy settings and delegate an existing tunnel only to its explicit owner; [network tests](audits/regressions.md#network-tests) and [agent tests](audits/regressions.md#agent-tests) |
| DNS transport selection | RFC §3.1; draft §4.5 | SHOULD recommendations | Delegated to OS; not implemented by library |
| Optimistic DNS, TTL monitoring | draft §§4.2–4.4, §7 | Draft behaviors | Not implemented; resolver interface only accepts externally supplied updates |
| NAT64/PREF64 and local synthesis | RFC §7; draft §8 | Conditional SHOULD recommendations | Platform-level: automatic prefix discovery needs per-interface DNS and network state; this library does not synthesize addresses |
| SVCB/HTTPS, ECH, QUIC, protocol/priority groups | draft §§4–6 | Conditional draft requirements | Not implemented; no v3-compliance claim |
| Application failure after establishment | RFC §9.2 | Outside connection-race scope | Caller owns retries and protocol state; no replay of uploads or application requests |

No cached preferred family or network-interface heuristic is used. Per-family OS
ordering is not evidence of implementing all RFC 6724 rules. Success tests establish
the listed behavior under controlled conditions, not universal network reliability.

Tests labeled `RFC 8305 §…` are conformance checks for the cited section; the
`scripts/check-test-classification.mjs` requires a
matching matrix row. Tests labeled `Contract` exercise the library API and
consumer protocols, including [Node net](https://nodejs.org/api/net.html),
[Node TLS](https://nodejs.org/api/tls.html),
[Node HTTP agents](https://nodejs.org/api/http.html#class-httpagent),
[Node HTTP/2](https://nodejs.org/api/http2.html),
[Undici](https://undici.nodejs.org/), and
[WebDAV](https://www.rfc-editor.org/rfc/rfc4918).
