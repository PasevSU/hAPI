# Master Project Plan — hAPI Enterprise

> Canonical reference for execution. Superseded in detail by the phase plans under `docs/plan/`.

## 1. Delivery approach

Single Node.js process, SQLite (`node:sqlite` `DatabaseSync`), no external microservices.
Incremental delivery in **phases**, each phase closing with a Definition of Done (see
`DEFINITION_OF_DONE.md`) and an ADR.

## 2. Phase plan

| Phase | Name | Status | Key deliverable |
| ----- | ---- | ------ | --------------- |
| 1 | Core (variable hierarchy) | ✅ Complete | Registry, variable store, groups/profiles/records, orphan association |
| 2 | Flexibility | ✅ Complete | DI container, Event Bus, Repository interface |
| 3 | Integrity (signing) | ✅ Complete | HMAC-SHA256 signing |
| 4 | Document processing + QR sharing | ✅ Complete | Preview, thumbnails, versioning, watermarks, PDF/OOXML, QR landing + revocation |
| 5 | Settings + progress center | 🟡 Planned | Settings UI, progress/status popup |
| 6 | Migration | 🟡 Planned | Zero-damage folder/document migration |
| 7 | Evidence portal | 🟡 Planned | Judge/prosecutor portal with cryptographic proof |

## 3. Workstreams

1. **Core & domain** — DOCFLOW hierarchy, registry, profiles.
2. **Security & crypto** — RBAC, SSO, encryption, signing, timestamps, key management.
3. **Documents** — preview, extraction, versioning, watermarks.
4. **Sharing & portal** — QR artifacts, landing portal, evidence verification.
5. **Operations** — backups, job queue, diagnostics, retention, migration.
6. **Packaging** — HA add-on (HACS) and Windows runtime.

## 4. Governance cadence

- Every architectural decision → ADR (`documentation/03_ADR/`).
- Every change → Change Control (`CHANGE_CONTROL.md`).
- Every release → Release gate (`documentation/07_RELEASE/`).

## 5. Risks and dependencies

Tracked in `RISK_REGISTER.md` and `DEPENDENCY_REGISTER.md`.
