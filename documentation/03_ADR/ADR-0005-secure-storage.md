# ADR-0005: secure-storage

- **Status:** Accepted
- **Date:** 2026-10
- **Context:** Documents and private keys must be safe at rest.
- **Decision:** AES-256-GCM per file with per-file keys wrapped by a scrypt-derived
  master key; keys live in an encrypted keystore (never plaintext).
- **Options:** (A) per-file AES-256-GCM ✅; (B) plaintext + filesystem perms ❌;
  (C) whole-volume full-disk encryption only ❌ (no granularity).
- **Consequences:** `file-crypto.js` evolves; key material never in logs/audit.
- **Validation:** `tests/file-encryption.cjs`.
