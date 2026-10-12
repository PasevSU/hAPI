# Rollback Plan — hAPI Enterprise Migration

## Strategy

Migration is **copy-then-commit**, so rollback is cheap and safe: the source is
never modified until Phase 5 (commit) succeeds.

## Rollback triggers

- Any hash mismatch in Phase 4 (verify).
- Preflight failure (space/permission/path).
- Interruption exceeding resume window.
- Manual operator abort.

## Rollback actions

| Trigger point | Action |
| ------------- | ------ |
| Pre-phase 3 (before copy) | nothing to roll back |
| Phase 3/4 (copy/verify) | discard partial destination copy |
| Phase 5 (commit) | if commit is atomic (pointer flip), no rollback needed; source retained until cleanup |
| Phase 6 (cleanup) | cleanup is deferred + reversible via soft-delete/trash |

## Guarantees

- Source data remains intact through Phase 5.
- Cleanup is soft (move to trash), hard-delete only after report is signed off.
- Full migration state journal enables resume/abort at any point.

## Restore

If destination is later found corrupt, the source (retained) is the restore point;
re-run preflight + copy + verify.
