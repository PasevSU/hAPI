# Integration Contracts — hAPI Enterprise (To-Be)

## API versioning

| Version | Scope |
| ------- | ----- |
| `/api/v1` | current admin API (HA + Windows) |
| `/api/v2` | schema-validated API (Phase 6–7 target) |
| `/verify/v1` | public evidence verification (Phase 7) |

## HA add-on contract

| Interface | Detail |
| --------- | ------ |
| Ingress | `/` → admin console |
| Panel | `panel_custom` → admin |
| HACS component | fail-closed read bridge `/api/hapi_enterprise/v1/{tail}` |
| Storage | `/data` add-on volume (config-specified) |
| Secrets | `secrets.yaml` (optional, dev) |

## Windows contract

| Interface | Detail |
| --------- | ------ |
| Backend | `http://127.0.0.1:8098/` loopback |
| Admin | `/admin` |
| Desktop | pywebview loads backend URL |

## Evidence portal contract (Phase 7)

| Interface | Detail |
| --------- | ------ |
| Read | `GET /verify/v1/records/{id}/manifest` |
| Files | `GET /verify/v1/records/{id}/files/{n}` |
| Verify | hash/signature/timestamp recompute client-side |
| Auth | time-limited token embedded in QR (never secrets) |

## Events / webhooks (target)

- `document.finalized`, `access.created`, `audit.anchored`, `job.completed`.
- Delivery: SSE (live) + optional webhook (audit consumers).
