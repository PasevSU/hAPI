# Documentation

## Architecture & planning (`docs/plan`)

Ordered from the original core requirement to the latest consolidated master plan:

| File                          | Content                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `00-core-requirement.txt`     | The original requirement — the variable hierarchy (the core)       |
| `01-specification-v1.0.md`    | Initial functional specification                                    |
| `02-docflow-v2.0.md`          | DOCFLOW v2.0 — merged spec + variable store                        |
| `03-architecture-v3.0.md`     | Flexible architecture (registry, metadata-driven, pluggable)       |
| `04-enterprise-v4.0.md`       | Enterprise blueprint                                               |
| `05-domain-model-v4.1.md`     | Domain model (bounded contexts)                                    |
| `06-multi-tenancy-v4.2.md`    | Multi-tenancy architecture                                         |
| `07-security-v4.3.md`         | Security — Zero Trust                                              |
| `08-master-plan-v5.0.md`      | **Consolidated master plan** (canonical source of truth)           |
| `09-execution-plan.md`        | Phased execution plan (Phase 1 → 2 → 3 → 4)                        |
| `10-phase-4-gap-closure.md`   | Phase 4 scope — document processing + QR sharing                   |
| `11-phase-4-flexibility-checklist.md` | §9.1 flexibility matrix for all Phase 4 features             |
| `12-phase-5-settings-and-progress.md` | Phase 5 plan — settings UI + progress/status popup          |
| `13-phase-6-migration-architecture.md` | Phase 6 plan — zero-damage folder/document migration     |
| `14-phase-7-evidence-portal.md`   | Phase 7 plan — evidence portal (judges/prosecutors, cryptographic proof) |

> **Note:** `07-security-v4.3.md` contains an appended copy of `06-multi-tenancy-v4.2.md`
> (the file was concatenated by mistake). The master plan (`08`) is the canonical source
> of truth and supersedes the earlier versions.

## ADRs

Architecture Decision Records live in [`documentation/03_ADR/`](../documentation/03_ADR/)
— a single registry (ADR-0001 … ADR-0023). The former `docs/adr/` tree was merged there.
