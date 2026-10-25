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
| `retention.js` | Retention + audit export; **никога не трие публикувано** (`EVIDENCE_NEVER_DELETED`) |
| `mirror-target.js` | Цел на огледалото: `path` (папка) или `s3` (SigV4 + Object Lock) зад един договор `put/get/remove` | `create`, `parseSpec`, `signV4`, `keyFor` |
| `site-csp.js` | CSP за недоверените HTML проекти: `sandbox` без `allow-same-origin`, `connect-src 'none'` | `forFile`, `isDocument` |

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

## QR договори, архиви и идентичност (0.69.75+)

| Module | Responsibility | Interface |
| ------ | -------------- | --------- |
| `portal-qr.js` | QR ревизии, манифести, физически архиви (`MAX_BRANCH_DEPTH_3`), `unpack()` за възстановяване | `ensureFirst`, `activeRevision`, `walk`, `manifestFor`, `buildArchive`, `unpack`, `stats` |
| `portal-integrity.js` | Проверка на целостта на архивите (`ARCHIVE_NOT_TAMPERED`, 8 кода за повреда), фонова задача | `verifyArchive`, `verifyPortal`, `verifyPortals`, `stats`, `schedule` |
| `content-id.js` | Идентичност на СЪДЪРЖАНИЕТО (`CT-…`) — от портал + SHA-256 + размер, не от името | `of`, `forFile` |
| `oidc.js` | OIDC вход: откриване, PKCE `S256`, проверка на ID token (`RS256` само), state/nonce | `config`, `createDiscovery`, `createFlows`, `verifyIdToken`, `sessionCookie`, `cookie` |

## HTTP компоненти (`routes/`)

Единадесет компонента с един и същ договор: `create(deps)` → `handle({req,res,url,parts,method,portal})`,
който връща `true`, когато заявката е за него. Пълният списък на маршрутите е в
[`API_ENDPOINT_REFERENCE.md`](../02_TO_BE_ARCHITECTURE/API_ENDPOINT_REFERENCE.md) (генериран от
`admin-api-spec.js`, проверяван от `tests/api-reference.cjs` и `tests/server-structure.cjs`).

| Component | Responsibility |
| --------- | -------------- |
| `routes/admin-docs.js` | Договорът за административното API (`GET /admin/api/*`, OpenAPI) |
| `routes/file-transfer.js` | Преместване/копиране на файл между портали: сверка по SHA-256, нов `content_id`, откази за доказателство/ключалка/версии |
| `routes/folders.js` | Папки на портала: нова, флагове (видима/медийна/заключена), изтриване |
| `routes/generator.js` | Document Generator — HTTP частта на шаблоните |
| `routes/link-check.js` | Проверка дали един публичен адрес наистина се отваря |
| `routes/oidc.js` | `/api/v1/auth/oidc/login` и `/callback` (PKCE) |
| `routes/pgp-keyring.js` | PGP ключохранилище: преглед и препрочитане |
| `routes/portal-qr.js` | QR ревизии: архивиране, прекратяване, проверка, възстановяване |
| `routes/portal-storage.js` | `order` (вкл. `/portal.html:<папка>`), договор `file`, изтегляне по път, `ping`, публичен `qr.json` |
| `routes/portal-tokens.js` | Публични токени за портал (`/t/<token>` + админ списък) |
| `routes/reports.js` | Report Studio + RFC 3161: рендер, пакет с доказателства, CMS подпис, времеви печати |

Освен тях в HTTP слоя има два модула, които НЕ са маршрути, защото работят ПРЕДИ
маршрутирането (`tests/server-structure.cjs` проверява договора само на `routes/`):

| Module | Responsibility |
| ------ | -------------- |
| `problem.js` | Тялото на грешката по RFC 9457 (`type`/`title`/`status`/`detail` заедно със старото `error`); типът остава `application/json` |
| `idempotency.js` | `Idempotency-Key`: повторена заявка получава запазения първи отговор, без да изпълни действието втори път. Ключът е вързан за самоличността на викащия, друго тяло → `422`, заявка в ход → `409` с `Retry-After` |

## Operations

| Module | Responsibility |
| ------ | -------------- |
| `job-manager.js` | Job queue |
| `load-control.js` | Adaptive concurrency |
| `config-profiles.js` | Config profiles |
| `error-log.js` | Error log |
| `storage-check.js` / `storage-migrate.js` / `storage-preflight.js` | Storage ops |
| `migration-bridge.js` | Migration |
