# Portal Enterprise — release qualification history

**Текущо квалифицирано издание: 0.69.28** — публикува се като custom add-on (Supervisor repo) и
като HACS интеграция. Издаването минава през Release workflow (таг → CI → артефакти), а не през
ръчно качване. Единственият източник за актуалното състояние е
[`reports/RELEASE-STATUS.md`](reports/RELEASE-STATUS.md) — той се генерира заедно с изданието
и носи точните числа (тестове, сценарии, одит, артефакти).

**Всичко по-долу е ИСТОРИЯ** от предишни снимки и **не** описва текущото състояние. Ако
цифрите тук и в `reports/RELEASE-STATUS.md` се разминават, важи `RELEASE-STATUS.md`.

## v0.69.28 — актуална квалификация (2026-10-22)

Обхват: доказателствената верига. Изданието не добавя функции — прави така, че зеленият
резултат да значи нещо и извън една машина.

- Отчетът за състоянието вече не съдържа `sha256`, обем и дата на архива: те се сменят при
  друго сглобяване, при друг checkout (CRLF срещу LF) и дори сами на следващия ден, а
  проверката е байтова. Отпечатъците остават в `dist/RELEASE.json` и `SHA256SUMS.txt`.
- Ключалката на данните се създава атомарно (временен файл + hard link); прясна ключалка не
  се отнема, а CAS отказът се повтаря, вместо да става 409 за запис, който никой не е загубил.
- Нов `tests/shared-data-lock.cjs` пази точно тези две правила.
- Документацията спира да твърди остаряло (`docs/plan/17`, `20`, `21`,
  `documentation/07_RELEASE/AUDIT-PROTOCOL.md`).

### Проверени локални гейтове

| Гейт                           | Команда                                   | Резултат                                             |
| ------------------------------ | ----------------------------------------- | ---------------------------------------------------- |
| Пълен тестов пакет             | `node scripts/test-matrix.cjs`            | **206/206** (1 опит)                                 |
| Издателски сценарии            | `node scripts/verify-release.cjs`         | **20/20**                                            |
| GUI + съвместимост + изданието | `npm run audit:gui`                       | GUI 33/33 · съвместимост 28/28 · изданието проверено |
| Логически одит                 | `node scripts/logic-audit.cjs --gate`     | чисто (0 отворени, 7 с обосновка)                    |
| Скенер за лош код              | `node scripts/bad-code-scan.cjs --gate`   | чисто (critical/high/medium = 0)                     |
| Отчет за състоянието           | `node scripts/release-status.cjs --check` | ✔ актуален                                           |

### Какво остава непроверено извън тази среда

- Реален build и инсталация през Home Assistant Supervisor и браузърна Ingress сесия.
- Прекъсване на NAS/мрежово хранилище и cross-filesystem recovery drill; независим security review.
- PDF/A-3 не е заверен с veraPDF; Evidence Package и статусите `DRAFT`/`INCOMPLETE` в GUI
  остават от W7 — виж [`docs/plan/17-portal-files-management-plan.md`](docs/plan/17-portal-files-management-plan.md).

## v0.62.1 — предишна квалификация (2026-10-21)

Обхват: втвърдяване на издателската верига след инцидент с изтекъл частен ключ.
Няма промяна във функционалността спрямо 0.62.0 — само защита срещу повторение.

- `scripts/export-tracked.cjs` — публикуването минава през „export на tracked файлове“
  (спазва `.gitignore`), вместо сляпо копиране на директорията.
- `scripts/secret-patterns.cjs` — общи правила за тайни, ползвани и от `pre-push-audit`,
  включително цял PGP частен блок и подозрителни имена (`private.asc`, `*.pem`, `*.key`).
- `scripts/publish-addon-repo.ps1` — одитът се пуска **винаги** и спира публикуването
  при намерена тайна (exit 3).
