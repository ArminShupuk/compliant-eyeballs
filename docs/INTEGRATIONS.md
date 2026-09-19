# Integration patterns

These examples show where the connector fits into existing clients. They are
based on local fixtures, not complete application integrations. See
[compatibility](COMPATIBILITY.md) for versions and limits.

## Undici and native HTTPS

Use `createUndiciConnector({allowH2: true})` in the existing Undici Agent and
`createHttpsAgent({keepAlive: true, scheduling: 'lifo'})` for the separate native
HTTPS path. Use Undici's own `fetch` with an Undici 8 dispatcher. Keep SSE and
calendar request handling in the application; this package owns connection setup.

```ts
import { Agent, buildConnector, fetch } from 'undici';
import { createUndiciConnector } from 'compliant-eyeballs/undici';
const connect = createUndiciConnector({
  allowH2: true, keepAlive: true, keepAliveInitialDelay: 60_000,
  fallbackConnector: buildConnector({ allowH2: true, timeout: 20_000 }),
});
const dispatcher = new Agent({ connections: 3, connect, allowH2: true });
// At owner shutdown: connect.destroy(); await dispatcher.destroy();
```

The fallback is for a caller-supplied tunnel/Unix transport, not proxy discovery.
Use the consuming application's normal proxy owner for proxied URLs. It owns the
delegated connector's cancellation and shutdown.

## WebDAV with node-fetch 2

```ts
import fetch from 'node-fetch';
import { createHttpsAgent } from 'compliant-eyeballs/agents';
const directAgent = createHttpsAgent({ keepAlive: true });
const response = await fetch(webdavUrl, {
  method: 'PROPFIND', headers: { Depth: '1' },
  agent: configuredProxyAgent ?? directAgent,
  signal, body: propfindXml,
});
```

Keep the application's proxy selection and custom CA/client-certificate configuration.
The node-fetch 2.6.7 fixture verifies 207 responses, streamed reads, cancellation
and a failed first IPv4 candidate followed by a viable second address. Credentials
stay in request handling and never enter diagnostics.

## Downloads with node-fetch 3

Use native agents with the existing download client. For node-fetch redirects
that can change protocol, supply an agent selector which delegates to the
application's proxy policy and chooses the direct HTTP/HTTPS agent only when
appropriate. Consume streams with backpressure; cancel via the caller's signal.
Do not reinterpret a post-connect download failure as a reason to race another
address and replay a request. The node-fetch 3.3.2 fixture follows a redirect,
consumes a 262144-byte stream and cancels a stalled download.

## Raw TCP, native HTTP and WebSockets

Pass custom lookup and TLS settings to the connection functions on the direct
connection path. Native-agent
HTTP requests and `ws`/`wss` share the agent factories:

```ts
const agent = createHttpsAgent({ ca, cert, key, lookup });
const socket = new WebSocket(url, { agent, ca, cert, key });
// Raw direct transport hook:
const tcp = await connectTcp({ hostname, port, lookup, signal });
```

The fixture verifies native API-style JSON requests, raw TCP, both WebSocket
schemes, caller lookup and custom trust. Browser networking and proxy tunnels retain their existing owners. This package
provides Node.js transport hooks; it does not replace a browser network stack.

## Native HTTP/2 and proxy hooks

```ts
const socket = await connectTls({
  hostname, port, signal, tls: { ca, ALPNProtocols: ['h2'] },
});
const session = http2.connect(origin, { createConnection: () => socket });
```

Check negotiated ALPN before selecting your application protocol. A proxy owner
can use `connectTcp({ hostname: proxyHost, port: proxyPort, signal })` to race the
proxy server's addresses, or `connectTls()` for an HTTPS proxy. The owner then
performs CONNECT/SOCKS and target TLS in its normal code. It also owns timeout,
abort and cleanup after proxy-endpoint connection, including any tunnel racing or
retry. A supplied `httpSocket` to the Undici connector is delegated only to the
explicitly configured fallback.
Direct APIs reject proxy-related options instead of silently ignoring them; URL
proxy selection remains the application's responsibility.
