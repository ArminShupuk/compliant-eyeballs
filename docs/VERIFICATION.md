# Verification

Checked on Linux on 2026-09-20 (Asia/Bangkok; machine reports use UTC).

| Check | Result |
| --- | --- |
| Release 1.0.0 | Clean dependency installation, ESM/CommonJS rebuild and native platform run pass on Node 24.21.0. Source manifest, lockfile, tarball and installed package versions agree. |
| Docker release checks | All six Linux x64 cases pass: Node 20, 22, 24 and 26 on Debian; Node 24 and 26 on Alpine. Six core suites, 44 compatible Undici pairs and six 1.0.0 packed installs pass. Both Node 24 containers reach 100% runtime coverage. |
| Core and consumer suite | 102 core tests and 6 consumer tests pass together with Undici 8.10.0. The default Undici 6 consumer run passes 5 and explicitly skips the unsupported HTTP/2 fixture. |
| Classification | 80 test definitions carry exact RFC sections or API/protocol contract references; all conformance sections have requirements-matrix rows. |
| Runtime coverage | **100% lines, branches and functions in each of nine compiled ESM runtime modules**. One combined core/Undici 8 run passes 108 tests. No generated-code exclusions. The gate rejects omitted runtime modules. |
| Node/Undici matrix | Ten Node core suites and 70 compatible Node/Undici pairs pass; ten engine-incompatible pairs are excluded. Node 26.9.0 additionally passes its core suite and all eight pinned Undici versions. |
| Undici minor sweep | 72 selected releases pass HTTP/1.1 consumer fixtures; 12 Undici 8.x releases also pass HTTP/2: 84 runs, no failures. |
| Electron Node runtimes | 41.10.7, 42.3.0, 42.5.0 and 44.1.0 each pass all 108 tests with `ELECTRON_RUN_AS_NODE=1`. |
| Packed installation on Node 20.0.0, 24.21.0 and 26.9.0 | Contents, local documentation links, ESM/CommonJS exports, NodeNext/Bundler declarations, TCP, authenticated TLS, HTTPS agents and connectors pass. |
| Comparator probes | curl 8.22.0, Go 1.27.1, Node 26.9.0 and Chrome for Testing 153.0.8010.52 all execute; 30 records include expected timeout/refusal outcomes and no infrastructure failures. Installed curl and Node 24.21.0 are secondary comparisons. |
| TCP timeout comparison | Eight controlled outcomes each on Node 24.21.0 and 26.9.0: larger Node attempt timeouts delay fallback; overlapping library attempts preserve slow connections and prompt fallback. |
| Public-content scan | Repository and packed artifact checked for private research terms, credential patterns and machine-specific paths. |
| Production dependencies | `npm audit --omit=dev` reports zero vulnerabilities; there are no runtime dependencies. The full development audit reports one high-severity advisory in the pinned Undici compatibility fixture. |
| Registry readiness | Package-name lookup returns 404; `npm whoami` returns `ENEEDAUTH`. Authentication remains a publishing prerequisite. |

Evidence: [coverage](coverage-results.json), [Node matrix](matrix-results.json),
[1.0.0 native platform run](platform-results.json), [Docker runs](docker-results.json),
[Node 26 matrix](node-26.9.0-results.json), [Undici sweep](undici-minor-results.json),
[Electron](electron-results.json), [comparators](audits/probe-results.json),
[TCP timings](audits/timeouts.md) and [regression index](audits/regressions.md).

Declarations and test tooling have no place in the runtime coverage denominator.
The duplicate CommonJS build is tested through packed installation. A 100% result
means those measured statements, branches and functions executed; it does not
prove every possible input or network behavior is correct.

macOS, Windows and ARM64 execution remains outstanding. The configured CI
workflow covers those platforms, but Linux x64 results do not establish their behavior.
The [final audit](audits/final.md) lists documentation and publishing limitations.
