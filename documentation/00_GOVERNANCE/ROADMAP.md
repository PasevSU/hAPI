# Roadmap — hAPI Enterprise

## Now (v0.50.0)

Phases 1–4 are complete:

- **Core** — configurable variable hierarchy (`{prefix}-{ID_db}-{id_gruppe}-{field}`).
- **Flexibility** — DI container, Event Bus, Repository interface, metadata-driven Registry.
- **Integrity** — HMAC-SHA256 signing.
- **Documents** — preview, thumbnails, versioning, PDF watermarks, PDF images + tables,
  xlsx/pptx extraction.
- **Sharing** — QR artifacts, branded landing page, QR revocation, HA notify dispatch.

## Next (Phases 5–7)

| Phase | Focus | Reference |
| ----- | ----- | --------- |
| 5 | Settings UI + progress/status popup (success/failure feedback) | `docs/plan/12-phase-5-settings-and-progress.md` |
| 6 | Zero-damage folder/document migration with hash verification | `docs/plan/13-phase-6-migration-architecture.md` |
| 7 | Evidence portal for judges/prosecutors: roles, PKCE/OIDC, SHA-256/512, PKCS#7, RFC 3161, chain of custody, WORM | `docs/plan/14-phase-7-evidence-portal.md` |

## Direction of travel

1. Make document integrity **verifiable in court** (cryptographic proof, not promises).
2. Make storage and access **auditable** (hash-chained chain of custody).
3. Keep the platform **self-hosted** and **configurable**, never an enterprise template.
