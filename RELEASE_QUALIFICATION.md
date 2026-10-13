# Portal Enterprise — release qualification history

**Status: BLOCKED / NOT PRODUCTION RELEASE.** Scope frozen: no new feature families.

## v0.50.0 — Home Assistant user roles in the admin console

**Status: BLOCKED for production release.** The Ingress SSO bridge is now end-to-end:
the admin console resolves the Home Assistant user's role and enforces it in the UI.

- `/admin/api/ingress-login` no longer returns an admin token to arbitrary Ingress users;
  it now returns the SSO identity (`role`/`user`/`groups`) or 401.
- `/admin/api/whoami` reports `{role, ingress, user}`; the front-end auto-logs-in from it
  and applies role-aware gating: viewer is read-only, operator can write, admin has full
  access. The manual bearer-token flow still works in standalone/Windows mode.
- Add-on options `user_roles` and `group_roles` (JSON maps) map Home Assistant usernames
  and groups to admin/operator/viewer; `run.sh` exports them as `USER_ROLES`/`GROUP_ROLES`.
- Tests updated: `ingress-isolation` (ingress-login 401), `rbac-sso` and `edge-runtime`
  (`whoami.user`). Full suite 55 PASS / 0 FAIL.

**Remaining production gates:** unchanged — no real Home Assistant Supervisor build,
Ingress browser session, custom-integration runtime, NAS/network-storage disconnection,
cross-filesystem recovery drill, or independent security review.

## v0.47.0 — synchronized source and package qualification (2026-10-11)

**Status: BLOCKED for production release.** The active source, test suite, Home Assistant
integration and release builders are now present together in the repository. The single
interactive Windows launcher is `START_hAPI_ENTERPRICE.bat`; old launcher entry points
were removed from the source and are excluded from generated packages.

- The qualification build checks JavaScript and Python syntax and requires every test
  process to exit successfully; a printed `PASS` by itself is not accepted.
- Local qualification: **45 PASS, 0 FAIL, 5 SYMLINK(environment blocked)**. The five
  symlink-specific cases could not create links because this Windows environment returns
  `EPERM`; they were reported separately, not counted as passed.
- Server-backed tests now wait for their child server to exit before deleting temporary
  SQLite data, avoiding the previous Windows `EBUSY` cleanup failures.
- An isolated check verified database-backed username/password authentication, rejection
  of an invalid password, session access to a private portal, no password-hash disclosure,
  and immediate access revocation when a user is disabled.
- The portable, platform and HACS source bundles are generated from the active tree, not
  copied from the older RC6 snapshot. The self-extracting installer preserves and starts
  the same interactive launcher after installing to the persistent application folder.

**Remaining production gates:** no real Home Assistant Supervisor build/installation,
Ingress browser session, custom-integration runtime, NAS/network-storage disconnection,
cross-filesystem recovery drill, or independent security review has been completed in this
Windows environment. A successful local package build does not clear these gates.

The entries below are historical notes written against earlier snapshots; their statuses
are not the current v0.47.0 qualification result above.

## Verified in this build
- Existing Node.js regression suites and new static bridge/runtime compatibility checks.
- Python syntax compilation and JavaScript syntax checks.
- Home Assistant bridge forwards HTTP Range/If-Range and returns Content-Range, Content-Length, Accept-Ranges and ETag for resumable transfers.
- Startup fails closed on Node versions lacking the required SQLite DatabaseSync API.

## Unverified or incomplete — release blockers
- No real Home Assistant Supervisor build, ingress/browser session, 8123 public bridge or network storage mount integration test.
- HA Ingress SSO is role-mapped (admin/operator/viewer) and the admin console is role-aware; a real Supervisor browser session to validate it end-to-end is still pending.
- Enterprise Job Manager, pause/resume/recovery and full RBAC are not implemented.
- SQLite transactions protect metadata, but not cross-filesystem atomicity with NAS, QR artifacts, uploads or audit events.
- Node.js 22.16.0 is pinned in Dockerfile; actual Supervisor build and runtime remain unverified.
- No tested security audit, real failure-injection, NAS disconnection, performance benchmark or disaster-recovery drill.
- `repository.yaml` and HA manifest documentation still contain repository URL placeholders.

**Do not label this archive final/stable until all mandatory gates pass.**

## v0.40 RC4
- Normal file upload now removes the newly created file when metadata persistence fails, matching the HTML upload rollback behavior.
- Added upload rollback guard test.
- Remaining blockers from RC3 are unchanged; no real Home Assistant Supervisor qualification.

## RC5
Storage marker integrity hardening tested locally. Release remains blocked on HA runtime integration, RBAC, job manager, NAS failure testing.

## RC6
- Hardened SQLite backup: verifies full `integrity_check`, creates destination without overwrite via exclusive hard-link, cleans temporary copy on error.
- Local regression suite passed. HA Supervisor and NAS failure scenarios remain unverified; RBAC and Job Manager remain incomplete. Release gate BLOCKED.

## RC7 snapshot integrity
- SQLite JSON compatibility snapshot uses an exclusive random temporary file, fsync, atomic rename, symlink refusal, and cleanup. SQLite remains authoritative.
- Production gate remains BLOCKED: RBAC, job manager, real HA and NAS testing incomplete.