- `.gitignore` — блокира `PGP_CryptoSAK_keys-*/`, `**/private.asc`, `id_rsa*`, `*.pem`, `*.pfx`.
- `tests/export-tracked.cjs` — нов тест за експорта (спазване на `.gitignore`, `--clean`,
  блокиране на частен ключ).
- `scripts/run-tests.cjs` — обобщава и повтаря имената на провалените тестове накрая.

### Проверени локални гейтове

| Гейт                               | Команда                           | Резултат                                    |
| ---------------------------------- | --------------------------------- | ------------------------------------------- |
| Пълен тестов пакет                 | `node scripts/run-tests.cjs`      | **135/135** файла минават (4 поредни пуска) |
| HA съвместимост (проект-wide одит) | `node tests/ha-compatibility.cjs` | **42/42** правила · 0 блокера · **100%**    |
| Издателски сценарии (S01–S21)      | `node scripts/verify-release.cjs` | **20/20**                                   |
| Готово HACS хранилище              | `node tests/haoss-release.cjs`    | структура, версия, brand, без тайни         |
| Документация                       | `node tests/docs-consistency.cjs` | 0.62.1, без счупени връзки                  |
| Одит преди публикуване             | `node scripts/pre-push-audit.cjs` | 457 файла · 8 игнорирани · **0 тайни**      |

### Публикувано

- Add-on хранилище `PasevSU/hAPI` — `config.yaml` версия **0.62.1** (единствен източник).
- HACS хранилище `PasevSU/hapi-enterprise-integration` — таг `v0.62.1`, GitHub Release "Latest",
  CI (`Validate` = hassfest + HACS action) зелен за `main` и за тага.

## v0.62.0 — предишна квалификация (2026-10-21)

Обхват: „Бърз линк“ (Send-lite) — публичен достъп до един файл с безсрочен режим по
подразбиране, парола по избор, лимит на свалянията, срок по избор и отмяна; премахнат
админ токен от човешкия поток на панела (Ingress идентичност).

### Проверени локални гейтове

| Гейт                               | Команда                           | Резултат                                 |
| ---------------------------------- | --------------------------------- | ---------------------------------------- |
| Пълен тестов пакет                 | `node scripts/run-tests.cjs`      | **133/133** файла минават                |
| HA съвместимост (проект-wide одит) | `node tests/ha-compatibility.cjs` | **42/42** правила · 0 блокера · **100%** |
| Издателски сценарии (S01–S19, S21) | `node scripts/verify-release.cjs` | **20/20**                                |
| Готово HACS хранилище              | `node tests/haoss-release.cjs`    | структура, версия, brand, без тайни      |
| Документация                       | `node tests/docs-consistency.cjs` | 0.62.0, без счупени връзки               |

## v0.61.3 — предишна квалификация (2026-10-21)

Обхватът е замразен: няма нови функционални семейства, само съвместимост с Home Assistant,
издателска хигиена и готовност за HACS.

### Проверени локални гейтове

| Гейт                               | Команда                           | Резултат                                 |
| ---------------------------------- | --------------------------------- | ---------------------------------------- |
| Пълен тестов пакет                 | `node scripts/run-tests.cjs`      | **132/132** файла минават (към 0.61.3)   |
| HA съвместимост (проект-wide одит) | `node tests/ha-compatibility.cjs` | **42/42** правила · 0 блокера · **100%** |
| Издателски сценарии (S01–S19, S21) | `node scripts/verify-release.cjs` | **20/20**                                |
| Готово HACS хранилище              | `node tests/haoss-release.cjs`    | структура, версия, brand, без тайни      |
| Документация                       | `node tests/docs-consistency.cjs` | 0.61.3, без счупени връзки               |

### Какво е покрито

- **Entrypoint е чист JavaScript** — `hapi_enterprise/start.js`; `run.sh` е премахнат.
  Гейт за Node ≥ 22.13 и `node:sqlite`, storage preflight, admin token във файл `0600`
  без печат в лога, `SIGTERM`/`SIGINT` с чист изход.
