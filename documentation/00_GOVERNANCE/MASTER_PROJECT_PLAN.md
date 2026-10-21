# Master Project Plan — hAPI Enterprise

> Canonical reference for execution: [`docs/plan/15-unified-master-plan-v6.0.md`](../../docs/plan/15-unified-master-plan-v6.0.md).
> This file summarises it; the phase plans under `docs/plan/` hold the detail.
> ADR-0024 records the consolidation decision.

## 1. Delivery approach

Single Node.js process, SQLite (`node:sqlite` `DatabaseSync`), no external microservices.
Incremental delivery in **phases**, each phase closing with a Definition of Done (see
`DEFINITION_OF_DONE.md`) and an ADR.

## 2. Phase plan (v6.0)

| Phase | Name | Status | Key deliverable |
| ----- | ---- | ------ | --------------- |
| 0 | Consolidation | ✅ Complete | One canonical plan, `archive/`, one docs index |
| 1 | Core (variable hierarchy) | ✅ Complete | Registry, variable store, groups/profiles/records, orphan association |
| 2 | Flexibility | ✅ Complete | DI container, Event Bus, Repository interface |
| 3 | Integrity (signing) | ✅ Complete | HMAC-SHA256 signing |
| 4 | Document processing + QR sharing | ✅ Complete | Preview, thumbnails, versioning, watermarks, PDF/OOXML, QR landing + revocation |
| 5 | Settings + progress center | 🟡 Planned | Settings UI, progress/status popup |
| 6 | Migration | 🟡 Planned | Zero-damage folder/document migration |
| 7 | Evidence portal | 🟡 Planned | Judge/prosecutor portal with cryptographic proof |
| 8 | Public API v2 + SDK | 🆕 New | Contract-first OpenAPI 3.1, scoped tokens, JS SDK, webhooks |
| 9 | Packaging & delivery | 🆕 New | One build → six packages, WebView2 runtime, six banners |
| 10 | Quality & CI | 🆕 New | HA integration test, Playwright UI, Enterprise Control Center, `BUG-01…11` |
| 11 | Report Studio | 🆕 New | Manifest-driven reports, locked `RFC 3161 START → STOP`, A4/PDF (ADR-0025) |

## 3. Workstreams

1. **Core & domain** — DOCFLOW hierarchy, registry, profiles.
2. **Security & crypto** — RBAC, SSO, encryption, signing, timestamps, key management.
3. **Documents** — preview, extraction, versioning, watermarks.
4. **Sharing & portal** — QR artifacts, portal, evidence verification.
5. **Public API & integrations** — contract-first API, SDK, HA bridge, webhooks.
6. **Operations** — backups, job queue, diagnostics, retention, migration.
7. **Packaging** — HA add-on (HACS), Windows runtime, Docker/edge.

## 4. Governance cadence

- Every architectural decision → ADR (`documentation/03_ADR/`).
- Every change → Change Control (`CHANGE_CONTROL.md`).
- Every release → Release gate (`documentation/07_RELEASE/`).

## 5. Risks and dependencies

Tracked in `RISK_REGISTER.md` and `DEPENDENCY_REGISTER.md`.
