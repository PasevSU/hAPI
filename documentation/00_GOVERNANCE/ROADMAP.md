# Roadmap — hAPI Enterprise

> Canonical: [`docs/plan/15-unified-master-plan-v6.0.md`](../../docs/plan/15-unified-master-plan-v6.0.md).

## Now (v0.50.0)

Phases 1–4 are complete:

- **Core** — configurable variable hierarchy (`{prefix}-{ID_db}-{id_gruppe}-{field}`).
- **Flexibility** — DI container, Event Bus, Repository interface, metadata-driven Registry.
- **Integrity** — HMAC-SHA256 signing.
- **Documents** — preview, thumbnails, versioning, PDF watermarks, PDF images + tables,
  xlsx/pptx extraction.
- **Sharing** — QR artifacts, branded landing page, QR revocation, HA notify dispatch.

Phase 0 (consolidation) is **complete**: one canonical plan, `archive/` (manifest,
release list, analysis, plan map, first SDK client), one docs index. Report Studio
`RS-01…RS-04` are done (schema + validator, editor, renderer, nine elements);
`RS-07` is done (the issued report carries its own manifest SHA-256 inside the START→STOP scope);
`RS-05` is done (real RFC 3161 START/STOP stamps, tokens stored as `.tsr` and covered by `/rfc3161/verify`);
`RS-06` is partly done (QR is a real vector code, `X-PDF-SHA256` identifies the finished file);
the rest of `RS-06` — PDF/A-3 and the PKCS#7 signature — is open on purpose — see
[`docs/plan/21-next-updates.md`](../../docs/plan/21-next-updates.md).

## Next (Phases 5–11)

| Phase | Focus                                                                                                                                        | Reference                                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 5     | Settings UI + progress/status popup (success/failure feedback)                                                                               | `docs/plan/12-phase-5-settings-and-progress.md`             |
| 6     | Zero-damage folder/document migration with hash verification                                                                                 | `docs/plan/13-phase-6-migration-architecture.md`            |
| 7     | Evidence portal for judges/prosecutors: roles, PKCE/OIDC, SHA-256/512, PKCS#7, RFC 3161, chain of custody, WORM                              | `docs/plan/14-phase-7-evidence-portal.md`                   |
| 8     | Public API v2 + SDK: contract-first OpenAPI 3.1, scoped tokens, `sdk/js`, webhooks                                                           | `docs/plan/15-unified-master-plan-v6.0.md` §6.9             |
| 9     | Packaging: one build → HA add-on, Repo, Windows (code/portable/setup), Full; WebView2 runtime; 6 banners                                     | `docs/plan/15-unified-master-plan-v6.0.md` §6.10            |
| 10    | Quality: HA integration test in CI, Playwright UI, Enterprise Control Center (13 panels), `server.js`/`admin.js` modularisation, `BUG-01…11` | `docs/plan/15-unified-master-plan-v6.0.md` §6.11            |
| 11    | Report Studio: JSON manifest, 8 elements, locked `RFC 3161 START → STOP`, A4/PDF export, no fake tokens                                      | `docs/plan/15-unified-master-plan-v6.0.md` §6.12 · ADR-0025 |

## Direction of travel

1. Make document integrity **verifiable in court** (cryptographic proof, not promises).
2. Make storage and access **auditable** (hash-chained chain of custody).
3. Make the API a **product with a contract** (OpenAPI 3.1 + SDK), not a UI side effect.
4. Let operators **compose reports from a manifest** — always inside a verifiable
   `RFC 3161 START → STOP` scope, never with simulated certificates.
5. Keep the platform **self-hosted** and **configurable**, never an enterprise template.

## Deferred (v7+)

Real multi-tenancy, full Zero Trust (OPA/HSM/service mesh), polyglot persistence — only if
the product leaves Home Assistant and becomes a SaaS.
