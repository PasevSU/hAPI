# Storage Architecture — hAPI Enterprise (To-Be)

## Storage classes

| Class | Purpose | Immutable | Encryption |
| ----- | ------- |:---------:|:----------:|
| `ACTIVE` | working documents | ❌ | AES-256-GCM |
| `EVIDENCE` | finalized/sealed documents | ✅ WORM | AES-256-GCM |
| `AUDIT` | append-only chain | ✅ | — (signed) |
| `META` | SQLite DB + manifests | ❌ | optional |

> **Статус на WORM днес (честно).** `EVIDENCE` е WORM само в рамките на нашето API —
> `flag:'wx'` спира презапис през кода, но не и root, `rm` или подмяна на диска (DEF-06).
> Противоречието с политиката за задържане е затворено в 0.69.87: `retention.js` не трие файл,
> чиито байтове влизат в архивен манифест (`EVIDENCE_NEVER_DELETED`), а при архив без манифест
> пази целия портал. Изключването остава разрешено — то крие файла, но пази байтовете.
> Следващата стъпка за истински WORM е Object Lock; виж `READY_MADE_COMPONENTS.md` §2.

## Layout (target)

Default since 0.69.87: `storage_location: share`, `storage_subdirectory: hapi/data` →
`/share/hapi/data` (`DATA_DIR`). `addon_config` (`/config`) and `media` stay valid; an older
installation that still has data in `/config/hapi_enterprise` keeps using it and logs
`STORAGE_LEGACY_LOCATION` instead of starting empty (`storage-preflight.js`).

```text
data/
├─ db/                 # SQLite (metadata, audit chain, jobs)
├─ files/active/       # working documents
├─ files/evidence/     # WORM sealed documents
├─ manifests/          # evidence manifests + signatures + tokens
├─ keys/               # encrypted keystore (never plaintext)
└─ tmp/                # bounded scratch
```

## Mirror target — one contract, two kinds

The second copy of every uploaded file (`storage_mirror`) is a **target**, not a path
(`mirror-target.js`, 0.69.87):

| Kind | Address | Write | Immutability |
| --- | --- | --- | --- |
| `path` | `backup-hapi` (resolved inside `/share`) | `flag:'wx'`, mode `0600`, read back and compared | `wx` only — protects against our own code, not against root (DEF-06) |
| `s3` | `s3://bucket/prefix?endpoint=…&region=…&lock=дни` | signed PUT (SigV4, `node:crypto`), read back and compared | `Object Lock` in `COMPLIANCE` mode — not even the storage root can delete during the period |

Both kinds answer the same calls (`put`, `get`, `remove`), so upload, verify, repair and the
sensor count are identical. Two consequences are deliberate:

- **Read-time self-heal works only for `path`** (the read path is synchronous). With `s3`
  the repair goes through `POST /admin/api/storage/mirror/verify` with `{"repair":true}`.
- **A locked object cannot be deleted**, so deleting a file or a portal records
  `file.mirror.locked` instead of claiming success. The bucket must be created **with**
  Object Lock — it cannot be enabled afterwards.

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
