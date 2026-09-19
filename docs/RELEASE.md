# Release checks for 1.0.1

Prepared on 2026-09-20 (Asia/Bangkok) after the error-compatibility audit and
native platform validation.

## Changes

- Preserve native Node error behavior for cancellation, request destruction,
  DNS failures and HTTPS write failures; retain custom errors and their causes.
- Preserve the connection-deadline message and remove discarded socket error
  guards after close. See the [error-compatibility audit](audits/error-compatibility.md)
  for findings, regression tests and deliberate compatibility boundaries.
- Make the two-refusal comparison portable by using the configured IPv6 and
  IPv4 loopbacks, with a timeout, cleanup and assertions for both addresses.

## GitHub validation

[CI run 35474028416](https://github.com/ArminShupuk/compliant-eyeballs/actions/runs/35474028416)
passed all 60 jobs at commit `a37c36ccff743b916d4da7f223021040eb4a2757`:

- 33 Node jobs: 11 versions across Linux, macOS and Windows.
- Three additional native architecture jobs: Linux ARM64, macOS Intel and
  Windows ARM64.
- Eight Docker jobs covering Debian/glibc, Alpine/musl, x64 and ARM64.
- Three Undici minor sweeps and 12 Electron Node-runtime jobs.
- The runtime coverage gate.

That commit still used package version 1.0.0. The 1.0.1 preparation updates
only the manifest, lockfile and release records; runtime sources, compiled
output and tests match the passing commit. Electron Node-mode checks do not
cover Chromium networking or packaged desktop UI behavior.

## Local artifact checks

The release checks use Node 24.21.0 and npm 12.0.2:

1. Clean dependency installation with `npm ci --ignore-scripts`.
2. `npm run check`: rebuild ESM/CommonJS, scan public content, verify test
   classifications, run 139 core tests and the default Undici consumer suite,
   and test installation of the packed artifact.
3. `npm run test:coverage`: 147 core/Undici 8 tests, with 100% lines, branches
   and functions in every ESM runtime module.
4. Packed installation verifies version agreement, MIT notice, contents,
   installed Markdown links, embedded source maps, ESM/CommonJS exports,
   TypeScript resolution, TCP, TLS, HTTPS agents and the Undici connector.

The package has no runtime dependencies or consumer installation hooks.
Earlier [verification results](VERIFICATION.md) and [audit records](audits/final.md)
describe the initial 1.0.0 checks; the CI results above close their outstanding
native-platform execution gap. Documented RFC, DNS and protocol limits still apply.

## npm staging

Version 1.0.0 already exists in the public registry. Submit the exact tested
1.0.1 tarball with `npm stage publish <tarball> --tag latest --access public`,
authenticated with the existing stage-only token. Preserve the stage ID and
compare the downloaded staged tarball with the tested artifact.

Under npm's [staged publishing workflow](https://docs.npmjs.com/staged-publishing/),
a maintainer reviews and approves the stage with 2FA before 1.0.1 becomes public.
Credentials are supplied through the local environment and are excluded from
the package and release records.
