# Contributing to hAPI Enterprise

Thank you for helping improve hAPI Enterprise — Home Assistant Portal Enterprise.

## Ground Rules

- The project runs one shared backend (`hapi_enterprise/server.js`) for both the
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
cd hAPI_enterprise

# Home Assistant mode: export ADMIN_TOKEN / DATA_DIR, then
node hapi_enterprise/server.js

# Windows edge runtime (auto-generates its admin token and data directory)
node hapi_enterprise/standalone.js
```

## Build & Test

Run the integration tests individually (each spawns `hapi_enterprise/server.js` with
its own `DATA_DIR`, `ADMIN_TOKEN` (≥24 chars) and `PORT`):

```bash
node tests/<name>.cjs
```

Run the whole package — every file in `tests/` (100+ scenarios) — with

```bash
npm test            # = node scripts/test-matrix.cjs
```

The matrix runner executes **all** tests from the beginning, and if anything fails it
**restarts the whole series from scratch**, repeating until 100% success (default 5
attempts; `--attempts=N` to change it, `--only=rbac` to narrow). It always starts with a
sanitised environment, so a leaked `DATA_DIR`/`INGRESS_MODE`/`ADMIN_PORT` cannot produce
misleading 401/404 failures. A run only counts as success at `118/118`; remaining
failures exit non-zero and are listed explicitly. The JSON report lands in
`reports/test-matrix.json` (per-test timings, attempts, flaky tests).

`tests/scenario-matrix.cjs` keeps the package honest: every route served by
`hapi_enterprise/server.js`, every RBAC capability in `rbac.js` and every option in
`config.yaml` must be referenced by at least one test, and each scenario area in its map
must keep a living owner file. A new endpoint without a test fails the suite immediately.

The full suite is asserted by `tests/docker-runtime.cjs` (module completeness in the
`Dockerfile`).

## Code Style

- JavaScript: plain CommonJS, Node built-ins only (no runtime npm dependencies).
- Python: standard library plus `webview` only.
- Prefer explicit, defensive error handling; never trust forwarded IP or SSO headers
  on the public listener.

## Submitting Changes

1. Fork the repository and create a branch.
2. Add or update tests for your change.
3. Run `node tests/<name>.cjs` for your change and confirm **all tests pass**.
4. Open a pull request with a clear description and reference any related issue.

By contributing you agree that your contribution is licensed under the
Apache License 2.0 (see `LICENSE`).
