# Migration Matrix — hAPI Enterprise

> Maps source objects → destination objects → rules.

| Source | Destination | Rule | Transform |
| ------ | ----------- | ---- | --------- |
| legacy folder | `files/active/` | preserve name; sanitize invalid chars | rename on conflict |
| legacy folder | `files/evidence/` | only if sealed | WORM, hash |
| pointer path | `files/active/<profile>/` | rebind pointer | update pointer record |
| duplicate file | dedupe map | keep one, hardlink/ref | hash keyed |
| orphan file | `files/active/_orphan/` | quarantine | report |
| metadata (JSON) | SQLite tables | import | validate schema |
| audit log | `audit_chain` | append + re-anchor | preserve prev_hash |

## Naming rules

- Collision → `<name> (n).<ext>` or hash-suffix when content differs.
- Invalid chars → `_`; leading dot → `_`.
- Case-insensitive filesystems: normalize NFC, case-fold before compare.

## Ordering

1. Metadata → 2. Working files → 3. Evidence → 4. Pointers → 5. Audit.
