# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.50.x  | :white_check_mark: |
| < 0.50  | :x:                |

## Security Model

hAPI Enterprise runs one shared Node.js backend (`hapi_enterprise/server.js`) on the
edge between Home Assistant and Windows. Security is enforced by design:

- **Fail-open token bootstrap** — the add-on no longer hard-fails on a placeholder
  admin token. On first start it auto-generates a cryptographically random 256-bit
  token and persists it to `/data/admin-token` (mode `0600`) unless an initial `token` option (24+ characters) is provided. The Windows
  standalone runtime does the same in its local data directory.
- **Role-based access control** — three independent bearer tokens (`ADMIN_TOKEN`,
  `OPERATOR_TOKEN`, `VIEWER_TOKEN`) resolve admin/operator/viewer roles; every
  administrative route is tagged with a capability.
- **Ingress SSO (Home Assistant)** — identity comes from the ingress headers
  `X-Remote-User-Id`, `X-Remote-User-Name` and `X-Remote-User-Display-Name`
  (`X-Remote-User` / `X-Remote-Groups` are kept only as legacy fallbacks) and is
  trusted **only** on the ingress/admin listener, which accepts packets **only** from the
  Supervisor proxy (`172.30.32.2`) and loopback. The public listener never trusts SSO
  headers and never serves `/admin`.
- **Loopback isolation (Windows)** — the standalone runtime binds the admin listener
  to `127.0.0.1` only.
- **No secret leakage** — the diagnostics API requires administrative authentication
  and never returns secret keys or absolute storage paths.
- **Timing-safe token comparison** and per-peer authentication rate limiting on
  administrative routes (`AUTH_MAX_FAILURES` within a 60-second window).

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately to the maintainer identified in `repository.yaml`. Include:

1. Affected version(s).
2. A clear description of the issue and its impact.
3. Steps to reproduce, and any proof-of-concept you can share.

The maintainer will acknowledge receipt within 5 business days and work to validate,
fix, and coordinate disclosure. Please avoid public disclosure until a fix has been
released.

## Security Best Practices for Operators

- Treat the generated admin token as a secret. Rotate it by deleting the stored token
  file and restarting: `/data/.portal-admin-token` (add-on) or `admin-token` in the
  local data directory (Windows).
- Expose the add-on only through Home Assistant ingress, not directly to the internet.
- Keep Node.js 22.13+ and Home Assistant Supervisor up to date.

## Container image and vulnerability scanning

Docker Scout reports findings for the published image. They come from two places, and the
project treats them differently:

| Source | Examples (measured 2026-11-15) | What the project does |
| --- | --- | --- |
| Packages bundled **with npm** in the official `node:*` image | `npm/tar 7.5.11` (2 critical), `npm/brace-expansion 2.0.2`, `npm/ip-address 10.1.0` | **Removed from the image entirely.** The add-on has zero runtime npm dependencies, so the base is plain `alpine:3.24` and Node comes from the official musl tarball unpacked with `--exclude='*/npm' --exclude='*/npx' --exclude='*/corepack'`. Deleting npm in a later layer is *not* enough: the files stay in the layer history and keep being reported. |
| Alpine base packages | `alpine/zlib 1.3.2-r0` (1 critical, 1 high), `alpine/musl 1.2.6-r2` (high), `alpine/openssl 3.5.8-r0` (unscored) | Raised to the current fixes at build time (`apk upgrade --no-cache` is the first step). A rebuild picks up newer patches without a code change. |
| The Node runtime itself | `node 22.23.2` (high, fixable) | Fixed by bumping `ARG NODE_VERSION` in `hapi_enterprise/Dockerfile`. The version is pinned on purpose — a floating tag would make the release non-reproducible. |

What is **not** claimed: that the image has zero findings. A scanner will always report
findings in the base distribution and in the runtime; the measurable commitment is that no
package the add-on does not use travels with it, and that everything else is one pinned
version bump away. `tests/docker-runtime.cjs`, `tests/raspberrypi-compat.cjs` and scenario
S04 of `scripts/verify-release.cjs` fail if npm comes back into the image or if the base
stops being a plain Alpine.
