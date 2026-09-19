# compliant-eyeballs

**Happy Eyeballs for Node.js and Electron:** an MIT TypeScript connection library
with overlapping TCP/TLS connection attempts. Supports Node **20.0.0+** and
Electron's Node runtime. ESM, CommonJS and declarations are included; the core
has no runtime dependencies or native modules.

IPv6 and IPv4 resolve independently. Connection attempts overlap, so a slow
address keeps its chance to succeed while other addresses are tried. The first
ready connection wins; losing sockets are closed. `connectTcp()` selects after
the TCP handshake; `connectTls()` waits for the authenticated TLS handshake.
Attempt scheduling follows
[RFC 8305 Section 5](https://www.rfc-editor.org/rfc/rfc8305#section-5).

## Why increasing the timeout isn't enough

Node.js's `autoSelectFamily` can give up on a slow but working address before
trying the next one. The usual fix is to raise the timeout. That gives a slow
connection more time, but also makes everyone wait longer when the first address
isn't working. Lower it again and viable connections start failing again.

**Observed delays can easily reach 1s+.** In the
[Linux loopback comparison](docs/audits/timeouts.md), raising Node's attempt
timeout from 250ms to 1500ms increased fallback time from **256ms to
1504ms**. A slow viable connection needed **1053ms** and failed with the short
timeout. With this library, a reachable fallback connected in **253ms with a
20-second overall timeout**, and the slow earlier connection survived.

**Proper Happy Eyeballs keeps fallback fast while allowing large timeouts.**
Without overlapping attempts there is always a tradeoff between fallback speed
and how long an earlier connection gets to succeed. Here, starting the next
attempt does not kill the previous one. Attempt spacing controls how quickly
another address gets a chance; the overall timeout controls how long the whole
connection race may run.

Node.js tracks parallel Happy Eyeballs in
[#48145](https://github.com/nodejs/node/issues/48145). Moving from sequential
socket attempts to overlapping attempts requires changes to connection ownership
and cleanup. It may take a while to land. The timeout problems are documented in
[#54359](https://github.com/nodejs/node/issues/54359) and
[#52216](https://github.com/nodejs/node/issues/52216). The
[original implementation](https://github.com/nodejs/node/pull/44731) and the merged
[increase to 500ms](https://github.com/nodejs/node/pull/60334) explain the history.

Until Node.js fixes its implementation, this library solves the premature
attempt cancellation, delayed fallback and stalled-TLS problems described here.

## Installation

Requires **Node.js 20.0.0 or newer**.

```sh
npm install compliant-eyeballs
```

ES modules, CommonJS and TypeScript declarations are included.

## Feature support

| Feature | Support | Details |
| --- | --- | --- |
| Independent IPv6 and IPv4 OS lookups | Yes | IPv6 can start immediately; IPv4-first results use a 50ms resolution window. |
| Address racing | Yes | Attempts overlap, alternate families when available, and keep viable earlier sockets alive. |
| Updated candidate lists | Yes | A custom resolver can add or remove unattempted addresses during establishment. |
| TCP and TLS readiness | Yes | `connectTcp()` waits for TCP; `connectTls()` waits for TLS and Node's certificate checks unless the caller opts out. Losing sockets are closed. |
| Cancellation and deadlines | Yes | Abort and the overall deadline cover resolution, active attempts and pending native-agent requests. |
| TLS identity and options | Yes | The requested host remains the certificate identity; CA, client certificates, ALPN, SNI and sessions are supported. |
| Native HTTP(S) agents | Yes | Instance-local pooling, keep-alive and request/agent destruction. Direct connections only. |
| Undici connector | Yes | Direct HTTP/1.1 integration; see [tested versions](docs/COMPATIBILITY.md). |
| HTTP/2 | Yes | Native `node:http2` handoff and Undici 8+ integration; see [tested versions](docs/COMPATIBILITY.md). |
| Proxy use | Connection hooks | `connectTcp()`/`connectTls()` can race the proxy server's addresses; an explicit Undici fallback can receive an existing tunnel. The caller owns proxy routing and negotiation. |
| RFC 6724 ordering, NAT64/PREF64 | Platform functions | Complete route/source-aware sorting and per-interface prefix discovery need lower-level network state unavailable through portable Node.js APIs. The OS resolver's order is retained within each family. |
| SVCB/HTTPS, ECH, QUIC, DNS transport/TTL policy | No | These are outside the TCP/TLS profile. |

[RFC 8305 Section 4](https://www.rfc-editor.org/rfc/rfc8305#section-4)
requires sorting all addresses together before interleaving. The library keeps
the order returned by the OS within each family, then alternates between IPv6
and IPv4. A slow or broken family therefore cannot hold up every address from
the other family; the other family gets its turn after the configured delay.
Node.js doesn't expose the APIs needed to implement this fully, but this has no
real world impact. It's nearly impossible to construct a case where this would slow
down resolution in any meaningful way. It requires an already severely broken
server and then it would only slow it down a little bit, not make anything
fail. It's an obscure compatibility issue.
But most importantly: without this library it wouldn't work at all.

## Direct TCP and TLS

```ts
import { connectTcp, connectTls } from 'compliant-eyeballs';

const controller = new AbortController();
const socket = await connectTls({
  hostname: 'example.com', port: 443,
  signal: controller.signal,
  connectTimeoutMs: 20_000,
  tls: { ALPNProtocols: ['http/1.1'] },
});
// The returned socket is ready and now owned by the caller.
socket.on('error', handleSocketError);
// Later, close it with socket.end() or socket.destroy().
```

`connectTcp()` resolves on TCP connection; `connectTls()` resolves after TLS
authentication and negotiation. The requested DNS name or IP remains the
certificate identity even if SNI is overridden. SNI is omitted for IP literals
and for `tls.servername: ''`. TLS options include custom `ca`, client `key`/`cert`,
ALPN, versions, explicit sessions and `checkServerIdentity`. A custom identity
callback receives the original destination. With `rejectUnauthorized: false`,
certificate verification failures do not reject the connection.

## Native HTTP(S)

```ts
import https from 'node:https';
import { createHttpsAgent } from 'compliant-eyeballs/agents';

const agent = createHttpsAgent({
  keepAlive: true, maxSockets: 3,
  connection: { connectTimeoutMs: 20_000 },
});
const request = https.get('https://example.com/', { agent }, consumeResponse);
request.on('error', handleRequestError);
request.setTimeout(30_000, () => request.destroy(new Error('idle timeout')));
// Call agent.destroy() when this agent is no longer needed.
```

`createHttpAgent()` is the plain HTTP equivalent. Normal Node agent options and
pooling remain available. One pool slot represents one connection race.
`maxSockets` and `maxTotalSockets` limit pending races along with established
connections. Each race can open several candidate sockets.

Request destruction, request abort, request signals and agent destruction cancel
pending connections, including requests waiting for a pool slot. No global
prototypes change.
Destroyed library agents are terminal; create a new agent for later work.

## Undici

```ts
import { Agent, fetch } from 'undici';
import { createUndiciConnector } from 'compliant-eyeballs/undici';

const connect = createUndiciConnector({ allowH2: true });
const dispatcher = new Agent({ connect, allowH2: true });
try {
  const response = await fetch('https://example.com/', { dispatcher });
  await response.arrayBuffer();
} finally {
  connect.destroy();       // Cancels outstanding connector races.
  await dispatcher.close();
}
```

Use `fetch` from the same Undici package as its dispatcher. The
[compatibility record](docs/COMPATIBILITY.md) lists tested versions, the
HTTP/2 version floor and bundled-fetch interoperability limits.

The standard Undici connector callback does not receive a request's AbortSignal.
Cancelling a request does not automatically cancel its pending connection race.
Supply a factory `signal`, call `connect.destroy()` at dispatcher shutdown, or
pass a `signal` when invoking the connector directly. The connection deadline
also closes pending races. Once connected, Undici handles request and stream
cancellation.

Each native HTTPS agent and Undici connector has a separate bounded session
cache (default 100). Keep a single immutable TLS policy per instance. No global
session or successful-family cache is used. Factory options are captured when
the agent or connector is created. Keep referenced buffers, arrays, BlockList
and SecureContext objects unchanged while they are in use.

## Configuration

| Option | Default | Accepted values |
| --- | ---: | --- |
| `resolutionDelayMs` | 50 | Finite, nonnegative |
| `attemptDelayMs` | 250 | Between the configured minimum and maximum |
| `minAttemptDelayMs` | 100 | Finite, at least 10 |
| `maxAttemptDelayMs` | 2000 | Finite, at least the minimum |
| `firstAddressFamilyCount` | 1 | Positive safe integer |
| `connectTimeoutMs` | 20000 | Finite, greater than 0 and at most 2147483647 |

All times are milliseconds. The resolution, attempt, minimum, maximum and initial
family-count defaults match the recommendations in
[RFC 8305 Section 8](https://www.rfc-editor.org/rfc/rfc8305#section-8) and the
[v3 draft Section 9](https://datatracker.ietf.org/doc/html/draft-ietf-happy-happyeyeballs-v3-04#section-9).
The overall connection deadline defaults to 20s. `minAttemptDelayMs` accepts
values as low as 10ms; the standards prohibit a lower value but recommend 100ms.
Invalid values are rejected. The 2s maximum is a recommendation, so higher
configured values are allowed. With the fixed
attempt delay, `minAttemptDelayMs` governs accelerated retries after hard failures;
`maxAttemptDelayMs` bounds the accepted `attemptDelayMs` setting. Timer waits
beyond the platform timer range are broken into bounded waits.

`family: 4 | 6` is a caller constraint; `family: 0` is unconstrained.
`localAddress` constrains the family; `localPort`, `lookup`, `hints`, `resolver`,
`noDelay`, `keepAlive`, `keepAliveInitialDelay` and `blockList` are supported.
Binding a fixed source port can prevent overlapping sockets on some systems;
per-address bind failures are reported normally.

The deadline covers resolution and all handshakes, using monotonic time. Hard
failures can accelerate fallback while respecting the minimum spacing. Starting
another attempt never installs a short timeout on earlier candidates.

`socketTimeoutMs` and `onTimeout(socket)` emit inactivity notifications without
closing sockets. Native request/agent timeout notifications are forwarded while
connecting. The overall connection deadline closes pending sockets. Once
connected, normal socket/HTTP timeouts apply.

Abort closes all candidates, cancels scheduling and ignores late resolution.
After the promise resolves, the caller owns cancellation of the returned socket.
One failed address or lookup returns its original Node error, including its
name, code and message. A negative lookup for another address family does not
replace a failed address's error. Multiple failed addresses return an aggregate
`ConnectionError`: its code is the common attempt code when all attempts agree,
or `ECONNFAILED` when they differ. Its `errors` retain each `AttemptError`
address/family/port/code and original `cause`, plus any lookup errors. Mixed
failure codes also appear in the aggregate message. With no attempted address,
an `EAI_AGAIN` lookup remains retryable and definitive empty results report
`ENOTFOUND`; matching failures from both family lookups use the original lookup
error. The overall deadline and abort report `ETIMEDOUT` and `ABORT_ERR`.
Abort errors use Node's standard message and retain the exact signal reason in
`cause`, including `null` or another abort error. Pending HTTP requests preserve
native `destroy(error)`, `destroy()` and `abort()` error behavior. For a single
failed candidate, the HTTPS agent reports OpenSSL protocol failures as
`write EPROTO` when the request has queued a write, with the original TLS error
in `cause`. Requests without a queued write, direct TLS, Undici and the causes
inside multi-candidate aggregates retain the original TLS errors.
Custom errors with numeric codes remain unchanged as single errors or causes;
aggregate and diagnostic code fields use only string codes.

Aggregates intentionally retain the library's `ConnectionError` and
`AttemptError` metadata; mixed failures use `ECONNFAILED` rather than Node's
first-error code. The overall deadline covers DNS and all candidates and uses
`ETIMEDOUT`, rather than Undici's `UND_ERR_CONNECT_TIMEOUT`. See the
[error compatibility audit](docs/audits/error-compatibility.md) for validation
and compatibility boundaries.

Each race can keep one socket per distinct address until a winner or deadline.
Limit concurrent requests to bound socket use. An unconstrained hostname lookup
starts two libuv resolver jobs. Applications handle retries after a connection
succeeds.

## Resolution and diagnostics

The default resolver starts separate IPv6 and IPv4 `dns.lookup` jobs, preserving
hosts-file and OS name-service behavior. IPv6 may proceed immediately; IPv4-first
answers wait up to the resolution window for IPv6.
A definitive negative IPv6 result ends that wait early. Late answers join the
remaining queue; active attempts are never restarted.

```ts
import type { Resolver } from 'compliant-eyeballs';
const resolver: Resolver = ({ hostname, families, signal }, update) => {
  // Integrate your own resolver; emit one snapshot per family as results arrive:
  // update({ family: 6, addresses: ['::1'], complete: false });
  // A later snapshot replaces unattempted addresses for that family.
  // complete: true declares the last snapshot, including definitive emptiness.
  // Observe signal, and return an unsubscribe function if needed.
};
```

Provide `resolver` or a Node-compatible `lookup`, not both. A custom `lookup`
must honor `{ all: true, family: 4 | 6 }`; IPv6 is requested first without awaiting
it. The OS's underlying lookup jobs may continue after cancellation.

Pass `onDiagnostic(event)` to receive resolution, attempt, failure, selection
and cancellation events. Events include monotonic elapsed time, address family,
address, candidate count and error code. Exceptions thrown by the callback are
ignored.

## Proxies

The native agents and Undici connector own **direct** connections to the requested
origin. An application must select its existing proxy agent or dispatcher for a
proxied request. Proxy settings passed to a direct API are rejected before DNS or
socket creation. A request-level `createConnection` supplied by a client such as
`ws` does not turn a direct agent into a proxy agent.

A proxy owner can call `connectTcp()` to race the **proxy server's** addresses, or
`connectTls()` when the connection to that server uses TLS. The caller supplies
the proxy hostname as `hostname`; the race does not resolve or contact the target
origin. The application handles proxy selection, bypass rules, authentication,
CONNECT or SOCKS negotiation, target name resolution, TLS through the tunnel
and tunnel cleanup. The library's race and deadline end when the connection to
the proxy server is ready. Route retries, request replay and tunnel cancellation
belong to the application's proxy integration.

The Undici adapter passes an existing `httpSocket`, Unix socket or alternate
protocol request to an explicitly supplied `fallbackConnector`. That connector
and its sockets remain the caller's responsibility, including cancellation and
shutdown. Without a fallback, the adapter rejects those requests. Native direct
agents reject Unix sockets and proxy tunnels.

See [compatibility](docs/COMPATIBILITY.md) and
[integration examples](docs/INTEGRATIONS.md).

## Development

See [platform testing](docs/TESTING.md) for Docker Debian/Alpine checks and native
Linux, macOS and Windows runners.

```sh
npm ci --ignore-scripts
npm run check
npm run test:coverage
npm run test:matrix -- --current
npm run test:undici-minors
```

Tests use Node's test runner and local TCP/TLS fixtures. OpenSSL creates temporary
test CAs and keys. The Undici minor sweep queries npm for the latest patch of each 6.x–8.x minor,
installs those dev-only fixtures in a temporary directory and writes a report.
The full local matrix uses Node versions installed with NVM (see
`docs/tested-versions.json` and `npm run test:matrix`). CI is configured for Linux, macOS,
Windows and the four listed Electron versions.

[All runtime modules have 100% line, branch and function coverage](docs/coverage-results.json).
The [requirements matrix](docs/PROFILE.md) maps RFC sections to implementation
and tests. Comparisons cover [Node.js](docs/audits/node.md),
[Go](docs/audits/go.md), [curl](docs/audits/curl.md) and
[Chromium](docs/audits/chromium.md).

See also [regression tests](docs/audits/regressions.md),
[package comparisons](docs/COMPARISON.md), [provenance](docs/PROVENANCE.md)
and [release checks](docs/RELEASE.md).
