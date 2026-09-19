# Compatibility

The package supports **Node 20.0.0+**, external **Undici 6.0.0+ for direct
HTTP/1.1**, and **Undici 8.0.0+ for the tested HTTP/2 integration**.
Runtime `fetch` bundles its own Undici version; `@types/node` is not a runtime.

| Integration | Tested versions | Scope |
| --- | --- | --- |
| Node.js | 20.0.0, 20.18.1, 22.0.0, 22.12.0, 22.19.0, 24.15.0, 24.17.0, 24.18.0, 24.19.0, 24.21.0, 26.9.0 | TCP, TLS, native agents, native HTTP/2, packed exports and declarations |
| Electron | 41.10.7, 42.3.0, 42.5.0, 44.1.0 | Actual embedded Node runtime, using `ELECTRON_RUN_AS_NODE=1` |
| Undici | 6.0.0, 6.21.2, 6.27.0, 6.28.0, 7.26.0, 7.29.0, 8.0.0, 8.10.0; additional minor-version sweep | Direct connector, cancellation, TLS sessions, HTTP/1.1 and Undici 8 HTTP/2 |
| node-fetch | 2.6.7 and 3.3.2 | Native agents, WebDAV, streamed transfers, redirects and cancellation |
| ws | 8.x (exact dependency in the development lockfile) | `ws` and `wss`, lookup and custom trust |
| TypeScript | 5.9.3 | Packed root, `/agents` and `/undici` imports under NodeNext, Node16, Bundler and legacy CommonJS resolution |

Executable pins are in [tested versions](tested-versions.json). Tests exercise
integration APIs and protocols rather than complete downstream applications.

The current [ten-version Linux matrix](matrix-results.json) runs the listed
Node versions against eight pinned Undici releases, including the 6.0.0
and 8.0.0 floors. All ten core suites and 70 compatible Node/Undici pairs
passed; ten engine-incompatible pairs were excluded.
The pinned Undici 6 floor needs Node ≥18.0, the later pinned 6 releases need
≥18.17, Undici 7 needs ≥20.18.1, and Undici 8 needs ≥22.19.0, according to
their registry manifests. Every compatible pair runs the same
native/WebDAV/download/WebSocket/HTTP/1.1 fixtures; every Node
runs the core/native-H2 suite. Platform CI is configured for Node 26 as well.
Results record the bundled Undici version where Node exposes it.

The separate [minor sweep](undici-minor-results.json) passed direct HTTP/1.1
fixtures on 72 versions and HTTP/2 fixtures on 12 Undici 8.x versions under
Node 24.21.0 on Linux. It selects the latest published patch of every 6.x–8.x
minor and includes the 6.0.0 and 8.0.0 floors. CI repeats this sweep on Linux,
macOS and Windows; only the Linux result is recorded locally so far.

## TypeScript imports

Use normal typed imports for all three public entrypoints:

```ts
import { connectTcp } from 'compliant-eyeballs';
import { createHttpsAgent } from 'compliant-eyeballs/agents';
import { createUndiciConnector } from 'compliant-eyeballs/undici';
```

NodeNext, Node16 and Bundler resolution use the package's conditional `exports`.
CommonJS projects using the default legacy resolver, `moduleResolution: "node"`
or `"node10"` use `typesVersions` mappings for the subpaths and `types` for the
root entrypoint. These point to the CommonJS declarations. This follows
[TypeScript's package resolution rules](https://www.typescriptlang.org/docs/handbook/modules/reference.html#packagejson-typesversions).

The packed-install check compiles all three entrypoints in each configuration,
checks that invalid options produce type errors, and runs the emitted legacy
CommonJS consumer. No local declaration shim or type assertion is needed for
these imports. TypeScript 5.9.3 is the compiler tested by this check.

## Explicit limits

* **Undici H2:** the multiplexing/streaming/cancellation/GOAWAY fixture passes on
  8.0.0 and the latest patch of every 8.x minor. During development, the same
  workload on 6.21.2 hit an assertion in Undici's `client-h2.js`/`Request.onData`
  path. Undici 6/7 H2 is excluded; this is not a claim that every older release
  has the same bug. The fixture does not validate every Undici H2 behavior.
  Native `node:http2` handoff remains tested on all Node versions.
* **Built-in fetch plus Undici 8 dispatcher:** Node runtimes bundling older
  Undici use a different request-handler API. The fixture asserts the expected
  `UND_ERR_INVALID_ARG` rejection, then verifies matching external `undici.fetch`.
  This is recorded as incompatible, not reported as successful interoperability.
  Conversely, Node 26.9.0's newer bundled fetch rejects the tested Undici 6
  dispatchers. The tested Undici 7 releases interoperate with both generations.
  The [Node 26.9.0 report](node-26.9.0-results.json) covers all eight pinned Undici versions on
  Node 26.9.0 in addition to the ten listed Node versions.
* **Undici request cancellation during establishment:** the standard connector
  callback has no request signal. Use factory cancellation/deadline or a caller
  that passes the connector's optional signal. No global Dispatcher patches.
* **Older Undici fixtures:** the development lockfile includes 6.21.2 for the
  consumer-version matrix. The minor sweep installs additional versions in a
  temporary directory. A full `npm audit` on 2026-09-20 reported a
  high-severity advisory for that dev-only version. The published package has
  no runtime dependencies; consumers should use patched Undici releases.
* Consumer fixtures exercise the real node-fetch, Undici and ws packages. Existing
  proxy selection stays in the consuming application.
* Electron checks run Electron's actual Node runtime with `ELECTRON_RUN_AS_NODE=1`.
  Chromium `net`/renderer fetch and packaged desktop UI behavior are separate
  release checks, not covered by a Node transport library.

See [minor-version results](undici-minor-results.json) and [release checks](RELEASE.md). The
older runtime tests establish compatibility; applications should follow their own
Node support policies.
