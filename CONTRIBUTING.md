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

## Publishing a Release

The version lives in `hapi_enterprise/config.yaml` only. Build the artifacts with

```bash
npm run release        # build-release --with-tests + verify-release
npm run release:haoss  # standalone HACS tree in release/haoss (+ snapshots)
npm run changelog:addon  # hapi_enterprise/CHANGELOG.md, which Supervisor shows
```

and publish a GitHub release with the interactive publisher:

```bash
pwsh -File release/publish-release.ps1                                   # dry run
pwsh -File release/publish-release.ps1 -Source release/haoss_v.0.63.0 -Execute
```

Without `-Execute` nothing is uploaded: the script runs every check, prints the release
text and the exact `gh` command. It walks eleven layers and asks at each decision instead of
picking one — which repository (list from `gh repo list`, `-Repo` is only the pre-selected
answer), where the new version is (`release/haoss_v.*`, `release/haoss`, `dist/*.tar.gz`,
manual path, or build it on the spot), whether artifacts and versions agree with the
working copy, whether `SHA256SUMS.txt` matches the files, and what to do if the tag or the
release already exists.

| Option                               | Meaning                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `-Source <path>`                     | Folder with `custom_components/hapi_enterprise/manifest.json`, or `dist/hapi_enterprise-<version>.tar.gz` |
| `-Repo owner/name`                   | Pre-selected repository (still asked interactively)                                                       |
| `-TagName` / `-Title`                | Override the tag or the release title                                                                     |
| `-Target <ref>`                      | Where the tag is created when it does not exist yet (default `main`)                                      |
| `-Draft` / `-Prerelease` / `-Latest` | Release flags                                                                                             |
| `-Execute`                           | Actually publish; requires typing the version unless `-Force`                                             |
| `-Force`                             | Allow a version that differs from the working copy, and update an existing release                        |
| `-Yes`                               | Non-interactive: take the safe defaults (`-Execute` still required)                                       |
| `-Hacs`                              | After a successful publish, also update the HACS repository without asking                                |
| `-SkipHacs`                          | Never offer the HACS repository in this run                                                               |
| `-Retries` / `-LogFile`              | Retry budget for `gh` calls, and where the run log goes                                                   |

**Tags and CI.** Pushing a `v*` tag triggers `.github/workflows/release.yml`, which rebuilds
on Ubuntu, attaches the same artifact names and regenerates the release notes. A release
created together with its tag can therefore have its text replaced a minute later. The
script warns about this before creating a tag and offers the safe order: create only the
tag, wait for the Release workflow, then run the publisher again with `-Force` — the tag
already exists, CI does not rerun, and the script only updates the text and verifies the
attached files. A tag without the `v` prefix (e.g. `0.63.0`) matches no workflow trigger,
so the script offers to rename it to `v0.63.0`; and a dry run never creates a tag. The
eleventh layer then asks whether to refresh the HACS repository too. HACS reads the
integration from `release/haoss`, which is a separate repository, so the add-on release
does **not** update it: answering `y` runs `scripts/publish-haoss.ps1 -Version <version>
-Execute` (the same script as `npm run publish:haoss`), `p` only shows its commands, and
`n` leaves HACS alone. In non-interactive mode (`-Yes`) HACS is never published unless
`-Hacs` is given, and a release deleted in layer 9 skips the step entirely.

## Updating the Repository

`H:` is an SMB share, so `git` started there hangs — even `git config --global`. That is why
the repository updater works on a clone under `%TEMP%`:

```bash
pwsh -File scripts/update-repo.ps1            # dry run: shows the diff, writes nothing
pwsh -File scripts/update-repo.ps1 -Execute   # commit + push after confirmation
```

The script asks which repository and branch, exports only what git would track
(`scripts/export-tracked.cjs`, which follows `.gitignore` and refuses secrets), runs
`scripts/pre-push-audit.cjs`, converts the export to LF (`.gitattributes` requires it —
otherwise git reports hundreds of phantom changes), and then shows new/modified/deleted
files. Deletions are the only destructive step and stay off unless chosen explicitly.
It never force-pushes; a rejected push is resolved with `pull --rebase` (aborted on
conflict, so nothing is lost). `-Yes` accepts the safe defaults, `-AllowDelete` is needed
for deletion in that mode, `-Reuse` keeps the existing clone.

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
