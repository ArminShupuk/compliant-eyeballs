# curl 8.22.0

Pinned binary: locally built `curl 8.22.0`, `libcurl/8.22.0`, OpenSSL 3.5.7, IPv6 and AsynchDNS enabled. Source: release tag [`curl-8_22_0` at `01346829096c61b372692f6dc43ffa778c6caccd`](https://github.com/curl/curl/tree/01346829096c61b372692f6dc43ffa778c6caccd). Build options included `--with-openssl --without-libpsl --disable-shared --disable-docs --disable-manual`; no Happy Eyeballs option was changed at build time. The installed Debian curl 8.14.1 (security-patched package) was run separately and agreed on the probed outcomes.

## Executable observations

Run `CURL_BIN=/path/to/curl-8.22.0/src/curl node scripts/audit-comparators.mjs`; [probe-results.json](probe-results.json) stores each complete argument list, exit status and verbose attempt lines. Probes set `--happy-eyeballs-timeout-ms 50`, `--max-time 2` for HTTP, `--max-time 1` for stalled TLS, and inject only fixture addresses through `--resolve`.

| Probe | Observation |
| --- | --- |
| `mixed` | Verbose output tried `::1`, then `127.0.0.1`; HTTP body `ready` came from `127.0.0.1`. |
| `same` | Tried refused `127.0.0.2`, then live `127.0.0.1`; request succeeded. |
| `late6` | Static `--resolve` list started with live IPv4 and succeeded. This does **not** test DNS arrival timing. |
| `tls` | TCP connected to `127.0.0.2`, where TLS never began; curl exited 28 at about 1 s and did not try the live second address. The installed 8.14.1 produced the same result. |
| `tls-slow` | The first address `127.0.0.2` accepted TCP, began TLS after 300 ms, and served `ready` at about 359 ms. The installed 8.14.1 also completed through that address. The fast second address was not selected. |

## Source and upstream tests

The [versioned option documentation](https://github.com/curl/curl/blob/01346829096c61b372692f6dc43ffa778c6caccd/docs/libcurl/opts/CURLOPT_HAPPY_EYEBALLS_TIMEOUT_MS.md) records a 200 ms default, IPv6-first alternation, continued older attempts, and a six-socket cap. The [IP racing filter](https://github.com/curl/curl/blob/01346829096c61b372692f6dc43ffa778c6caccd/lib/cf-ip-happy.c#L425-L510) starts the next address immediately when none is still ongoing, otherwise waits for its configured delay, alternates families, and prunes the oldest attempt at the cap. The [default setting](https://github.com/curl/curl/blob/01346829096c61b372692f6dc43ffa778c6caccd/lib/url.c#L417) is applied independently of this probe's 50 ms override. Upstream's [loopback/blackhole timer test](https://github.com/curl/curl/blob/01346829096c61b372692f6dc43ffa778c6caccd/tests/http/test_06_eyeballs.py#L106-L150) checks three attempts and timer traces, conditionally skipping networks that do not blackhole its test addresses; [unit2600](https://github.com/curl/curl/blob/01346829096c61b372692f6dc43ffa778c6caccd/tests/unit/unit2600.c#L336-L390) exercises the option. These are source/test evidence, not loopback observations in this audit.

## RFC level and library disposition

| Finding | RFC 8305 level | Disposition |
| --- | --- | --- |
| 200 ms curl default versus this library's 250 ms | [§§5,8](https://datatracker.ietf.org/doc/html/rfc8305#section-8) recommend 250 ms; configurable value is not a universal mandate | Intentional. [Configuration tests](regressions.md#scheduler-tests) retain the profile default and accepted range. |
| curl source can retry immediately after a hard failure; this library enforces 100 ms by default and at least 10 ms when configured | [§5](https://datatracker.ietf.org/doc/html/rfc8305#section-5) **MUST NOT** start a subsequent attempt within 10 ms | Library behavior asserted by [hard-failure spacing tests](regressions.md#scheduler-tests). The loopback trace did not timestamp curl's individual starts precisely enough to measure its minimum. |
| curl caps active attempts at six and can discard the oldest; this library retains every viable earlier candidate until selection/deadline | §5 says starting another attempt leaves prior attempts unaffected; loser cancellation **SHOULD** occur after success | Intentional resource tradeoff documented in the README; [scheduler](regressions.md#scheduler-tests) and [slow TLS test](regressions.md#network-tests) keep earlier candidates viable. |
| curl's stalled TLS probe did not fall back after TCP connection; this library defines success at TLS readiness | RFC §5 normally identifies success at TCP handshake; TLS readiness is this library's API contract | Intentional profile difference. [TLS stall/fallback tests](regressions.md#network-tests) and [winner cleanup test](regressions.md#scheduler-tests) assert ownership. |
| Full destination sorting cannot be proven by this probe | [§4](https://datatracker.ietf.org/doc/html/rfc8305#section-4) **MUST** apply RFC 6724 before interleaving | This library's limitation is stated in the [requirements matrix](../PROFILE.md) and README; no full-conformance claim remains. |

`--resolve` supplies a completed address set, so these commands do not evaluate late DNS, native resolver cancellation, or RFC 6724 policy. Loopback refusal does not emulate a slow TCP SYN or simultaneous winners.
