# Dependency Graph — hAPI Enterprise (As-Is)

## Module → dependency

| Module | Depends on |
| ------ | ---------- |
| `server.js` | everything (composition root) |
| `container.js` | registry, repository, event-bus, plugins |
| `sqlite-repository.js` | repository.js, sqlite-store.js |
| `core-store.js` | repository.js, registry.js, event-bus.js |
| `directory.js` / `cabinet.js` | core-store.js |
| `preview.js` | versioning.js, file-crypto.js |
| `pdf-writer.js` | ooxml.js |
| `signer.js` | (crypto primitives) |
| `audit-chain.js` | event-bus.js |
| `rbac.js` | core-store.js, runtime-config.js |
| `retention.js` | audit-chain.js, job-manager.js |
| `job-manager.js` | event-bus.js, config-profiles.js |
| `notify.js` | runtime-config.js |
| `migration-bridge.js` | storage-migrate.js, file-crypto.js, signer.js |

## Layering (DOCFLOW L1–L6)

```text
L6 UI          admin.js / portal.js
L5 API         server.js routes (versioned REST)
L4 Data        repository.js → sqlite-repository.js → sqlite-store.js
L3 Domain      core-store.js, directory.js, cabinet.js, registry.js
L2 Core        container.js, event-bus.js, plugins.js
L1 Config      config.yaml + runtime-config.js
```

## Invariants

- Domain modules never depend on HTTP/UI (L6/L5) — only upward calls via interfaces/events.
- All persistence goes through `repository.js`, never direct SQL outside `sqlite-*.js`.
