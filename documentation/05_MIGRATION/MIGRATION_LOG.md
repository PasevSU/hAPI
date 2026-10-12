# Migration Log — hAPI Enterprise

> Append-only migration journal. One line per event; fields separated by `|`.

| Timestamp | Phase | Action | Object | Source hash | Dest hash | Status | Operator |
| --------- | ----- | ------ | ------ | ----------- | --------- | ------ | -------- |
| — | — | — | — | — | — | — | — |

## Required fields

`timestamp | phase | action | object | source_hash | dest_hash | status | operator`

- `status` ∈ `planned | copying | verified | committed | rolled_back | failed`.
- Every copy row MUST have both hashes populated before `verified`.

## Integrity

- The log itself is hashed into the audit chain (external anchor in Phase 7).
- No entry is edited or deleted; corrections are new rows with `status=rolled_back`.
