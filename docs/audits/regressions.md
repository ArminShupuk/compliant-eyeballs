# Regression tests

These tests run against the built runtime in a source checkout. RFC tests name
an exact section; contract tests name the owning API or protocol. The
[requirements matrix](../PROFILE.md) maps those sections to implementation behavior.

## Scheduler tests

`test/scheduler.test.mjs` covers DNS arrival boundaries, late answers, same-family
lists, deduplication, interleaving, minimum spacing, candidate updates, slow
viable attempts, simultaneous winners, deadlines and cancellation. A 20-second
overall deadline leaves the 250ms fallback spacing unchanged. The slow earlier
candidate remains alive after the fallback fails and can succeed after 1.25s.

## Network tests

`test/network.test.mjs` covers real TCP/TLS connections, certificate identity,
custom trust, mutual TLS, SNI, ALPN, TLS 1.2/1.3 sessions, slow and stalled TLS,
loser closure, abort cleanup, native HTTP/2 and the Undici connector contract.
The connector configuration snapshot test prevents caller reassignment from
changing an existing connector's resolver and cancellation policy.

## Agent tests

`test/agents.test.mjs` covers keep-alive, queue and pool limits, failures,
request/agent destruction, timeouts, TLS policy and session isolation. Direct
`createConnection()` calls are cancelled by `destroy()` during DNS, subsequent
calls are rejected, and connection configuration is captured at construction.

## TLS event order tests

`test/undici-order.test.mjs` covers session tickets arriving before readiness,
cache eviction and cancellation at handoff with controlled TLS event ordering.

## Consumer tests

`fixtures/consumers.test.mjs` uses real Undici, node-fetch and ws packages for
HTTP/1.1, HTTP/2, WebDAV, redirects, streams, cancellation and WebSockets. Its
version and protocol exclusions are documented in [compatibility](../COMPATIBILITY.md).

## Package and runtime checks

`test/runtime.test.mjs` imports every ESM runtime module and checks native agent
prototypes for import side effects. `scripts/package-test.mjs` installs the actual
tarball, checks its contents and links, compiles ESM/CommonJS TypeScript consumers,
and uses all three entrypoints through both module systems.
The shared `fixtures/package-types.ts` consumer covers NodeNext, Node16, Bundler
and legacy CommonJS resolution (default, `node` and `node10`). It rejects invalid
option types and executes the emitted legacy CommonJS imports. The legacy check
reproduced missing subpath declarations before the `typesVersions` fix.

Run `npm run check` for core, consumer and package checks, and
`npm run test:coverage` for the combined core and Undici 8 suite. The coverage gate
checks each runtime module and rejects missing modules. See the
[coverage results](../coverage-results.json) and [verification record](../VERIFICATION.md).
