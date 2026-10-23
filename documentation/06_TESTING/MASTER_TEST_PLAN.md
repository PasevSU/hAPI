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

## Process rules (added in 0.69.67, verified by CI failures)

1. **Never `SIGKILL` the entrypoint.** `start.js` starts `server.js` as its own child with
   `stdio: 'inherit'`; killing only the wrapper leaves an orphan that keeps the pipes open, so
   the test prints its result but the process never exits (CI hung 9 minutes: 20:10:45 →
   cancellation at 20:19:17). A test that boots `start.js` stops it with `stopTree()` from
   `tests/helpers.cjs` (SIGTERM → SIGKILL → pid from `.hapi-instance.json` → destroy stdout/stderr).
2. **Every test has a ceiling.** `ci.yml` runs each file with `timeout -k 10 300` and annotates
   `::error::TIMEOUT`; `scripts/run-tests.cjs` uses a 300 s `spawnSync` timeout. A hanging test
   is a named failure, not a locked job.
3. **A failure must not hide the rest.** The CI job runs with `bash -e`, so a bare command in
   the loop aborts the whole cycle; use `cmd || status=$?` and keep going.
4. **Assert on the data, not on the tool's version.** Where the format depends on the installed
   tool (gpg 2.4 writes SEIPD v1, gpg 2.5 writes AEAD/OCB), the test reads the packets and asserts
   the code that matches the file instead of guessing from the version.
5. **No probabilistic assertions.** A check that inspects decrypted plaintext can fire by chance
   (a random byte looks like a packet header); inspect the structure that is actually defined
   (the packet after the SEIPD prefix). See 0.69.67 `pgp.js` fix.
