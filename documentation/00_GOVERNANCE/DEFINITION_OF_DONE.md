# Definition of Done — hAPI Enterprise

A work item is **Done** only when **all** of the following are true.

## Functional

- [ ] A real backend handler exists (never just a UI button).
- [ ] Behavior matches the specification / phase plan.

## Quality

- [ ] Automated test(s) added and passing (`node tests/*.cjs`).
- [ ] No new known defects (or defects logged in `KNOWN_DEFECTS.md`).

## Flexibility (§9.1 checklist)

- [ ] Config-off possible (feature can be disabled).
- [ ] Replaceable behind an interface.
- [ ] Exposes an interface, not a concrete implementation.
- [ ] Emits events for observable behavior.
- [ ] Migration + rollback defined.
- [ ] ADR recorded (if architectural).

## Security

- [ ] No secrets in logs/diagnostics.
- [ ] Access is role-checked and audited.
- [ ] Evidence/immutable paths are write-once (WORM) where required.

## Documentation

- [ ] Spec updated in `documentation/04_FUNCTION_SPECIFICATIONS/`.
- [ ] README / user guide updated if user-visible.
- [ ] Traceability matrix updated (`REQUIREMENTS_TRACEABILITY.md`).

## Release

- [ ] Release checklist satisfied (`documentation/07_RELEASE/RELEASE_CHECKLIST.md`).
