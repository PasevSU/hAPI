# ADR-0010: migration-policy

- **Status:** Accepted
- **Date:** 2026-10
- **Context:** Storage/migration must never damage files.
- **Decision:** Zero-damage policy — copy-then-verify-then-commit; no cut/delete
  before byte-identical hash verification; resumable; rollback = discard copy.
- **Options:** (A) copy-verify-commit ✅; (B) direct move ❌ (risky); (C) rsync
  without verify ❌.
- **Consequences:** `storage-preflight.js` + `storage-migrate.js` enforce the policy.
- **Validation:** `05_MIGRATION` plan + `tests/storage-migrate.cjs`.
