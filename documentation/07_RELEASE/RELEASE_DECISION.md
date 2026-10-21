# Release Decision — hAPI Enterprise

> Signed record of GO / NO-GO for each release. Fill one block per release.

## Release record (template)

- **Version:** `vX.Y.Z`
- **Date:** YYYY-MM-DD
- **Approver:** <name/role>
- **Decision:** GO | NO-GO
- **Hard gates:** all met? (list any unmet)
- **Open defects:** Critical/High = 0? Low documented?
- **Residual risk:** <notes>
- **Sign-off:** <signature/initials>

## History

| Version | Date | Decision | Approver |
| ------- | ---- | -------- | -------- |
| v0.50.0 | 2026-10 | GO (Phase 1–4 complete; Phases 5–11 planned — see unified plan v6.0) | — |

> Phases 5–11 are gated by `ADR-0012`; the evidence portal cannot ship until
> PKCS#7 + RFC 3161 verification is implemented and tested. Public API work (phase 8) is
> defined in [`docs/plan/15-unified-master-plan-v6.0.md`](../../docs/plan/15-unified-master-plan-v6.0.md) §6.9;
> Report Studio (phase 11) is defined in §6.12 and ADR-0025.
