# Integration Contracts — hAPI Enterprise (To-Be)

## API versioning

| Version      | Scope                                   |
| ------------ | --------------------------------------- |
| `/api/v1`    | current admin API (HA + Windows)        |
| `/api/v2`    | schema-validated API (Phase 6–7 target) |
| `/verify/v1` | public evidence verification (Phase 7)  |

## HA add-on contract

| Interface      | Detail                                                   |
| -------------- | -------------------------------------------------------- |
| Ingress        | `/` → 302 към `<ingress>/ui/` (панелът)                  |
| Panel          | `panel_custom` → admin                                   |
| HACS component | fail-closed read bridge `/api/hapi_enterprise/v1/{tail}` |
| Storage        | `/data` add-on volume (config-specified)                 |
| Secrets        | `secrets.yaml` (optional, dev)                           |

### Адрес на API-то от панела (INV-C1)

Под Ingress документът живее на `/api/hassio_ingress/<token>/ui/`, а add-on-ът е на
същия префикс. Затова **всяка** заявка от панела и от генератора се строи като
`origin + ingress префикс + път` — никога като `location.origin + път` и никога като
абсолютен `/admin/...`:

- `ui/api-base.js` е единственото място, което разпознава префикса
  (`/api/hassio_ingress/<token>`, `/hassio/ingress/<token>`, `/app/<token>`, `/hapi/<token>`);
- панелите взимат базовия адрес от `window.hapiApiBase()`, а генераторът — от
  `location.pathname`;
- `hapi.apiBase` (Настройки → Връзка) остава с предимство (standalone/външен адрес);
- при `file://` базовият адрес е празен — демо режим, без фалшива „връзка“.

Проверява се от `tests/ingress-api-base.cjs` (единични случаи за всички форми на
префикса + жива проверка, че API-то отговаря под префикса).

## Windows contract

| Interface | Detail                            |
| --------- | --------------------------------- |
| Backend   | `http://127.0.0.1:8098/` loopback |
| Admin     | `/admin`                          |
| Desktop   | pywebview loads backend URL       |

## Evidence portal contract (Phase 7)

| Interface | Detail                                            |
| --------- | ------------------------------------------------- |
| Read      | `GET /verify/v1/records/{id}/manifest`            |
| Files     | `GET /verify/v1/records/{id}/files/{n}`           |
| Verify    | hash/signature/timestamp recompute client-side    |
| Auth      | time-limited token embedded in QR (never secrets) |

## Events / webhooks (target)

- `document.finalized`, `access.created`, `audit.anchored`, `job.completed`.
- Delivery: SSE (live) + optional webhook (audit consumers).
