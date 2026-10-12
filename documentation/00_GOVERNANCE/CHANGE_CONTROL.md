# Change Control — hAPI Enterprise

## 1. When a change-control record is required

- Architectural decisions (→ ADR).
- New/removed dependencies.
- Schema or API changes.
- Security-relevant behavior changes.
- Changes to evidence handling, storage, or the audit chain.

## 2. Process

1. **Proposal** — describe the change, motivation, and impact.
2. **Impact analysis** — affected modules, tests, migrations, rollback.
3. **Decision** — approved / rejected / deferred, with rationale.
4. **Implementation** — code + tests + ADR (if architectural).
5. **Verification** — automated tests + §9.1 checklist.
6. **Closure** — record the outcome and version bump.

## 3. Rollback rule

Every change must be reversible (migration + rollback) — DOCFLOW P7. A change without a
rollback path is rejected for the core and for evidence storage.

## 4. Record format

```text
CHANGE-### | date | author | summary | impact | decision | rollback | version
```

## 5. Emergency changes

Security fixes may bypass full review but **must** be retroactively documented and ADR'd
within the same release.
