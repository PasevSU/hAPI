# ADR-0004: key-lifecycle

- **Status:** Accepted
- **Date:** 2026-10
- **Context:** Signing keys must be rotated and revoked without invalidating history.
- **Decision:** Implement full lifecycle — generate → wrapped store → use → rotate →
  retire; old keys retained verify-only in a trust store.
- **Options:** (A) full lifecycle ✅; (B) single long-lived key ❌; (C) per-document
  throwaway keys ❌ (no stable identity).
- **Consequences:** needs `KEY_MANAGEMENT.md` procedures; CRL/OCSP support.
- **Validation:** rotation/revocation test cases in `06_TESTING`.
