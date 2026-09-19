# Error compatibility audit

Audited on 2026-09-20 against commit `a2cd085` and the existing uncommitted
Node/Undici error-alignment changes. The earlier commits are `e13e746`
(cross-platform fixtures) and `c57dde0` (initial release). The alignment changes
are in the working tree, not a separate committed release.

## Findings and corrections

| Severity | Finding | Correction and regression coverage |
| --- | --- | --- |
| Medium | A signal reason named `AbortError` with code `ABORT_ERR` was reused, losing the standard message and the reason as `cause`. | Always wrap signal reasons. Compare early and pending TCP/TLS cancellation against native sockets; test connector cancellation with an existing abort error. |
| Medium | The Undici connector used nullish coalescing between signal reasons, replacing a `null` reason. | Bind each listener to its own signal. Test both signals, early and pending cancellation, falsy reasons, callback count and listener cleanup; verify through `undici.request`. |
| Medium | Pending native-agent requests replaced `destroy(error)` errors, reported `ABORT_ERR` for plain `destroy()`, and emitted an extra error for `abort()`. Already-aborted requests could wait until the deadline to report cancellation. | Let `ClientRequest.onSocket` handle its saved error and abort state; reject already-destroyed requests before starting a race. Compare HTTP and HTTPS active, queued and pre-aborted requests with native agents, including signal reasons that are already abort errors. |
| Medium | HTTPS translated OpenSSL errors to `write EPROTO` even when no write had been queued or when called through direct `createConnection`. | Translate single errors only for requests with queued bytes. Compare idle requests, flushed headers, writes and completed requests against native HTTPS; preserve direct-connection TLS errors. |
| Medium | HTTPS derived `errno` from OS constants; Windows uses different libuv values. | Use Node's system error map. Native comparison tests assert `errno` and `syscall` on each CI platform. |
| Medium | Failed candidates removed every error listener before asynchronous close, allowing queued errors to become unhandled. Synchronous cancellation during creation retained a permanent guard. | Guard discarded sockets until close, then remove the guard. Deterministic tests verify original-error identity, one failure event and complete hook/timer cleanup. |
| Low | The exported two-argument `ConnectionError(errors, 'ETIMEDOUT')` constructor lost its deadline message. | Preserve the constructor default and explicitly mark exhausted attempts as non-deadline failures; test both forms and packed ESM/CommonJS imports. |
| Medium | Numeric custom error codes, including valid `DOMException` verifier errors, caused HTTPS translation to throw and leaked numbers into string-code aggregate/diagnostic interfaces. | Read Node codes only when they are strings. Preserve original errors and causes; compare a native HTTPS verifier failure and test single, aggregate and DNS failures with numeric codes. |

The existing alignment correctly preserves single connection and DNS errors,
certificate-verifier errors, common aggregate codes, retryable DNS failures and
distinct deadline diagnostics. Additional tests cover aggregate metadata, lookup
errors alongside attempts, uncoded failures and reserved error codes without
misclassifying them as cancellation.

## Compatibility boundaries

- Multiple failed candidates retain `ConnectionError`/`AttemptError` metadata.
  Mixed codes deliberately use `ECONNFAILED`. Native Node aggregates instead use
  the first error's code; this is an intentional library policy, not exact parity.
  See [Node's aggregate implementation](https://github.com/nodejs/node/blob/v24.0.0/lib/internal/errors.js).
- The single-candidate HTTPS translation applies at the request-write boundary.
  Multi-candidate aggregates retain original TLS causes. Direct TLS and Undici
  also retain the original TLS errors; compare the
  [Undici connector](https://github.com/nodejs/undici/blob/v6.21.2/lib/core/connect.js).
- The overall DNS/TCP/TLS deadline remains `ETIMEDOUT`, with retained failures;
  it differs from Undici's connector-specific `UND_ERR_CONNECT_TIMEOUT`.
- Abort wrapping follows [Node's stream cancellation](https://github.com/nodejs/node/blob/v24.0.0/lib/internal/streams/add-abort-signal.js).
  Request destruction follows [ClientRequest's saved-error handling](https://github.com/nodejs/node/blob/v24.0.0/lib/_http_client.js).
- System errno mapping follows [Node's public API](https://nodejs.org/api/util.html#utilgetsystemerrormap),
  including [libuv's Windows EPROTO value](https://github.com/libuv/libuv/blob/v1.x/include/uv/errno.h).
- Error messages may vary across Node/OpenSSL versions. Tests compare native
  behavior on the executing runtime rather than hardcoding an OpenSSL message.

## Validation

The pre-change baseline passed 126 core tests and the combined 133-test coverage
suite. New regressions reproduced the cancellation, HTTPS write-boundary and
late-error defects before the fixes; numeric-code and pre-aborted-request
regressions also failed before their corrections.

All final checks passed on Linux x64:

- `npm run check`: build, public-tree scan, test classification, 139 core tests,
  seven consumer tests and packed installation. The default Undici 6 consumer
  run excludes its unsupported HTTP/2 test; Undici 8 HTTP/2 passes below.
- `npm run test:coverage`: 147 tests passed with 100% lines, branches and
  functions in every ESM runtime module.
- Runtime matrix: 11 Node versions from 20.0.0 through 26.9.0; all 11 core
  suites and 78 compatible pinned Node/Undici pairs passed. Ten pairs were
  excluded by Undici's declared minimum Node version.
- Undici minor sweep: 72 versions, 72 HTTP/1.1/consumer checks and 12 HTTP/2
  checks, all passed under Node 24.21.0.
- Packed imports: ESM/CommonJS runtime behavior and error contracts;
  TypeScript NodeNext, Node16, Bundler and legacy CommonJS resolution.
- `git diff --check`: no whitespace errors.

The [machine-readable results](error-compatibility-results.json) include source
hashes, runtime versions, exclusions and per-module coverage. Node 26.9.0 was
downloaded from the official distribution and checked against its published
SHA-256 checksum. Fixtures use local sockets and injected lookup results.

Native Windows/macOS, Electron and Docker were not rerun. Linux tests do not
establish native cross-platform behavior; the existing CI jobs remain that
validation gate.