## RC8 — Enterprise management modules
Implemented with real handlers + dedicated tests (not GUI-only stubs):
- Adaptive load control (`load-control.js`): heap-ratio + error-rate state machine driving effective download concurrency.
- Centralized bounded JSONL error log (`error-log.js`); wired into the top-level handler catch and download/restore error paths.
- Named configuration profiles (`config-profiles.js`) with atomic writes and `runtime-config` validation.
- Backup restore (`sqlite-store.js#restoreFrom`): integrity-checked, transactional round-trip; generic failure message (no internal path leak).
- Automatic storage availability/writability checks (`storage-check.js`) at startup + interval + on demand.
- RBAC capability matrix (`rbac.js`); all admin routes tagged with a capability; `adminGate(req,res,capability,method)`.

New tests: `error-log.cjs`, `config-profiles.cjs`, `load-control.cjs`, `storage-check.cjs`, `rbac.cjs`, `backup-restore.cjs` — all PASS. Full suite 39 PASS / 5 pre-existing Windows symlink `EPERM` failures (network-storage, sqlite-snapshot-safety, storage-migrate, storage-paths, storage) unrelated to this work.

**Remaining blockers (release gate still BLOCKED):**
- Real Home Assistant Supervisor build, ingress session, 8123 bridge, and NAS mount integration are untested.
- Cross-filesystem atomicity (SQLite metadata vs. NAS files/QR/audit) still unverified.
- No security audit, failure-injection, NAS-disconnection, benchmark, or disaster-recovery drill.

## v0.46.2 — platform distribution (Windows + Home Assistant)
Fixed a boot-breaking bug in the add-on `Dockerfile`: it omitted `rbac.js`, `error-log.js`, `config-profiles.js`, `storage-check.js`, and `load-control.js`, all required by `server.js`. Added `build-platforms.cjs` producing a Windows package (`-Windows.zip`) and a Supervisor-ready Home Assistant package (`-HA.zip`). `docker-runtime.cjs` now verifies the complete module manifest in the `COPY` instruction.

## v0.46.1 — repository URLs resolved (final)
`repository.yaml` `url` and `custom_components/portal_enterprise/manifest.json` `documentation` now resolve to `https://pasev.asuscomm.com/`, removing the last concrete placeholder. All other gates are environment-only (real HA Supervisor/NAS runtime qualification).

## v0.46.0 — desktop GUI full backend coverage
The `ui/` desktop GUI is now feature-complete against the admin API: bulk file policies with dry-run preview, load control, HTML project publish/register/unregister, QR artifact generation, config-profile create/apply/delete, API/file access key create+revoke, signed URLs + signing-key rotation, notes and attachments CRUD, taxonomy/metadata editing, settings write, and per-portal integrity scan/verify. Composite file-id parsing fixed so portal-scoped file actions target the correct file.

Local suite: 43 PASS / 0 FAIL / 5 pre-existing Windows symlink `EPERM` failures (network-storage, sqlite-snapshot-safety, storage-migrate, storage-paths, storage) unrelated to this work.

**Release gate still BLOCKED** only on real Home Assistant Supervisor/NAS runtime qualification (unverifiable in this Windows-only environment).

## v0.45.0 — edge/standalone runtime (HA + Windows)
One package running on the edge between Home Assistant and Windows:
- **`download_portal/standalone.js`** bootstraps the *same* `server.js` on a desktop: resolves a `node:sqlite`-capable runtime, creates a local data directory, generates/persists a unique admin token (`admin-token`), and boots with loopback-only binding (`ADMIN_BIND_HOST=127.0.0.1`, `PUBLIC_BIND_HOST=127.0.0.1`).
- **`server.js`** admin listener bind host is now configurable via `ADMIN_BIND_HOST` (default `0.0.0.0` unchanged for HA ingress).
- **`START_hAPI_ENTERPRICE.bat`** is the single interactive Windows launcher for the desktop GUI, browser admin panel, and backend-only mode.
- New test `edge-runtime.cjs` verifies token reuse, env resolution, standalone boot, admin GUI serving, `whoami` role resolution and public-listener isolation. The HA add-on and the demo `ui/` GUI are unchanged.

Local suite: 43 PASS / 0 FAIL / 5 pre-existing Windows symlink `EPERM` failures (network-storage, sqlite-snapshot-safety, storage-migrate, storage-paths, storage) unrelated to this work.

**Release gate still BLOCKED** only on real Home Assistant Supervisor/NAS runtime qualification (unverifiable in this Windows-only environment).

## v0.44.0 — final enterprise package (local qualification)
Completes the locally-qualifiable scope:
- **Persistent job manager** (`job-manager.js`): atomic JSON records, bounded FIFO, cooperative pause/resume/cancel, and crash recovery. `pause()` on a running job requests a cooperative pause (handler cooperates via `ctx.throwIfPaused()`); `resume()` re-enqueues paused work; `recover()` re-enqueues `queued` jobs and marks `running` jobs `interrupted` after a restart. New test `job-persistence.cjs` covers restart recovery, interrupted marker, pause/resume and cooperative pause.
- **HA Ingress SSO bridge** (`rbac.js` + `server.js`): `X-Remote-User`/`X-Remote-Groups` → admin/operator/viewer via `USER_ROLES`/`GROUP_ROLES`, trusted only on the ingress/admin listener. `GET /admin/api/whoami` reports the resolved role and `ingress:true`; the public listener never trusts SSO headers and never serves `/admin`. New test `rbac-sso.cjs` covers identity/group mapping, listener isolation and role enforcement.
- **Reproducible build** (`build.cjs`): JS/Python syntax checks, full test suite, deterministic ZIP emission.

Local suite: 42 PASS / 0 FAIL / 5 pre-existing Windows symlink `EPERM` failures (network-storage, sqlite-snapshot-safety, storage-migrate, storage-paths, storage) unrelated to this work.

**Release gate still BLOCKED** only on real Home Assistant Supervisor/NAS runtime qualification (unverifiable in this Windows-only environment).
