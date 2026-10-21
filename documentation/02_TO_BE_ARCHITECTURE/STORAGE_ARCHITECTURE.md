# Storage Architecture — hAPI Enterprise (To-Be)

## Storage classes

| Class | Purpose | Immutable | Encryption |
| ----- | ------- |:---------:|:----------:|
| `ACTIVE` | working documents | ❌ | AES-256-GCM |
| `EVIDENCE` | finalized/sealed documents | ✅ WORM | AES-256-GCM |
| `AUDIT` | append-only chain | ✅ | — (signed) |
| `META` | SQLite DB + manifests | ❌ | optional |

## Layout (target)

```text
data/
├─ db/                 # SQLite (metadata, audit chain, jobs)
├─ files/active/       # working documents
├─ files/evidence/     # WORM sealed documents
├─ manifests/          # evidence manifests + signatures + tokens
├─ keys/               # encrypted keystore (never plaintext)
└─ tmp/                # bounded scratch
```

## Migration (Phase 6) — zero-damage

1. **Preflight** — free space, permissions, path existence, dedupe plan.
2. **Inventory** — enumerate source files + hashes.
3. **Copy** — stream copy (no cut/delete until verified).
4. **Verify** — re-hash every file; compare against pre-copy hash.
5. **Commit** — flip pointer / finalize, then safe cleanup.
6. **Rollback** — original untouched until commit; rollback = discard copy.

Guarantees: byte-identical content, no cross-device partial moves, interrupt-resumable.

## Sizing / limits

- Per-file cap, total-cap warning, free-space guard (10% reserved).
- SQLite WAL, incremental backup, `sqlite-snapshot-safety` tests.
