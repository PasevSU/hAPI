# Qualification Plan — hAPI Enterprise

## Objective

Prove a release is fit to ship (HA add-on + Windows + portal) against
`RELEASE_CRITERIA.md`.

## Stages

| Stage | Activity | Evidence |
| ----- | -------- | -------- |
| 1 | Code freeze | change-control record |
| 2 | Full test run | `06_TESTING/MASTER_TEST_PLAN.md` results |
| 3 | Security review | `SECURITY_TESTS.md` pass |
| 4 | Crypto vectors | `CRYPTO_TEST_VECTORS.md` pass |
| 5 | Interop run | `INTEROPERABILITY.md` pass |
| 6 | GUI E2E | `GUI_E2E.md` pass |
| 7 | Migration dry-run | `05_MIGRATION` plan + rollback verified |
| 8 | Docs review | README + documentation tree current |
| 9 | Release decision | `RELEASE_DECISION.md` signed |

## Exit criteria

All High/Critical defects closed; Low defects documented; checklist fully signed.
