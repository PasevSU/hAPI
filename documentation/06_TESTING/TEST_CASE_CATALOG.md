# Test Case Catalog — hAPI Enterprise

> Maps function IDs (from `04_FUNCTION_SPECIFICATIONS`) to concrete test files.

| Case ID | Function | Test file | Level |
| ------- | -------- | --------- | ----- |
| T-AUTH-01 | SEC-04 | `tests/auth.cjs` | L1 |
| T-RBAC-01 | SEC-04 | `tests/rbac.cjs`, `tests/rbac-sso.cjs` | L1 |
| T-SIGN-01 | SEC-01 | `tests/signing.cjs`, `tests/core-signer.cjs` | L1 |
| T-CRYPTO-01 | SEC-02 | `tests/file-encryption.cjs` | L1 |
| T-AUDIT-01 | SEC-03 | `tests/audit.cjs`, `tests/audit-chain.cjs`, `tests/audit-export.cjs` | L1 |
| T-RETENTION-01 | SEC-05 | `tests/retention.cjs`, `tests/retention-audit.cjs` | L1 |
| T-DOC-01 | DOC-01 | `tests/core-repository.cjs` | L1 |
| T-PREVIEW-01 | DOC-02 | `tests/preview.cjs` | L1 |
| T-VERSION-01 | DOC-03 | `tests/versioning.cjs` | L1 |
| T-OFFICE-01 | DOC-02 | `tests/office-processing.cjs` | L1 |
| T-QR-01 | SHR-01 | `tests/core-qr-file.cjs`, `tests/qr-dispatch.cjs`, `tests/qr-rollback.cjs` | L1 |
| T-PORTAL-01 | SHR-03 | `tests/portal-page.cjs`, `tests/portal-api-qr.cjs` | L1 |
| T-STORAGE-01 | OPS-03 | `tests/storage.cjs`, `tests/storage-paths.cjs`, `tests/storage-check.cjs`, `tests/storage-migrate.cjs` | L1 |
| T-JOB-01 | OPS-01 | `tests/job-manager.cjs`, `tests/job-persistence.cjs` | L1 |
| T-SQLITE-01 | — | `tests/sqlite-store.cjs`, `tests/sqlite-backup.cjs`, `tests/sqlite-size.cjs`, `tests/sqlite-snapshot-safety.cjs` | L1 |
| T-INTEGRITY-01 | — | `tests/integrity.cjs` | L1 |
| T-INGRESS-01 | — | `tests/ingress-isolation.cjs` | L1 |
| T-ACCESS-01 | SHR-02 | `tests/access-policy.cjs`, `tests/bulk-access.cjs` | L1 |

> Catalog is extended as Phase 5–7 functions are specced.
