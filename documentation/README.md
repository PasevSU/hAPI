# hAPI Enterprise — Documentation

Enterprise governance and methodology layer. Complements the implementation-level
`docs/` tree (plan + ADR).

| Folder | Purpose |
| ------ | ------- |
| `00_GOVERNANCE/` | Charter, master plan, roadmap, milestones, WBS, traceability, risk/dependency registers, change control, definition of done |
| `01_AS_IS_ARCHITECTURE/` | Current source inventory, module catalog, call/dependency graphs, crypto matrix, GUI inventory, known defects |
| `02_TO_BE_ARCHITECTURE/` | Target system/security/data/storage/GUI architecture, crypto engine, key management, integration contracts |
| `03_ADR/` | Architecture Decision Records (ADR-0001 … ADR-0012) |
| `04_FUNCTION_SPECIFICATIONS/` | Master function inventory + specification template |
| `05_MIGRATION/` | Zero-damage migration plan and supporting registers |
| `06_TESTING/` | Master test plan, catalog, crypto vectors, interoperability, GUI E2E, security tests |
| `07_RELEASE/` | Qualification, criteria, checklist, decision |
| `08_USER_GUIDES/` | User guides (BG / DE / EN) |

## Relationship to `docs/`

- `docs/plan/` — implementation plan history (v1.0 → Phase 7).
- `docs/adr/` — implementation-level ADRs (Phases 1–4).
- This `documentation/` tree — enterprise governance, security, and release method.