- **Ingress** — идентичност от реалните HA заглавки (`X-Remote-User-Name`, `-Id`,
  `-Display-Name`), peer allowlist на admin listener-а (`172.30.32.2` + loopback),
  обработка на `X-Ingress-Path`, относителни asset URL.
- **`config.yaml`** — `homeassistant_api: true`, `map` с `app_config/media/share/ssl`,
  `backup: cold`, watchdog на `:8099/health`, 30 опции със схема и преводи en+bg.
- **RBAC + HA SSO** — роли по потребител/група, `ingress-login`, чувствителните
  `/admin/api/*` пътища не се проксират от интеграцията (fail-closed allowlist).
- **Изданията в `dist/`** — tar.gz за add-on, zip за интеграция, `repository.yaml`,
  `RELEASE.json`, `SHA256SUMS.txt`; съдържанието съвпада с дървото и архивът се чете
  от системния `tar`.
- **HACS** — `npm run release:haoss` произвежда самостоятелно хранилище в `release/haoss`
  (`hacs.json`, README, LICENSE, `brand/icon.png`, CI с hassfest + HACS action).

### Какво остава непроверено извън тази среда

- Реален build и инсталация през Home Assistant Supervisor и браузърна Ingress сесия.
- Прекъсване на NAS/мрежово хранилище и cross-filesystem recovery drill.
- Независим security review.
- Rating-забележки, които HA приема: контейнерът работи като root без AppArmor профил
  и `armv7` е deprecated `arch` (приема се с warning).

## История (предишни снимки)

### v0.47.0 — synchronized source and package qualification (2026-10-11)

**Status: BLOCKED for production release.** The active source, test suite, Home Assistant
integration and release builders are now present together in the repository. The single
interactive Windows launcher is `START_hAPI_Enterprise.bat`; old launcher entry points
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
- Administrator still enters a separate bearer token; HA Ingress identity is not integrated with a complete RBAC model.
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
`repository.yaml` `url` and `custom_components/hapi_enterprise/manifest.json` `documentation` now resolve to `https://pasev.asuscomm.com/`, removing the last concrete placeholder. All other gates are environment-only (real HA Supervisor/NAS runtime qualification).

## v0.46.0 — desktop GUI full backend coverage
The `ui/` desktop GUI is now feature-complete against the admin API: bulk file policies with dry-run preview, load control, HTML project publish/register/unregister, QR artifact generation, config-profile create/apply/delete, API/file access key create+revoke, signed URLs + signing-key rotation, notes and attachments CRUD, taxonomy/metadata editing, settings write, and per-portal integrity scan/verify. Composite file-id parsing fixed so portal-scoped file actions target the correct file.

Local suite: 43 PASS / 0 FAIL / 5 pre-existing Windows symlink `EPERM` failures (network-storage, sqlite-snapshot-safety, storage-migrate, storage-paths, storage) unrelated to this work.

**Release gate still BLOCKED** only on real Home Assistant Supervisor/NAS runtime qualification (unverifiable in this Windows-only environment).

## v0.45.0 — edge/standalone runtime (HA + Windows)
One package running on the edge between Home Assistant and Windows:
- **`download_portal/standalone.js`** bootstraps the *same* `server.js` on a desktop: resolves a `node:sqlite`-capable runtime, creates a local data directory, generates/persists a unique admin token (`admin-token`), and boots with loopback-only binding (`ADMIN_BIND_HOST=127.0.0.1`, `PUBLIC_BIND_HOST=127.0.0.1`).
- **`server.js`** admin listener bind host is now configurable via `ADMIN_BIND_HOST` (default `0.0.0.0` unchanged for HA ingress).
- **`START_hAPI_Enterprise.bat`** is the single interactive Windows launcher for the desktop GUI, browser admin panel, and backend-only mode.
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
