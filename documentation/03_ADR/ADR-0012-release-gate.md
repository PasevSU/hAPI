# ADR-0012: release-gate

- **Status:** Accepted
- **Date:** 2026-10
- **Context:** Only release when evidence/security requirements are met.
- **Decision:** Release gate = all High defects closed + security test pass +
  crypto vectors pass + rollback plan reviewed + release checklist signed.
- **Options:** (A) explicit gate ✅; (B) feature-complete only ❌; (C) ad-hoc ❌.
- **Consequences:** Phase 7 cannot ship without PKCS#7 + RFC 3161 verification.
- **Validation:** `07_RELEASE/RELEASE_CRITERIA.md` + `RELEASE_DECISION.md`.
