# Contributing to hAPI ENTERPRICE

Thank you for helping improve hAPI ENTERPRICE — Home Assistant Portal Enterprise.

## Ground Rules

- The project runs one shared backend (`download_portal/server.js`) for both the
  Home Assistant add-on and the Windows edge runtime. Keep that invariant: do not
  fork behavior between environments.
- Enterprise features must ship as **real handlers plus tests**, not UI-only buttons.
- Diagnostics and admin APIs must never leak secrets or absolute storage paths.

## Development Setup

Requirements:

- Node.js 22.13+ (the backend uses the built-in `node:sqlite` module).
- Python 3 + `pywebview` + Microsoft Edge WebView2 Runtime (Windows GUI only).
- Home Assistant Supervisor (add-on runtime qualification only).

```bash
# Clone the repository (canonical URL is in repository.yaml)
cd hAPI_enterprice

# Home Assistant mode: export ADMIN_TOKEN / DATA_DIR, then
node download_portal/server.js

# Windows edge runtime (auto-generates its admin token and data directory)
node download_portal/standalone.js
```

## Build & Test

The reproducible build syntax-checks all JavaScript and Python, runs the full test
suite, and emits a deterministic ZIP:

```bash
node build.cjs
```

Platform packages (Windows + Home Assistant) are produced by:

```bash
node build-platforms.cjs
```

The self-extracting Windows installer (embedded Node runtime) and the complete
HACS-ready repository bundle are produced by:

```bash
node build-release.cjs
```

Add-on boot correctness (module completeness in the `Dockerfile`) is asserted by
`tests/docker-runtime.cjs` and executed as part of `build.cjs`.

## Code Style

- JavaScript: plain CommonJS, Node built-ins only (no runtime npm dependencies).
- Python: standard library plus `webview` only.
- Prefer explicit, defensive error handling; never trust forwarded IP or SSO headers
  on the public listener.

## Submitting Changes

1. Fork the repository and create a branch.
2. Add or update tests for your change.
3. Run `node build.cjs` and confirm **all tests pass**.
4. Open a pull request with a clear description and reference any related issue.

By contributing you agree that your contribution is licensed under the
Apache License 2.0 (see `LICENSE`).
