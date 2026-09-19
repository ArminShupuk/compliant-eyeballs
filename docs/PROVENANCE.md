# Provenance

This MIT package implements a behavior specification using public protocol and
Node.js API documentation. The implementation record states that no third-party
connector source, comments or tests were copied. Development dependencies retain
their own licenses and are not bundled into the runtime.

Protocol and API references:

- [RFC 8305](https://www.rfc-editor.org/rfc/rfc8305)
- [Happy Eyeballs v3 draft -04](https://datatracker.ietf.org/doc/html/draft-ietf-happy-happyeyeballs-v3-04)
- Node.js [HTTP](https://nodejs.org/api/http.html) and [TLS](https://nodejs.org/api/tls.html)

Test certificates and private keys are generated temporarily with OpenSSL and
are not shipped. The [MIT license](../LICENSE) applies to the library's code.
The [final audit](audits/final.md) records the provenance review's scope and limits.
