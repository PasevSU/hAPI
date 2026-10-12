# Data Model — hAPI Enterprise (To-Be)

## Core entities

| Entity | Description |
| ------ | ----------- |
| `group` | top-level container (office, case, cabinet) |
| `profile` | typed record metadata (fields via registry) |
| `file` | stored document + metadata + versions |
| `version` | immutable snapshot of a file revision |
| `access` | granted share (recipient, expiry, pin) |
| `receipt` | HMAC/signed evidence of an action |
| `audit_entry` | hash-chained audit record |
| `manifest` | cryptographic evidence manifest |
| `job` | background operation (progress) |

## Relationships

```text
group 1─n profile 1─n file 1─n version
group 1─n access n─1 profile
file 1─1 manifest
* ──n audit_entry
```

## SQLite logical tables (target)

`groups`, `profiles`, `fields`, `files`, `versions`, `accesses`,
`receipts`, `audit_chain`, `manifests`, `jobs`, `settings`.

## Keys & invariants

- `version.id` immutable once written (WORM).
- `manifest.hash_sha256` + `hash_sha512` + signature + timestamp.
- All writes create an `audit_entry` with `prev_hash`.
- Deletion is logical (`deleted_at`) — never physical for evidence-class records.
