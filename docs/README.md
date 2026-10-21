# Documentation

## Architecture & planning (`docs/plan`)

Ordered from the original core requirement to the latest consolidated master plan:

| File                                      | Content                                                                                                                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-core-requirement.txt`                 | The original requirement — the variable hierarchy (the core)                                                                                                                                        |
| `01-specification-v1.0.md`                | Initial functional specification                                                                                                                                                                    |
| `02-docflow-v2.0.md`                      | DOCFLOW v2.0 — merged spec + variable store                                                                                                                                                         |
| `03-architecture-v3.0.md`                 | Flexible architecture (registry, metadata-driven, pluggable)                                                                                                                                        |
| `04-enterprise-v4.0.md`                   | Enterprise blueprint                                                                                                                                                                                |
| `05-domain-model-v4.1.md`                 | Domain model (bounded contexts)                                                                                                                                                                     |
| `06-multi-tenancy-v4.2.md`                | Multi-tenancy architecture                                                                                                                                                                          |
| `07-security-v4.3.md`                     | Security — Zero Trust                                                                                                                                                                               |
| `08-master-plan-v5.0.md`                  | Consolidated master plan v5.0 (historical; superseded by `15`)                                                                                                                                      |
| `09-execution-plan.md`                    | Phased execution plan (Phase 1 → 2 → 3 → 4)                                                                                                                                                         |
| `10-phase-4-gap-closure.md`               | Phase 4 scope — document processing + QR sharing                                                                                                                                                    |
| `11-phase-4-flexibility-checklist.md`     | §9.1 flexibility matrix for all Phase 4 features                                                                                                                                                    |
| `12-phase-5-settings-and-progress.md`     | Phase 5 plan — settings UI + progress/status popup                                                                                                                                                  |
| `13-phase-6-migration-architecture.md`    | Phase 6 plan — zero-damage folder/document migration                                                                                                                                                |
| `14-phase-7-evidence-portal.md`           | Phase 7 plan — evidence portal (judges/prosecutors, cryptographic proof)                                                                                                                            |
| `15-unified-master-plan-v6.0.md`          | **Consolidated project v6.0 — the single source of truth** (merges `00`–`14`, `documentation/`, the worktree, `hapi_old/` and the public ChatGPT conversation; defines phases 0–11 and the backlog) |
| `16-implementation-plan-from-chat.md`     | Execution plan derived from the public ChatGPT conversation: virtual storage, per-portal API contract, W0–W5 work breakdown with DoD and tests                                                      |
| `17-portal-files-management-plan.md`      | **Execution priority:** portals, files and management (F0–F9) — file options menu, portal settings, GUI wiring; Report Studio deliberately last (F8)                                                |
| `18-enterprise-control-center-plan.md`    | Enterprise Control Center: 15 panels, Report Studio manifest editor, START/STOP rules, phases 0–11                                                                                                  |
| `19-file-delivery-export-manager-plan.md` | File Delivery & Export Manager + Download Access Control: 12 export modes, package index, integrity pipeline, policies, FD-0…FD-9                                                                   |
| `20-unified-plan-v7.md`                   | **Program plan (entry point):** two access channels (admin Ingress vs Public API Gateway), portal model, isolation, capability status, waves W0–W8 and the next 10 work slots                       |
| `21-next-updates.md`                      | Short-horizon slice (derived, does not reorder `20`): release 0.63.0, Report Studio remainder (`RS-05…RS-07`), manifest-consumption decision                                                        |

> **Canonical documents:** `15-unified-master-plan-v6.0.md` defines product scope; `20-unified-plan-v7.md`
> is the current program plan and orders execution across all other plans (it also carries the
> Public API Gateway architecture). `08`–`14` remain as history and detailed annexes.
>
> **Note:** `07-security-v4.3.md` contains an appended copy of `06-multi-tenancy-v4.2.md`
> (the file was concatenated by mistake).

## ADRs

Architecture Decision Records live in [`documentation/03_ADR/`](../documentation/03_ADR/)
— a single registry (ADR-0001 … ADR-0026, including the Report Studio and Public Gateway
decisions). The former `docs/adr/` tree was merged there.
