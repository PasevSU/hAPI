# GUI Architecture — hAPI Enterprise (To-Be)

## Surfaces

| Surface | Framework | Audience |
| ------- | --------- | -------- |
| Admin console | HTML/JS (`admin.js`) | operators/admins |
| Evidence portal | HTML/JS (Phase 7) | courts/prosecutors |
| Desktop | pywebview + WebView2 | Windows operators |
| Settings UI | HTML/JS (Phase 5) | admins |

## Principles

- **One data layer** — every surface calls the same versioned REST API.
- **Responsive** — HA Ingress (webview) and desktop window share admin UI.
- **Accessible** — keyboard navigation, contrast, plain-language labels (BG/DE/EN).

## Settings UI (Phase 5)

- Structured editor for `config.yaml` + runtime-config.
- Validation + preview + rollback (profile snapshots).

## Progress popup (Phase 5)

- Event-driven job progress (SSE) → toast/inline panel.
- States: queued → running → succeeded / failed / cancelled.
- Failure shows bounded error detail from `error-log.js`.

## Evidence portal (Phase 7)

- Public, read-only, branded landing with in-browser hash/signature/timestamp verification.
- Minimal attack surface: static assets + read-only verify API.
