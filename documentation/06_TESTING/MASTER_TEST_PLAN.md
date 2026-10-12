# Master Test Plan — hAPI Enterprise

## Scope

Covers functional, security, crypto, migration, interoperability, and GUI E2E
testing for HA add-on + Windows + evidence portal.

## Levels

| Level | Type | Command | Gate |
| ----- | ---- | ------- | ---- |
| L0 | Unit | `node tests/smoke.cjs` | every commit |
| L1 | Integration | `node tests/*.cjs` | every phase |
| L2 | Security | `06_TESTING/SECURITY_TESTS.md` | release gate |
| L3 | Crypto vectors | `CRYPTO_TEST_VECTORS.md` | release gate |
| L4 | Interop (HA+Win) | `INTEROPERABILITY.md` | release gate |
| L5 | GUI E2E | `GUI_E2E.md` | release gate |

## Existing suite (v0.50.0)

~80 `tests/*.cjs` files covering: auth, rbac, audit, storage, migration, preview,
qr, portal, signing, file-encryption, retention, job-manager, sqlite, taxonomy,
ha-bridge, ingress-isolation, runtime-limits, rollback guards, and more.

## Entry/exit criteria

- **Entry:** code frozen for the phase, specs approved.
- **Exit:** all L0–L5 pass; defects ≤ Low; release criteria met.

## Environments

- HA add-on (Node in Docker) and Windows (Node local).
- CI runs the same suite on both where feasible.
