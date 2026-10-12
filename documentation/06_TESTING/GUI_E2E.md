# GUI E2E — hAPI Enterprise

## Surfaces under test

1. Admin console (HA Ingress + Windows loopback).
2. Public portal (QR landing).
3. Desktop (pywebview + WebView2).
4. Settings UI + progress popup (Phase 5).
5. Evidence portal verify flow (Phase 7).

## Core scenarios

| Scenario | Steps | Assert |
| -------- | ----- | ------ |
| Login | open admin → authenticate | role-scoped nav renders |
| Upload | create group/profile → upload file | file listed, hash recorded |
| Preview | open file → preview | thumbnail/render ok |
| Version | edit → new version | version history shows both |
| QR | share file → generate QR | QR encodes valid URL |
| Portal | open QR URL | branded page + download |
| Verify | open verify → drop file+manifest | hashes/signature/timestamp verified |
| Settings | edit setting → save | validated + persisted |
| Progress | start job | toast/inline shows queued→done |

## Tooling

- Manual smoke on desktop + HA; automated where webview scripting is available.
- Screenshots/recordings stored for release review.

## Acceptance

- No console errors on primary flows.
- Keyboard-reachable controls; no 404/500 on golden paths.
