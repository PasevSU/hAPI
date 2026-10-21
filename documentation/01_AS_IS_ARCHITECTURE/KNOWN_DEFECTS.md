# Known Defects — hAPI Enterprise

> Tracked defects, their impact, and disposition. No evidence-integrity defects are known
> to be open at v0.50.0.

| ID | Area | Description | Severity | Status |
| -- | ---- | ----------- | -------- | ------ |
| DEF-01 | Docs | `docs/plan/07-security-v4.3.md` contains an appended copy of `06-multi-tenancy-v4.2.md` (concatenated by mistake). Master plan (`08`) supersedes. | Low | Accepted (documented) |
| DEF-02 | Repo path | Local checkout folder is named `hAPI Enterptice` (typo for "Enterprise"). Cosmetic only. | Low | Open |
| DEF-03 | Portal | Public portal (`portal.js`) is download-only; no in-browser hash verification yet — addressed by Phase 7. | Medium | Planned (Phase 7) |
| DEF-04 | Crypto | No RFC 3161 timestamp / PKCS#7 detached signature yet — evidence lacks legal-grade sealing until Phase 7. | High | Planned (Phase 7) |
| DEF-05 | Crypto | SHA-256 only (no SHA-512) in manifest — Phase 7 adds SHA-512. | Low | Planned (Phase 7) |
| DEF-06 | Ops | WORM is partial (`flag:'wx'`); dedicated immutable evidence volume not yet present. | Medium | Planned (Phase 7) |

## Disposition rules

- `High` defects gate a release (see `07_RELEASE/RELEASE_CRITERIA.md`).
- New defects are logged here and linked to a change-control record.
