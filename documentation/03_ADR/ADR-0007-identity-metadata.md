# ADR-0007: identity-metadata

- **Status:** Accepted
- **Date:** 2026-10
- **Context:** Evidence must bind identity and metadata without leaking PII.
- **Decision:** Structured identity metadata (actor, role, timestamp, cert subject)
  in every manifest/audit entry; minimize PII, encrypt sensitive fields.
- **Options:** (A) structured metadata ✅; (B) free-text author strings ❌;
  (C) no identity binding ❌ (fails evidentiary standard).
- **Consequences:** canonical manifest schema; privacy review for retention.
- **Validation:** manifest round-trip + redaction tests.
