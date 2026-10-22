# Release Checklist — hAPI Enterprise

## Pre-flight

- [ ] Version bumped (`node scripts/build-release.cjs --version X.Y.Z` — пише в
      `hapi_enterprise/config.yaml` и `custom_components/hapi_enterprise/manifest.json`).
- [ ] `CHANGELOG.md` има запис за версията.
- [ ] Change-control record for all included changes.
- [ ] Dependencies pinned/audited.

## Build & test

- [ ] `npm test` (пълен набор `tests/*.cjs` през `scripts/test-matrix.cjs`) — 100% успех;
      при грешка серията се рестартира от начало, докато не се стигне 100%
      (`--attempts=N`), а `reports/test-matrix.json` показва времената и нестабилните тестове.
- [ ] `node scripts/build-release.cjs` — строи `dist/`.
- [ ] `node scripts/verify-release.cjs --with-tests` — 21/21 сценария зелени (вкл. HACS структурата).
- [ ] `npm run audit` — без тайни и файлове над 5 MB в дървото.
- [ ] `node tests/hacs-structure.cjs` — HACS структурата е валидна.
- [ ] Security + crypto + interop + GUI E2E pass.

## Artifacts

- [ ] `dist/hapi_enterprise-<v>.tar.gz` — add-on архивът е валиден.
- [ ] `dist/hapi_enterprise-integration-<v>.zip` — интеграцията е валидна.
- [ ] `dist/SHA256SUMS.txt` проверен след трансфер.
- [ ] Brand banners (`img/banner-thin.png` + `banner-thin.svg` source) correct (hAPI mark + PasevSU lockup).
- [ ] Public portal assets deployed.

## Docs

- [ ] README.md / BG.md / DE.md updated.
- [ ] `documentation/` tree current (00–08).
- [ ] Changelog entry added.
- [ ] `node scripts/release-status.cjs` — `reports/RELEASE-STATUS.md` регенериран (числата в него
      идват от отчетите на инструментите; `--check` може да го провери).

## Release

- [ ] Tag `v<версия>` created (annotated: `git tag -a v<v> -m "hAPI Enterprise <v>" <sha>`).
- [ ] **Проверено, че изданието в GitHub съществува** — workflow-ът `Release` не се задейства
      надеждно при push на таг, затова се проверява изрично:
      `gh release view v<v> --repo PasevSU/hAPI --json assets`.
      Ако го няма: `gh release create v<v> --title "v<v>" --notes-file <CHANGELOG-частта>`,
      после `gh release upload v<v> --clobber` с петте файла от `dist/`.
- [ ] Пет актива в изданието: tar.gz, integration zip, `RELEASE.json`, `repository.yaml`,
      `SHA256SUMS.txt` — и `sha256` на качените архиви съвпада със `SHA256SUMS.txt`
      (сваляне + `Get-FileHash`, не „изглежда качено“).
- [ ] HACS хранилището (`PasevSU/hapi-enterprise-integration`) е на същата версия:
      `pwsh scripts/publish-haoss.ps1 -Version <v> -Execute` (без `-Execute` е dry run).
- [ ] Release notes published.
- [ ] `RELEASE_DECISION.md` signed with date + approver.

> Пълното описание на артефактите, сценариите и командите е в `RELEASE_BUILD.md`.
