# Module Catalog — hAPI Enterprise (As-Is)

## Core & domain

| Module | Responsibility | Interface |
| ------ | -------------- | --------- |
| `registry.js` | Profile/field/type/validation definitions | Registry API |
| `core-store.js` | Groups/profiles/records/variables | Store API |
| `directory.js` | Directory (pointer) profiles | — |
| `cabinet.js` | Cabinet (case/document) profiles | — |

## Infrastructure

| Module | Responsibility |
| ------ | -------------- |
| `container.js` | DI container |
| `event-bus.js` | Pub/sub events |
| `repository.js` → `sqlite-repository.js` | Data access abstraction |
| `sqlite-store.js` | Transactional SQLite |
| `api-version.js` | API versioning |
| `plugins.js` | Plugin loading |

## Security & crypto

| Module | Responsibility |
| ------ | -------------- |
| `rbac.js` | Roles (admin/operator/viewer) + SSO mapping |
| `signer.js` | Integrity receipts (HMAC-SHA256) |
| `file-crypto.js` | Encryption at rest (AES-256-GCM) |
| `audit-chain.js` | Hash-chained append-only audit |
| `retention.js` | Retention + audit export |

## Documents

| Module | Responsibility |
| ------ | -------------- |
| `preview.js` | Preview + thumbnails |
| `ooxml.js` | xlsx/pptx extraction |
| `pdf-writer.js` | PDF images/tables/watermarks |
| `versioning.js` | Version history + restore |

## Sharing & portal

| Module | Responsibility |
| ------ | -------------- |
| `portal.js` | Public landing portal |
| `notify.js` | HA notify dispatch |
| `qrcode.js` | QR generation |

## Operations

| Module | Responsibility |
| ------ | -------------- |
| `job-manager.js` | Job queue |
| `load-control.js` | Adaptive concurrency |
| `config-profiles.js` | Config profiles |
| `error-log.js` | Error log |
| `storage-check.js` / `storage-migrate.js` / `storage-preflight.js` | Storage ops |
| `migration-bridge.js` | Migration |
