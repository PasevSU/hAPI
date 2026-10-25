# hAPI Enterprise — Documentation

Enterprise governance and methodology layer. Complements the implementation-level
`docs/` tree (plan + ADR).

| Folder                        | Purpose                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00_GOVERNANCE/`              | Charter, master plan, roadmap, milestones, WBS, traceability, risk/dependency registers, change control, definition of done; **[`PLAN_STATUS.md`](00_GOVERNANCE/PLAN_STATUS.md)** — къде сме спрямо плана (и кои планови документи са исторически) |
| `01_AS_IS_ARCHITECTURE/`      | Current source inventory, module catalog, call/dependency graphs, crypto matrix, GUI inventory, known defects                                                                                                                                                                                               |
| `02_TO_BE_ARCHITECTURE/`      | Целева архитектура — започни от **[индекса](02_TO_BE_ARCHITECTURE/README.md)**: **[`API_ARCHITECTURE_SPEC.md`](02_TO_BE_ARCHITECTURE/API_ARCHITECTURE_SPEC.md)** (нормативен), **[`API_ENDPOINT_REFERENCE.md`](02_TO_BE_ARCHITECTURE/API_ENDPOINT_REFERENCE.md)** (генериран от кода), **[`RUNTIME_EXECUTION_FLOWS.md`](02_TO_BE_ARCHITECTURE/RUNTIME_EXECUTION_FLOWS.md)**, **[`ARCHITECTURE_COMPLIANCE_MATRIX.md`](02_TO_BE_ARCHITECTURE/ARCHITECTURE_COMPLIANCE_MATRIX.md)**, **[`OIDC_LOGIN.md`](02_TO_BE_ARCHITECTURE/OIDC_LOGIN.md)** и **[`PGP_KEYRING_AND_WORK_FOLDER.md`](02_TO_BE_ARCHITECTURE/PGP_KEYRING_AND_WORK_FOLDER.md)** |
| `03_ADR/`                     | Architecture Decision Records — single registry (ADR-0001 … ADR-0023)                                                                                                                                                                                                                                       |
| `04_FUNCTION_SPECIFICATIONS/` | Master function inventory + specification template; **[`PORTAL_PAGE_CONTRACT.md`](04_FUNCTION_SPECIFICATIONS/PORTAL_PAGE_CONTRACT.md)** — binding contract for `/p/<id>`; **[`EVIDENCE_VIEW_PORTAL.md`](04_FUNCTION_SPECIFICATIONS/EVIDENCE_VIEW_PORTAL.md)** — порталът, който показва файловете и данните |
| `05_MIGRATION/`               | Zero-damage migration plan and supporting registers                                                                                                                                                                                                                                                         |
| `06_TESTING/`                 | Master test plan, catalog, crypto vectors, interoperability, GUI E2E, security tests                                                                                                                                                                                                                        |
| `07_RELEASE/`                 | Qualification, criteria, checklist, decision; **[`RELEASE_0.69.87.md`](07_RELEASE/RELEASE_0.69.87.md)** — какво влезе в изданието и с какво е доказано                                                                                                                                                             |
| `08_USER_GUIDES/`             | User guides (BG / DE / EN) — incl. [`portals-contacts-cases.md`](08_USER_GUIDES/portals-contacts-cases.md), [`install-hacs.md`](08_USER_GUIDES/install-hacs.md), **[`pgp-keys-setup.md`](08_USER_GUIDES/pgp-keys-setup.md)** и **[`oidc-login.md`](08_USER_GUIDES/oidc-login.md)** (вход през Pocket ID/Keycloak), **[`admin-token.md`](08_USER_GUIDES/admin-token.md)** (защо admin токенът не е HA LLAT)  |

## Relationship to `docs/`

- `docs/plan/` — working design & planning history (v1.0 → Phase 7).
- `documentation/03_ADR/` — the single ADR registry (enterprise + implementation).
- This `documentation/` tree — official governance, architecture, migration, testing,
  release, and user guides.
