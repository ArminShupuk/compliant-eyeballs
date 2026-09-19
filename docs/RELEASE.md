# Release checks for 1.0.0

## Verified locally

The npm registry returned HTTP 404 for `compliant-eyeballs` on 2026-09-20.
Recheck immediately before publishing; availability does not reserve a name.
The package has no runtime dependencies and no consumer installation hooks.
See the [verification record](VERIFICATION.md) and [final audit](audits/final.md).
The 1.0.0 platform check verifies that the source manifest, lockfile, packed
tarball and installed package all carry the same version after rebuilding.

## Required before publishing

1. Resolve the [final audit's publishing blockers](audits/final.md#publishing-blockers-and-limits),
   including documentation accuracy and missing macOS/Windows execution.
2. Run a clean `npm ci --ignore-scripts`, `npm run check` and
   `npm run test:coverage` on Node 24.21.0. The coverage gate requires every ESM
   runtime module at 100% lines, branches and functions; it permits no exclusions.
3. Run the [Node/Undici matrix](tested-versions.json), the Undici minor sweep and
   four Electron Node-runtime checks. Record engine and protocol exclusions
   separately from passing combinations. Run `npm run test:docker` for the
   [container matrix](TESTING.md), including Debian/glibc and Alpine/musl.
   Pass the native Linux, macOS and Windows CI jobs and the ARM64 jobs.
4. Inspect the exact tarball from `npm pack`: MIT notice, public documents,
   runtime exports, declarations, source maps, private-content scan and installed
   Markdown links. Test ESM and CommonJS from that artifact.
5. Review the [comparator reports](audits/README.md), [provenance](PROVENANCE.md)
   and [requirements matrix](PROFILE.md). Keep Section 4 sorting, NAT64/PREF64,
   DNS policy and protocol limits explicit.
6. Confirm ownership of the publishing account and valid publishing
   authentication. The local `npm whoami` check returned `ENEEDAUTH`.

npm's [publishing documentation](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
explains package contents and the release operation. Its
[authentication requirements](https://docs.npmjs.com/about-two-factor-authentication/)
require account 2FA or an appropriate granular token with the documented 2FA
bypass permission. Never put credentials in package files, command arguments or
release logs. No publishing credential was created or configured by this audit.

Electron Node-mode tests do not cover Chromium networking or packaged desktop
UI behavior. Source publication and npm publication are separate release steps.
