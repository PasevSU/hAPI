# Release Checklist — hAPI Enterprise

## Pre-flight

- [ ] Version bumped (`config.yaml` + `manifest.json` + `api-version.js`).
- [ ] Change-control record for all included changes.
- [ ] Dependencies pinned/audited.

## Build & test

- [ ] `node tests/smoke.cjs` green.
- [ ] Full `tests/*.cjs` suite green (HA + Windows).
- [ ] Security + crypto + interop + GUI E2E pass.

## Artifacts

- [ ] Add-on image built and smoke-run.
- [ ] Windows backend + desktop starter verified.
- [ ] Brand banners (`img/banner.png`, etc.) correct (tank-with-wings v2).
- [ ] Public portal assets deployed.

## Docs

- [ ] README.md / BG.md / DE.md updated.
- [ ] `documentation/` tree current (00–08).
- [ ] Changelog entry added.

## Release

- [ ] Tag created.
- [ ] Release notes published.
- [ ] `RELEASE_DECISION.md` signed with date + approver.
