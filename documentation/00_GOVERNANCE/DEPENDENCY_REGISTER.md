# Dependency Register — hAPI Enterprise

| ID | Dependency | Type | Version / constraint | Purpose | Fallback |
| -- | ---------- | ---- | -------------------- | ------- | -------- |
| D1 | Node.js runtime | Runtime | ≥ 22.13 | `node:sqlite` `DatabaseSync` | Embedded Node in packages |
| D2 | Home Assistant Supervisor | Runtime | current | Add-on hosting + Ingress | Windows standalone |
| D3 | SQLite (`node:sqlite`) | Data | built-in | Transactional metadata store | Repository interface |
| D4 | pywebview | GUI (Win) | current | Desktop GUI shell | Browser admin panel |
| D5 | Microsoft Edge WebView2 | GUI (Win) | current | pywebview backend | auto-installed by starter |
| D6 | Cryptographic hashes | Crypto | SHA-256/512 | Integrity | — |
| D7 | Signature provider | Crypto | PKCS#7 detached (X.509) | Evidence sealing | HMAC-SHA256 receipt |
| D8 | Timestamp authority (TSA) | Crypto | RFC 3161 | Evidence time-stamping | Internal timestamp (warning) |
| D9 | Identity provider (OIDC) | Auth | OIDC | Court SSO | PKCE + MFA (own backend) |
| D10 | QR generator | Sharing | `qrcode` (bundled) | QR artifacts | — |

## Rules

- Every external dependency is replaceable behind an interface (DOCFLOW P4).
- Adding/removing a dependency is a change-control event (`CHANGE_CONTROL.md`).
