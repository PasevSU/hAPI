# Interoperability — hAPI Enterprise

## Matrix

| Capability | HA add-on | Windows | Evidence portal |
| ---------- |:---------:|:-------:|:---------------:|
| Admin API v1 | ✅ | ✅ | ❌ (read-only) |
| Document store | ✅ | ✅ | — |
| Encryption at rest | ✅ | ✅ | — |
| QR generation | ✅ | ✅ | — |
| Verify API | ✅ | ✅ | ✅ |
| Hash/signature verify | ✅ | ✅ | ✅ |

## Tests

- Same `tests/*.cjs` suite run on both Node runtimes (Docker + Windows).
- API v1 response shapes identical across targets (snapshot tests).
- File hashes identical for identical content regardless of OS path separators.

## Cross-target invariants

- Paths normalized internally; UNC (`\\host\share`) and POSIX (`/config`) both mapped.
- `node:sqlite` is the single persistence engine (no platform-specific SQL).
- Case/NFC normalization consistent on all filesystems.

## Evidence exchange

- Manifest is platform-independent JSON + detached artifacts.
- Verify clients (portal, court tools) need no hAPI backend to verify.
