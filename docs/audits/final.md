# Final library audit

Review date: 2026-09-20. Scope: all nine runtime modules, public declarations,
build/package scripts, test classifications, CI configuration and public documents.
Version: 1.0.0. The [verification record](../VERIFICATION.md) contains execution results.

## Findings and changes

| Finding | Resolution | Evidence |
| --- | --- | --- |
| Direct native-agent `createConnection()` calls were not cancelled during DNS by `destroy()` | Track every connection controller; abort them on destruction and reject subsequent calls | [Agent regressions](regressions.md#agent-tests); failed before the fix |
| Caller reassignment of factory options changed existing agent/connector behavior | Capture connection option properties at construction, including TLS option properties | [Agent](regressions.md#agent-tests) and [connector](regressions.md#network-tests) regressions; failed before the fix |
| Aggregate coverage could omit a runtime module never imported by tests | Import every runtime module; require every file to appear in the report at 100% lines, branches and functions | [Coverage results](../coverage-results.json) and [runtime checks](regressions.md#package-and-runtime-checks) |
| Declaration maps pointed to source files absent from the package | Remove declaration maps; retain JavaScript maps with embedded sources | Packed artifact checks |
| Package contents included private research and local machine paths | Relocate research; use generic fixtures and portable audit records; scan source and packed text | Packed artifact checks |
| Report links pointed to files absent from the installed package | Link the public regression index and retain source-checkout commands as code references | Installed Markdown link checks |
| Package smoke tests used only raw TCP | Exercise authenticated TLS, HTTPS agents and connectors through ESM and CommonJS; compile NodeNext and Bundler consumers | Packed installation on supported runtime floors |
| Package-version checks were hardcoded | Compare the source manifest, lockfile, tarball and installed package version on every packed-install run | [1.0.0 rebuild](../platform-results.json) |
| Platform checks lacked a shared local runner | Add native and Docker commands that rebuild, run compatible consumers, verify packed installation and record runtime/platform metadata | [Platform testing](../TESTING.md) |
| Timeout discussion lacked measured TCP evidence | Add controlled Linux listen-queue comparison on Node 24 and 26 | [Timeout measurements](timeouts.md) |

## Review coverage

The review followed connection ownership through DNS, candidate creation,
readiness, selection, failure, cancellation and handoff. Existing tests cover
minimum spacing, late DNS, updated candidates, same-family lists, canonical IPv6
addresses, local binding, simultaneous winners, certificates, SNI, ALPN, TLS
sessions, request queues and pool reservations. Integration fixtures exercise
real HTTP clients; no request replay or global networking patch is introduced.

Factory snapshots copy option properties. Buffers, arrays, BlockList and
SecureContext objects remain caller-owned and must not be mutated while in use.
Connection callbacks and timeout handlers run caller code and must not throw;
diagnostic observers are explicitly isolated from settlement. OS lookup jobs
cannot be cancelled through Node's API, so cancellation unsubscribes from their
results. The active race can have multiple sockets per pending pool slot; its
address count and deadline bound that resource use.

The provenance review compared the runtime with the locally recorded reference
connector and reviewed package notices and dependencies. It identified no nontrivial
copied source or comments. This is a
source review, not a claim of a formal clean-room process or proof of authorship.
The MIT notice is preserved, and development dependencies are not bundled.

## Publishing blockers and limits

- macOS, Windows and ARM64 checks still require execution. Linux x64 results and
  configured workflows do not establish results on those platforms.
- npm account access and publishing authentication must be confirmed before an
  actual release. Package-name availability does not reserve the name.
- The evidence supports specific advantages over Node.js, Go and curl. It does
  not support a universal compliance ranking over Chromium, or a claim to fix
  every possible `autoSelectFamily` failure. The Docker issue's cause is unconfirmed.
- The retained README Section 4 paragraph contains categorical impact claims
  such as “no real world impact” and “not make anything fail.” These were not
  established by the audit. They remain a documentation accuracy blocker for
  publishing; full RFC 6724 destination policy is outside this implementation.
- “Major refactoring” was not verified as an upstream maintainer statement.
  The README identifies the connection-ownership assessment as an inference and
  provides upstream issue links without a promised delivery date.

The [four comparator reports](README.md) distinguish observations, source
inferences and fixture limits. TLS readiness is an API extension to the normal
TCP success criterion, not evidence that another implementation violates RFC 8305.
