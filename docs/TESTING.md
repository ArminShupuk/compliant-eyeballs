# Platform testing

The release under test is read from `package.json`; the lockfile, tarball and
installed package must agree. Every platform run starts with a clean runtime
build and records the package version, Node version, architecture and kernel.

## Native Linux, macOS and Windows

Install the selected Node runtime and the OpenSSL CLI, then run from a source
checkout:

```sh
npm ci --ignore-scripts
npm run test:platform
```

The command runs the build, public-content scan, test classifications, the core
suite, all engine-compatible pinned Undici fixtures and the packed-install test.
Node 24 also runs the combined core/Undici 8 coverage gate, requiring every ESM
runtime module to reach 100% lines, branches and functions. Older runtimes and
Node 26 run compatibility checks; the Node 24 gate measures coverage.

Logs and JSON reports go into a temporary directory printed at completion.
Set `EYEBALLS_PLATFORM_DIR` to choose a directory outside the checkout. A failed
step stops that platform run and produces a failing report and exit status.
The checked-in CI workflow uploads reports on success and failure.

The recorded [native 1.0.0 run](platform-results.json) passed on Linux x64 with
Node 24.21.0, including the packed install and 100% runtime coverage gate.

CI covers the existing Node version matrix on Linux, macOS and Windows, plus
Node 24 on Linux ARM64, Intel macOS and Windows ARM64. macOS ARM64 is covered by
`macos-latest`. These labels follow the
[GitHub runner inventory](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
Configured jobs are not evidence that those platforms have passed.

## Docker Linux distributions

```sh
npm run test:docker -- --list
npm run test:docker
npm run test:docker -- --case=node24-alpine
npm run test:docker -- --case=node24-debian --platform=linux/arm64
```

On a Linux host where Docker requires sudo, add `--sudo`; it uses non-interactive
sudo and does not change socket permissions or group membership. The runner
requires Node 20+ on the host, Docker and a Linux container engine. It does not
need the host development dependencies installed.

The [Docker matrix](docker-matrix.json) tests:

| Node | Distribution | C library |
| --- | --- | --- |
| 20.0.0 | Debian bullseye | glibc |
| 22.19.0 | Debian bookworm | glibc |
| 24.21.0 | Debian bookworm and Alpine | glibc and musl |
| 26.9.0 | Debian bookworm and Alpine | glibc and musl |

All six cases [passed locally for 1.0.0](docker-results.json) on Linux x64:
six core suites, 44 compatible Undici pairs and six packed installs. Both Node 24
containers passed the 100% runtime coverage gate. ARM64 execution remains pending.

The Node image tags pin the runtime version; each report records the resolved
base-image digest. Alpine and Debian package updates can still change the build
when an image is rebuilt. Official Node image variants and their libc differences
are documented in the [Node Docker image repository](https://github.com/nodejs/docker-node#image-variants).

Node 20 uses the full Bullseye image, which already contains the OpenSSL CLI;
its slim image required a package that the Debian mirror no longer served during
the local run. The newer Debian cases use slim images.

`Dockerfile.test` installs OpenSSL when absent and development dependencies,
copies the source and rebuilds inside the container. The Docker context excludes Git
metadata, installed dependencies, existing builds, local IDE files and credential
configuration. Tests run as the unprivileged `node` user with no host mounts,
no network access, no additional capabilities and no new privileges. The build
needs network access to obtain images, OS packages and npm dependencies.

The runner tests sequentially, copies logs and reports into a host temporary
directory and removes its test containers. Images and build cache remain local
for reuse. Use `--output=DIR` for an explicit directory outside the checkout.
The runner returns failure if any selected case fails or its report does not
match the requested package, runtime and architecture.

ARM64 requires an ARM64 Docker engine or preconfigured emulation. CI runs the
ARM64 Debian/Alpine cases on native ARM64 Linux runners; this command does not
install emulation or change the host kernel.

## What Docker establishes

Containers use the kernel of their container host. Docker Desktop runs Linux
containers in a Linux VM on macOS or Windows. These tests establish Linux
container behavior on those hosts; native macOS and Windows socket, resolver
and TLS behavior is checked by the native runner jobs above. See Docker's
[container explanation](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/).

Electron's Node-runtime matrix and the wider Undici minor-version sweep remain
separate CI jobs. The Linux listen-queue latency comparison is a separate
`npm run audit:timeouts` command; it is not used as a cross-platform timing gate.
