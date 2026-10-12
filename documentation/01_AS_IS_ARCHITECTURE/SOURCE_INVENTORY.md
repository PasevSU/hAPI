# Source Inventory — hAPI Enterprise (As-Is)

> Reflects `hapi_enterprise/` at v0.50.0.

## Backend modules (single Node.js process)

| File | Purpose |
| ---- | ------- |
| `server.js` | Main HTTP backend (HA + Windows); routes, auth, admin API |
| `standalone.js` | Windows edge bootstrap |
| `runtime-config.js` | Runtime configuration / branding / limits |
| `container.js` | Dependency injection container |
| `event-bus.js` | Event bus (observable behavior) |
| `registry.js` | Metadata-driven profile/field registry |
| `plugins.js` | Plugin registry |
| `core-store.js` | Core variable/group/profile store |
| `repository.js` | Repository interface |
| `sqlite-repository.js` | SQLite repository implementation |
| `sqlite-store.js` | Low-level SQLite (`node:sqlite`) store |
| `api-version.js` | API versioning |
| `directory.js` | Directory / pointer profiles |
| `cabinet.js` | Cabinet / case profiles |
| `preview.js` | Document preview + thumbnails |
| `ooxml.js` | xlsx/pptx extraction |
| `pdf-writer.js` | PDF generation, watermarks, tables |
| `versioning.js` | Document versioning |
| `signer.js` | HMAC-SHA256 receipts / signing |
| `file-crypto.js` | AES-256-GCM encryption at rest |
| `audit-chain.js` | Hash-chained audit log |
| `rbac.js` | Role-based access control |
| `retention.js` | Retention policies |
| `job-manager.js` | Job queue (progress, cancel, pause) |
| `load-control.js` | Adaptive load control |
| `config-profiles.js` | Named configuration profiles |
| `error-log.js` | Bounded JSONL error log |
| `notify.js` | E-mail/SMS via HA notify hooks |
| `migration-bridge.js` | Migration helpers (Phase 6) |
| `storage-check.js` | Storage availability/write checks |
| `storage-migrate.js` | Storage migration |
| `storage-preflight.js` | Preflight validation |
| `qrcode.js` | Vendored QR generator |

## UI / web

| File | Purpose |
| ---- | ------- |
| `admin.html` / `admin.js` | Web admin console |
| `portal.html` / `portal.css` / `portal.js` | Public QR landing portal |

## Packaging

| File | Purpose |
| ---- | ------- |
| `config.yaml` | Add-on metadata / options |
| `Dockerfile` | Add-on image |
| `run.sh` | Add-on entrypoint |
| `icon.png` / `logo.png` | Brand assets |

## HACS component

`custom_components/hapi_enterprise/` — `__init__.py`, `manifest.json`, `portal.*`,
`icon.png`, `logo.png` (fail-closed read bridge).

## Tests

`tests/*.cjs` (~80 files) — integration/unit suite, run via `node tests/*.cjs`.
