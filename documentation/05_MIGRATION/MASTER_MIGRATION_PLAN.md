# Master Migration Plan — hAPI Enterprise

## Scope

Migrate document folders and pointer/directory profiles from their current
(possibly scattered, legacy) locations to the canonical storage layout in
`02_TO_BE_ARCHITECTURE/STORAGE_ARCHITECTURE.md`, with **zero file damage**.

## Goals

- Byte-identical preservation (verified by hash).
- No destructive operation before verification.
- Interrupt-resumable; idempotent.
- Full rollback (original untouched until commit).
- Auditable — every step logged.

## Phases

| Phase | Step | Tool | Verify |
| ----- | ---- | ---- | ------ |
| 0 | Freeze writes | job lock | — |
| 1 | Preflight | `storage-preflight.js` | space/perm/path |
| 2 | Inventory | hash walk | per-file hash |
| 3 | Copy (stream) | `storage-migrate.js` | resume map |
| 4 | Verify | re-hash | 100% match |
| 5 | Commit | flip pointer | manifest |
| 6 | Cleanup | safe delete | — |
| 7 | Report | audit | migration report |

## Guardrails

- Free-space reserve (10%).
- Hash algorithm: SHA-256 (add SHA-512 in Phase 7).
- No `cut`/`mv`/`rm` until Phase 4 passes.
- Every file: source hash == destination hash.
