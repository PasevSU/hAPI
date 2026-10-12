# Conflict Resolution — hAPI Enterprise

## Conflict types & resolution

| Conflict | Detection | Resolution |
| -------- | --------- | ---------- |
| Same name, same hash | hash compare | dedupe (single copy) |
| Same name, different hash | hash compare | keep both: `name (2)` |
| Name differs, same hash | hash compare | dedupe + retain both names |
| Invalid chars / case | normalize | `_` substitution, case-fold |
| Cross-device path | preflight | copy (never move) |
| Destination exists (unverified) | exists check | never overwrite; rename |
| Interrupted copy | resume map | resume from last block |

## Non-negotiable rules

1. Never overwrite an existing destination.
2. Never delete source until destination hash matches.
3. Conflicts are always resolved to a **new** path, never by clobbering.
4. Every resolution is logged with both hashes for audit.
