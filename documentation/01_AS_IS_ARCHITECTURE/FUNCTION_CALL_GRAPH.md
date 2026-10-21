# Function Call Graph — hAPI Enterprise (As-Is)

> Logical call graph (not exhaustive; derived from module responsibilities).

```text
server.js ──────────────── HTTP entrypoint (HA Ingress + Windows loopback admin)
  ├─ runtime-config.js     config / branding / limits
  ├─ container.js          builds the DI container
  │    ├─ registry.js      profile/field definitions
  │    ├─ repository.js ── sqlite-repository.js ── sqlite-store.js
  │    ├─ event-bus.js     observable events
  │    └─ plugins.js
  ├─ auth / rbac.js        login, roles, HA ingress identity SSO
  ├─ core-store.js         groups/profiles/records/variables
  │    ├─ directory.js
  │    └─ cabinet.js
  ├─ document pipeline
  │    ├─ preview.js
  │    ├─ ooxml.js
  │    ├─ pdf-writer.js
  │    └─ versioning.js
  ├─ sharing
  │    ├─ qrcode.js
  │    ├─ portal.js (served HTML/CSS/JS)
  │    └─ notify.js
  ├─ security/crypto
  │    ├─ signer.js
  │    ├─ file-crypto.js
  │    ├─ audit-chain.js
  │    └─ retention.js
  └─ operations
       ├─ job-manager.js
       ├─ load-control.js
       ├─ config-profiles.js
       ├─ error-log.js
       ├─ storage-check.js / storage-migrate.js / storage-preflight.js
       └─ migration-bridge.js
```

## Entry points

| Entry           | Runtime                                                    |
| --------------- | ---------------------------------------------------------- |
| `server.js`     | HA add-on (via `start.js`/`Dockerfile`) + Windows backend  |
| `standalone.js` | Windows edge bootstrap (starts `server.js` + optional GUI) |
