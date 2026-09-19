# Connection timeouts and fallback latency

Measured on Linux on 2026-09-20 with Node 24.21.0 and 26.9.0. These are real
loopback TCP connections under controlled conditions. They demonstrate the
mechanism; they do not measure how often it occurs on the Internet.

## Fixture

Run `node scripts/audit-timeouts.mjs` in the source checkout. A separate process
listens on `127.0.0.2` with a backlog of one and pauses its accept loop. Two filler
connections occupy the listen queue. The connection under test must wait for the
listener to resume and the kernel to retry. All sockets belong to this fixture;
no firewall, routing, system DNS or external server is changed.

The stalled case pauses accepting for eight seconds and provides a second,
responsive endpoint at `127.0.0.1`. The slow-viable case resumes after 650ms and
provides a refused second endpoint at `127.0.0.3`. This Linux fixture produces
roughly one-second TCP establishment in the latter case because of retransmission.
Other kernels and configurations can produce different timings.

Node uses `autoSelectFamily: true` and a per-socket lookup returning the two
IPv4 addresses. Its attempt timeout is explicitly 250ms or 1500ms; these are
probe settings, not a claim about the current default. The library uses its
250ms stagger and independent overall deadline. Node's first attempt event is
emitted synchronously before the helper attaches its listener; the event list
therefore records later attempts only. Elapsed time measures the complete call.

## Results

| Scenario | Implementation | Attempt timeout / stagger | Overall deadline | Node 24.21.0 | Node 26.9.0 |
| --- | --- | --- | --- | --- | --- |
| Stalled first, reachable second | Node | 250ms timeout | 4s | Success, 256ms | Success, 253ms |
| Stalled first, reachable second | Node | 1500ms timeout | 4s | Success, 1504ms | Success, 1502ms |
| Stalled first, reachable second | Library | 250ms stagger | 4s | Success, 255ms | Success, 257ms |
| Stalled first, reachable second | Library | 250ms stagger | 20s | Success, 253ms | Success, 253ms |
| Slow viable first, refused second | Node | 250ms timeout | 4s | Failure, 253ms | Failure, 252ms |
| Slow viable first, refused second | Node | 1500ms timeout | 4s | Success, 1053ms | Success, 1039ms |
| Slow viable first, refused second | Library | 250ms stagger | 4s | Success, 1004ms | Success, 1019ms |
| Slow viable first, refused second | Library | 250ms stagger | 20s | Success, 1008ms | Success, 1012ms |

Raw portable records: [Node 24](timeout-results.json) and
[Node 26](timeout-node26-results.json). The script fails if the expected success
and failure outcomes are absent, so an unsuitable host cannot silently produce
supporting evidence. Timing values are observations, not CI performance thresholds.

## What this establishes

Increasing the sequential attempt timeout preserves the slow connection but
also delays the reachable fallback. Overlapping attempts let the slow connection
continue while another address gets its turn. A large overall deadline does not
increase that stagger. This implements the earlier-attempt liveness behavior in
[RFC 8305 Section 5](https://www.rfc-editor.org/rfc/rfc8305#section-5).

The [scheduler regression](regressions.md#scheduler-tests) checks this behavior
with deterministic time; [network tests](regressions.md#network-tests) separately
cover delayed TLS and authenticated readiness. Happy Eyeballs does not make an
inherently slow path fast when no faster working alternative exists.
