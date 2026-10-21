# ADR-0006: fortress

- **Status:** Accepted
- **Date:** 2026-10
- **Context:** Evidence must be tamper-evident and resistant to insider/remote tampering.
- **Decision:** "Fortress" pattern — dedicated WORM volume, append-only audit chain,
  external anchor hash, signed manifests, role-gated access.
- **Options:** (A) layered Fortress ✅; (B) DB-only immutability ❌; (C) OS-level
  attributes only ❌ (fragile across targets).
- **Consequences:** evidence storage is append-only; deletes are logical.
- **Validation:** `06_TESTING/SECURITY_TESTS.md`.
