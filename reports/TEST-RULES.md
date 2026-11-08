# Регистър на правилата — всеки тест е правило

> Генериран от `scripts/gen-test-rules.cjs`; **не се редактира на ръка**. Проверява се от
> `tests/scenario-matrix.cjs` (съвпадение в двете посоки) и от `--check` на генератора.

**Общо: 384 правила · 33 области · 100% от `tests/*.cjs`.**

| Област | Правила |
| --- | --- |
| общо | 177 |
| портал | 35 |
| GUI | 25 |
| Home Assistant | 17 |
| отчети | 16 |
| PGP | 14 |
| ядро | 12 |
| съхранение | 7 |
| издаване | 6 |
| оракул | 6 |
| тайни връзки | 6 |
| пакети | 5 |
| споделени данни | 5 |
| SQLite | 4 |
| TSA | 4 |
| backup | 4 |
| админ API | 4 |
| документация | 4 |
| правила | 4 |
| публичен API | 4 |
| HTML | 3 |
| грешки | 3 |
| огледало | 3 |
| одит | 3 |
| HACS издание | 2 |
| jobs | 2 |
| връзки | 2 |
| сигурност | 2 |
| lint | 1 |
| посетители | 1 |
| потоци | 1 |
| сензори | 1 |
| трансфер | 1 |

## общо (177)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `access-policy` | Access policy | `tests/access-policy.cjs` |
| `addon-changelog` | Addon changelog | `tests/addon-changelog.cjs` |
| `addon-config` | Addon config | `tests/addon-config.cjs` |
| `addon-defaults-startup` | Addon defaults startup | `tests/addon-defaults-startup.cjs` |
| `addon-translations` | Addon translations | `tests/addon-translations.cjs` |
| `analysis-claims` | Analysis claims | `tests/analysis-claims.cjs` |
| `api-generation` | Api generation | `tests/api-generation.cjs` |
| `api-input-errors` | Api input errors | `tests/api-input-errors.cjs` |
| `api-json-links` | Api json links | `tests/api-json-links.cjs` |
| `api-reference` | Api reference | `tests/api-reference.cjs` |
| `api-robustness` | Api robustness | `tests/api-robustness.cjs` |
| `api-rules-connection` | Api rules connection | `tests/api-rules-connection.cjs` |
| `api-spec-coverage` | Api spec coverage | `tests/api-spec-coverage.cjs` |
| `apply-update-script` | Apply update script | `tests/apply-update-script.cjs` |
| `audit` | Audit | `tests/audit.cjs` |
| `auth` | Auth | `tests/auth.cjs` |
| `bad-code` | Bad code | `tests/bad-code.cjs` |
| `bulk-access` | Bulk access | `tests/bulk-access.cjs` |
| `cabinet-merge-taxonomy` | Cabinet merge taxonomy | `tests/cabinet-merge-taxonomy.cjs` |
| `case-access` | Case access | `tests/case-access.cjs` |
| `cases` | Cases | `tests/cases.cjs` |
| `chaos-resilience` | Chaos resilience | `tests/chaos-resilience.cjs` |
| `cms-panel` | Cms panel | `tests/cms-panel.cjs` |
| `concurrent-links` | Concurrent links | `tests/concurrent-links.cjs` |
| `config-profiles` | Config profiles | `tests/config-profiles.cjs` |
| `content-id` | Content id | `tests/content-id.cjs` |
| `corrupt-metadata` | Corrupt metadata | `tests/corrupt-metadata.cjs` |
| `court-roles` | Court roles | `tests/court-roles.cjs` |
| `court-whoami` | Court whoami | `tests/court-whoami.cjs` |
| `crypto-options` | Crypto options | `tests/crypto-options.cjs` |
| `dashboard` | Dashboard | `tests/dashboard.cjs` |
| `data-settings` | Data settings | `tests/data-settings.cjs` |
| `decision-sensors` | Decision sensors | `tests/decision-sensors.cjs` |
| `diagnostics` | Diagnostics | `tests/diagnostics.cjs` |
| `directory-contract` | Directory contract | `tests/directory-contract.cjs` |
| `directory-organizations` | Directory organizations | `tests/directory-organizations.cjs` |
| `directory-variables` | Directory variables | `tests/directory-variables.cjs` |
| `dist-folder` | Dist folder | `tests/dist-folder.cjs` |
| `docker-runtime` | Docker runtime | `tests/docker-runtime.cjs` |
| `docx-pdf` | Docx pdf | `tests/docx-pdf.cjs` |
| `dom-harness` | Dom harness | `tests/dom-harness.cjs` |
| `download-access` | Download access | `tests/download-access.cjs` |
| `download-stream` | Download stream | `tests/download-stream.cjs` |
| `edge-runtime` | Edge runtime | `tests/edge-runtime.cjs` |
| `enterprise` | Enterprise | `tests/enterprise.cjs` |
| `enterprise-lifecycle` | Enterprise lifecycle | `tests/enterprise-lifecycle.cjs` |
| `eslint-baseline` | Eslint baseline | `tests/eslint-baseline.cjs` |
| `event-stream` | Event stream | `tests/event-stream.cjs` |
| `evidence-portal` | Evidence portal | `tests/evidence-portal.cjs` |
| `evidence-portal-info-qr` | Evidence portal info qr | `tests/evidence-portal-info-qr.cjs` |
| `evidence-portal-publish` | Evidence portal publish | `tests/evidence-portal-publish.cjs` |
| `evidence-portal-render` | Evidence portal render | `tests/evidence-portal-render.cjs` |
| `evidence-portal-root` | Evidence portal root | `tests/evidence-portal-root.cjs` |
| `export-config` | Export config | `tests/export-config.cjs` |
| `export-manager` | Export manager | `tests/export-manager.cjs` |
| `export-rules` | Export rules | `tests/export-rules.cjs` |
| `export-tracked` | Export tracked | `tests/export-tracked.cjs` |
| `file-encryption` | File encryption | `tests/file-encryption.cjs` |
| `file-link-works` | File link works | `tests/file-link-works.cjs` |
| `file-placement` | File placement | `tests/file-placement.cjs` |
| `file-transfer` | File transfer | `tests/file-transfer.cjs` |
| `files-manager` | Files manager | `tests/files-manager.cjs` |
| `folder-delete` | Folder delete | `tests/folder-delete.cjs` |
| `forensic-exif` | Forensic exif | `tests/forensic-exif.cjs` |
| `format-scope` | Format scope | `tests/format-scope.cjs` |
| `full-journey` | Full journey | `tests/full-journey.cjs` |
| `full-journey-office` | Full journey office | `tests/full-journey-office.cjs` |
| `full-journey-sensors` | Full journey sensors | `tests/full-journey-sensors.cjs` |
| `function-catalog` | Function catalog | `tests/function-catalog.cjs` |
| `gateway-api` | Gateway api | `tests/gateway-api.cjs` |
| `gateway-server` | Gateway server | `tests/gateway-server.cjs` |
| `generator-app` | Generator app | `tests/generator-app.cjs` |
| `hacs-structure` | Hacs structure | `tests/hacs-structure.cjs` |
| `hassfest-local` | Hassfest local | `tests/hassfest-local.cjs` |
| `helper-contracts` | Helper contracts | `tests/helper-contracts.cjs` |
| `helper-contracts-2` | Helper contracts 2 | `tests/helper-contracts-2.cjs` |
| `helper-contracts-3` | Helper contracts 3 | `tests/helper-contracts-3.cjs` |
| `idempotency` | Idempotency | `tests/idempotency.cjs` |
| `ingress-api-base` | Ingress api base | `tests/ingress-api-base.cjs` |
| `ingress-auth` | Ingress auth | `tests/ingress-auth.cjs` |
| `ingress-isolation` | Ingress isolation | `tests/ingress-isolation.cjs` |
| `ingress-panel-load` | Ingress panel load | `tests/ingress-panel-load.cjs` |
| `instance-lock` | Instance lock | `tests/instance-lock.cjs` |
| `instance-lock-retry` | Instance lock retry | `tests/instance-lock-retry.cjs` |
| `integration-runtime-data` | Integration runtime data | `tests/integration-runtime-data.cjs` |
| `integrity` | Integrity | `tests/integrity.cjs` |
| `internal` | Internal | `tests/internal.cjs` |
| `interpolate` | Interpolate | `tests/interpolate.cjs` |
| `known-defects` | Known defects | `tests/known-defects.cjs` |
| `layout` | Layout | `tests/layout.cjs` |
| `legacy-logic-residue` | Legacy logic residue | `tests/legacy-logic-residue.cjs` |
| `line-endings` | Line endings | `tests/line-endings.cjs` |
| `links-contract` | Links contract | `tests/links-contract.cjs` |
| `load-control` | Load control | `tests/load-control.cjs` |
| `logger` | Logger | `tests/logger.cjs` |
| `logic-audit` | Logic audit | `tests/logic-audit.cjs` |
| `logic-boundaries` | Logic boundaries | `tests/logic-boundaries.cjs` |
| `logs-api` | Logs api | `tests/logs-api.cjs` |
| `manifest-schema` | Manifest schema | `tests/manifest-schema.cjs` |
| `network-storage` | Network storage | `tests/network-storage.cjs` |
| `no-stubs` | No stubs | `tests/no-stubs.cjs` |
| `node-runtime-gate` | Node runtime gate | `tests/node-runtime-gate.cjs` |
| `office-processing` | Office processing | `tests/office-processing.cjs` |
| `oidc-login` | Oidc login | `tests/oidc-login.cjs` |
| `openapi-admin` | Openapi admin | `tests/openapi-admin.cjs` |
| `packaged-docs` | Packaged docs | `tests/packaged-docs.cjs` |
| `packager` | Packager | `tests/packager.cjs` |
| `pagination` | Pagination | `tests/pagination.cjs` |
| `panel-framing` | Panel framing | `tests/panel-framing.cjs` |
| `panel-registry` | Panel registry | `tests/panel-registry.cjs` |
| `paptresor` | Paptresor | `tests/paptresor.cjs` |
| `parallel-transfers` | Parallel transfers | `tests/parallel-transfers.cjs` |
| `pdf-signature` | Pdf signature | `tests/pdf-signature.cjs` |
| `pgp` | Pgp | `tests/pgp.cjs` |
| `policy-gui` | Policy gui | `tests/policy-gui.cjs` |
| `powershell-scripts` | Powershell scripts | `tests/powershell-scripts.cjs` |
| `preview` | Preview | `tests/preview.cjs` |
| `problem` | Problem | `tests/problem.cjs` |
| `process-guards` | Process guards | `tests/process-guards.cjs` |
| `publish-script` | Publish script | `tests/publish-script.cjs` |
| `qr-dispatch` | Qr dispatch | `tests/qr-dispatch.cjs` |
| `qr-leads-to-folder` | Qr leads to folder | `tests/qr-leads-to-folder.cjs` |
| `qr-rollback` | Qr rollback | `tests/qr-rollback.cjs` |
| `raspberrypi-compat` | Raspberrypi compat | `tests/raspberrypi-compat.cjs` |
| `rate-limit` | Rate limit | `tests/rate-limit.cjs` |
| `rbac` | Rbac | `tests/rbac.cjs` |
| `rbac-default-matrix` | Rbac default matrix | `tests/rbac-default-matrix.cjs` |
| `rbac-sso` | Rbac sso | `tests/rbac-sso.cjs` |
| `readiness` | Readiness | `tests/readiness.cjs` |
| `readiness-integrity` | Readiness integrity | `tests/readiness-integrity.cjs` |
| `real-journey` | Real journey | `tests/real-journey.cjs` |
| `respond` | Respond | `tests/respond.cjs` |
| `resume-transfer` | Resume transfer | `tests/resume-transfer.cjs` |
| `retention` | Retention | `tests/retention.cjs` |
| `retention-audit` | Retention audit | `tests/retention-audit.cjs` |
| `retention-audit-lines` | Retention audit lines | `tests/retention-audit-lines.cjs` |
| `retention-cost` | Retention cost | `tests/retention-cost.cjs` |
| `retention-evidence` | Retention evidence | `tests/retention-evidence.cjs` |
| `rfc3161-api` | Rfc3161 api | `tests/rfc3161-api.cjs` |
| `rollback` | Rollback | `tests/rollback.cjs` |
| `runtime-config` | Runtime config | `tests/runtime-config.cjs` |
| `runtime-limits` | Runtime limits | `tests/runtime-limits.cjs` |
| `scenario-matrix` | Scenario matrix | `tests/scenario-matrix.cjs` |
| `schema-reality` | Schema reality | `tests/schema-reality.cjs` |
| `sealed-vault` | Sealed vault | `tests/sealed-vault.cjs` |
| `search-api` | Search api | `tests/search-api.cjs` |
| `security-defaults` | Security defaults | `tests/security-defaults.cjs` |
| `send` | Send | `tests/send.cjs` |
| `sensors` | Sensors | `tests/sensors.cjs` |
| `sensors-telemetry` | Sensors telemetry | `tests/sensors-telemetry.cjs` |
| `server-structure` | Server structure | `tests/server-structure.cjs` |
| `settings-defaults` | Settings defaults | `tests/settings-defaults.cjs` |
| `settings-policies` | Settings policies | `tests/settings-policies.cjs` |
| `share-links` | Share links | `tests/share-links.cjs` |
| `shared-mode-shutdown` | Shared mode shutdown | `tests/shared-mode-shutdown.cjs` |
| `signed-url-restart` | Signed url restart | `tests/signed-url-restart.cjs` |
| `signing` | Signing | `tests/signing.cjs` |
| `signing-fallback` | Signing fallback | `tests/signing-fallback.cjs` |
| `single-source` | Single source | `tests/single-source.cjs` |
| `smoke` | Smoke | `tests/smoke.cjs` |
| `source-inventory` | Source inventory | `tests/source-inventory.cjs` |
| `start-entrypoint` | Start entrypoint | `tests/start-entrypoint.cjs` |
| `start-portal-open` | Start portal open | `tests/start-portal-open.cjs` |
| `start-token-required` | Start token required | `tests/start-token-required.cjs` |
| `storage` | Storage | `tests/storage.cjs` |
| `store-accessors` | Store accessors | `tests/store-accessors.cjs` |
| `store-migration` | Store migration | `tests/store-migration.cjs` |
| `tag-version` | Tag version | `tests/tag-version.cjs` |
| `taxonomy` | Taxonomy | `tests/taxonomy.cjs` |
| `update-repo` | Update repo | `tests/update-repo.cjs` |
| `upload-rollback-guard` | Upload rollback guard | `tests/upload-rollback-guard.cjs` |
| `versioning` | Versioning | `tests/versioning.cjs` |
| `virtual-storage` | Virtual storage | `tests/virtual-storage.cjs` |
| `visitors-panel` | Visitors panel | `tests/visitors-panel.cjs` |
| `webhook-events` | Webhook events | `tests/webhook-events.cjs` |
| `webhooks` | Webhooks | `tests/webhooks.cjs` |
| `worm` | Worm | `tests/worm.cjs` |

## портал (35)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `portal-api-map` | Portal api map | `tests/portal-api-map.cjs` |
| `portal-api-qr` | Portal api qr | `tests/portal-api-qr.cjs` |
| `portal-archive` | Portal archive | `tests/portal-archive.cjs` |
| `portal-card-link` | Portal card link | `tests/portal-card-link.cjs` |
| `portal-chain` | Portal chain | `tests/portal-chain.cjs` |
| `portal-file-page` | Portal file page | `tests/portal-file-page.cjs` |
| `portal-folder` | Portal folder | `tests/portal-folder.cjs` |
| `portal-folder-artifacts` | Portal folder artifacts | `tests/portal-folder-artifacts.cjs` |
| `portal-folder-button` | Portal folder button | `tests/portal-folder-button.cjs` |
| `portal-folder-contract` | Portal folder contract | `tests/portal-folder-contract.cjs` |
| `portal-folder-copy` | Portal folder copy | `tests/portal-folder-copy.cjs` |
| `portal-folder-lock` | Portal folder lock | `tests/portal-folder-lock.cjs` |
| `portal-folder-portal` | Portal folder portal | `tests/portal-folder-portal.cjs` |
| `portal-folder-refs` | Portal folder refs | `tests/portal-folder-refs.cjs` |
| `portal-greeting` | Portal greeting | `tests/portal-greeting.cjs` |
| `portal-hash-verify` | Portal hash verify | `tests/portal-hash-verify.cjs` |
| `portal-html-sandbox` | Portal html sandbox | `tests/portal-html-sandbox.cjs` |
| `portal-i18n` | Portal i18n | `tests/portal-i18n.cjs` |
| `portal-integrity` | Portal integrity | `tests/portal-integrity.cjs` |
| `portal-monitoring` | Portal monitoring | `tests/portal-monitoring.cjs` |
| `portal-no-links` | Portal no links | `tests/portal-no-links.cjs` |
| `portal-order` | Portal order | `tests/portal-order.cjs` |
| `portal-page` | Portal page | `tests/portal-page.cjs` |
| `portal-page-contract` | Portal page contract | `tests/portal-page-contract.cjs` |
| `portal-page-lang` | Portal page lang | `tests/portal-page-lang.cjs` |
| `portal-page-render` | Portal page render | `tests/portal-page-render.cjs` |
| `portal-policy-secret-links` | Portal policy secret links | `tests/portal-policy-secret-links.cjs` |
| `portal-qr-archive` | Portal qr archive | `tests/portal-qr-archive.cjs` |
| `portal-qr-badge` | Portal qr badge | `tests/portal-qr-badge.cjs` |
| `portal-qr-restore` | Portal qr restore | `tests/portal-qr-restore.cjs` |
| `portal-root-page` | Portal root page | `tests/portal-root-page.cjs` |
| `portal-rules-applied` | Portal rules applied | `tests/portal-rules-applied.cjs` |
| `portal-skin` | Portal skin | `tests/portal-skin.cjs` |
| `portal-tokens` | Portal tokens | `tests/portal-tokens.cjs` |
| `portal-variants` | Portal variants | `tests/portal-variants.cjs` |

## GUI (25)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `gui-coverage` | Gui coverage | `tests/gui-coverage.cjs` |
| `gui-csp-guard` | Gui csp guard | `tests/gui-csp-guard.cjs` |
| `gui-csp-same-origin` | Gui csp same origin | `tests/gui-csp-same-origin.cjs` |
| `gui-debug-objects` | Gui debug objects | `tests/gui-debug-objects.cjs` |
| `gui-file-share` | Gui file share | `tests/gui-file-share.cjs` |
| `gui-journeys` | Gui journeys | `tests/gui-journeys.cjs` |
| `gui-monitoring` | Gui monitoring | `tests/gui-monitoring.cjs` |
| `gui-only-guard` | Gui only guard | `tests/gui-only-guard.cjs` |
| `gui-open-portal-link` | Gui open portal link | `tests/gui-open-portal-link.cjs` |
| `gui-package` | Gui package | `tests/gui-package.cjs` |
| `gui-panels` | Gui panels | `tests/gui-panels.cjs` |
| `gui-portal-refs` | Gui portal refs | `tests/gui-portal-refs.cjs` |
| `gui-portal-token` | Gui portal token | `tests/gui-portal-token.cjs` |
| `gui-sections` | Gui sections | `tests/gui-sections.cjs` |
| `gui-starter-pyw` | Gui starter pyw | `tests/gui-starter-pyw.cjs` |
| `ui-coverage` | Ui coverage | `tests/ui-coverage.cjs` |
| `ui-css-split` | Ui css split | `tests/ui-css-split.cjs` |
| `ui-i18n` | Ui i18n | `tests/ui-i18n.cjs` |
| `ui-icons` | Ui icons | `tests/ui-icons.cjs` |
| `ui-navigation` | Ui navigation | `tests/ui-navigation.cjs` |
| `ui-settings-sections` | Ui settings sections | `tests/ui-settings-sections.cjs` |
| `ui-shell-nav` | Ui shell nav | `tests/ui-shell-nav.cjs` |
| `ui-skin` | Ui skin | `tests/ui-skin.cjs` |
| `ui-spacing` | Ui spacing | `tests/ui-spacing.cjs` |
| `ui-version` | Ui version | `tests/ui-version.cjs` |

## Home Assistant (17)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `ha-admin-api-port` | Ha admin api port | `tests/ha-admin-api-port.cjs` |
| `ha-auth-contract` | Ha auth contract | `tests/ha-auth-contract.cjs` |
| `ha-bridge` | Ha bridge | `tests/ha-bridge.cjs` |
| `ha-compat` | Ha compat | `tests/ha-compat.cjs` |
| `ha-compatibility` | Ha compatibility | `tests/ha-compatibility.cjs` |
| `ha-config-flow-errors` | Ha config flow errors | `tests/ha-config-flow-errors.cjs` |
| `ha-diag-redaction` | Ha diag redaction | `tests/ha-diag-redaction.cjs` |
| `ha-integration-flow` | Ha integration flow | `tests/ha-integration-flow.cjs` |
| `ha-integration-import` | Ha integration import | `tests/ha-integration-import.cjs` |
| `ha-integration-proxy` | Ha integration proxy | `tests/ha-integration-proxy.cjs` |
| `ha-integration-python` | Ha integration python | `tests/ha-integration-python.cjs` |
| `ha-path-prefix` | Ha path prefix | `tests/ha-path-prefix.cjs` |
| `ha-portal-folder-page` | Ha portal folder page | `tests/ha-portal-folder-page.cjs` |
| `ha-range-bridge` | Ha range bridge | `tests/ha-range-bridge.cjs` |
| `ha-support-matrix` | Ha support matrix | `tests/ha-support-matrix.cjs` |
| `ha-translations` | Ha translations | `tests/ha-translations.cjs` |
| `ha-version-sensor` | Ha version sensor | `tests/ha-version-sensor.cjs` |

## отчети (16)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `report-api` | Report api | `tests/report-api.cjs` |
| `report-entry-points` | Report entry points | `tests/report-entry-points.cjs` |
| `report-manifest` | Report manifest | `tests/report-manifest.cjs` |
| `report-manifests` | Report manifests | `tests/report-manifests.cjs` |
| `report-objects` | Report objects | `tests/report-objects.cjs` |
| `report-objects-real` | Report objects real | `tests/report-objects-real.cjs` |
| `report-package` | Report package | `tests/report-package.cjs` |
| `report-qr` | Report qr | `tests/report-qr.cjs` |
| `report-render` | Report render | `tests/report-render.cjs` |
| `report-scope` | Report scope | `tests/report-scope.cjs` |
| `report-stamp` | Report stamp | `tests/report-stamp.cjs` |
| `report-studio-columns` | Report studio columns | `tests/report-studio-columns.cjs` |
| `report-studio-panel` | Report studio panel | `tests/report-studio-panel.cjs` |
| `report-table-header-repeat` | Report table header repeat | `tests/report-table-header-repeat.cjs` |
| `report-table-widths` | Report table widths | `tests/report-table-widths.cjs` |
| `report-tsa-e2e` | Report tsa e2e | `tests/report-tsa-e2e.cjs` |

## PGP (14)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `pgp-aead` | Pgp aead | `tests/pgp-aead.cjs` |
| `pgp-aead-interop` | Pgp aead interop | `tests/pgp-aead-interop.cjs` |
| `pgp-bundle` | Pgp bundle | `tests/pgp-bundle.cjs` |
| `pgp-engine` | Pgp engine | `tests/pgp-engine.cjs` |
| `pgp-gpg-interop` | Pgp gpg interop | `tests/pgp-gpg-interop.cjs` |
| `pgp-keyflags` | Pgp keyflags | `tests/pgp-keyflags.cjs` |
| `pgp-keyring` | Pgp keyring | `tests/pgp-keyring.cjs` |
| `pgp-mpi` | Pgp mpi | `tests/pgp-mpi.cjs` |
| `pgp-path-encryption` | Pgp path encryption | `tests/pgp-path-encryption.cjs` |
| `pgp-sign` | Pgp sign | `tests/pgp-sign.cjs` |
| `pgp-tools` | Pgp tools | `tests/pgp-tools.cjs` |
| `pgp-unknown-subkey` | Pgp unknown subkey | `tests/pgp-unknown-subkey.cjs` |
| `pgp-v6` | Pgp v6 | `tests/pgp-v6.cjs` |
| `pgp-workdir-encryption` | Pgp workdir encryption | `tests/pgp-workdir-encryption.cjs` |

## ядро (12)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `core-api-version` | Core api version | `tests/core-api-version.cjs` |
| `core-container` | Core container | `tests/core-container.cjs` |
| `core-groups` | Core groups | `tests/core-groups.cjs` |
| `core-migration` | Core migration | `tests/core-migration.cjs` |
| `core-orphan` | Core orphan | `tests/core-orphan.cjs` |
| `core-plugins` | Core plugins | `tests/core-plugins.cjs` |
| `core-profiles` | Core profiles | `tests/core-profiles.cjs` |
| `core-qr-file` | Core qr file | `tests/core-qr-file.cjs` |
| `core-repository` | Core repository | `tests/core-repository.cjs` |
| `core-signer` | Core signer | `tests/core-signer.cjs` |
| `core-store` | Core store | `tests/core-store.cjs` |
| `core-variables` | Core variables | `tests/core-variables.cjs` |

## съхранение (7)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `storage-check` | Storage check | `tests/storage-check.cjs` |
| `storage-default-location` | Storage default location | `tests/storage-default-location.cjs` |
| `storage-migrate` | Storage migrate | `tests/storage-migrate.cjs` |
| `storage-mirror` | Storage mirror | `tests/storage-mirror.cjs` |
| `storage-paths` | Storage paths | `tests/storage-paths.cjs` |
| `storage-tree` | Storage tree | `tests/storage-tree.cjs` |
| `storage-tree-api` | Storage tree api | `tests/storage-tree-api.cjs` |

## издаване (6)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `release-acceptance` | Release acceptance | `tests/release-acceptance.cjs` |
| `release-archive-paths` | Release archive paths | `tests/release-archive-paths.cjs` |
| `release-notes` | Release notes | `tests/release-notes.cjs` |
| `release-status` | Release status | `tests/release-status.cjs` |
| `release-tooling` | Release tooling | `tests/release-tooling.cjs` |
| `release-workflow-assets` | Release workflow assets | `tests/release-workflow-assets.cjs` |

## оракул (6)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `oracle-digest-chain` | Oracle digest chain | `tests/oracle-digest-chain.cjs` |
| `oracle-interpolate` | Oracle interpolate | `tests/oracle-interpolate.cjs` |
| `oracle-lifecycle` | Oracle lifecycle | `tests/oracle-lifecycle.cjs` |
| `oracle-manifest-rules` | Oracle manifest rules | `tests/oracle-manifest-rules.cjs` |
| `oracle-rbac-matrix` | Oracle rbac matrix | `tests/oracle-rbac-matrix.cjs` |
| `oracle-slug-and-paths` | Oracle slug and paths | `tests/oracle-slug-and-paths.cjs` |

## тайни връзки (6)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `secret-exposure` | Secret exposure | `tests/secret-exposure.cjs` |
| `secret-links` | Secret links | `tests/secret-links.cjs` |
| `secret-lock` | Secret lock | `tests/secret-lock.cjs` |
| `secret-panel` | Secret panel | `tests/secret-panel.cjs` |
| `secret-patterns` | Secret patterns | `tests/secret-patterns.cjs` |
| `secret-sweep` | Secret sweep | `tests/secret-sweep.cjs` |

## пакети (5)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `package-api` | Package api | `tests/package-api.cjs` |
| `package-compression` | Package compression | `tests/package-compression.cjs` |
| `package-encryption` | Package encryption | `tests/package-encryption.cjs` |
| `package-scripts` | Package scripts | `tests/package-scripts.cjs` |
| `package-split` | Package split | `tests/package-split.cjs` |

## споделени данни (5)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `shared-data` | Shared data | `tests/shared-data.cjs` |
| `shared-data-access` | Shared data access | `tests/shared-data-access.cjs` |
| `shared-data-burst` | Shared data burst | `tests/shared-data-burst.cjs` |
| `shared-data-lock` | Shared data lock | `tests/shared-data-lock.cjs` |
| `shared-data-processes` | Shared data processes | `tests/shared-data-processes.cjs` |

## SQLite (4)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `sqlite-backup` | Sqlite backup | `tests/sqlite-backup.cjs` |
| `sqlite-size` | Sqlite size | `tests/sqlite-size.cjs` |
| `sqlite-snapshot-safety` | Sqlite snapshot safety | `tests/sqlite-snapshot-safety.cjs` |
| `sqlite-store` | Sqlite store | `tests/sqlite-store.cjs` |

## TSA (4)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `tsa-breaker` | Tsa breaker | `tests/tsa-breaker.cjs` |
| `tsa-client` | Tsa client | `tests/tsa-client.cjs` |
| `tsa-evidence` | Tsa evidence | `tests/tsa-evidence.cjs` |
| `tsa-insecure-url` | Tsa insecure url | `tests/tsa-insecure-url.cjs` |

## backup (4)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `backup-api` | Backup api | `tests/backup-api.cjs` |
| `backup-mirror` | Backup mirror | `tests/backup-mirror.cjs` |
| `backup-restore` | Backup restore | `tests/backup-restore.cjs` |
| `backup-schedule` | Backup schedule | `tests/backup-schedule.cjs` |

## админ API (4)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `admin-api-spec` | Admin api spec | `tests/admin-api-spec.cjs` |
| `admin-hierarchy` | Admin hierarchy | `tests/admin-hierarchy.cjs` |
| `admin-throttle` | Admin throttle | `tests/admin-throttle.cjs` |
| `admin-token-shape` | Admin token shape | `tests/admin-token-shape.cjs` |

## документация (4)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `doc-citations` | Doc citations | `tests/doc-citations.cjs` |
| `docs-consistency` | Docs consistency | `tests/docs-consistency.cjs` |
| `docs-index` | Docs index | `tests/docs-index.cjs` |
| `docs-manual` | Docs manual | `tests/docs-manual.cjs` |

## правила (4)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `rules-config` | Rules config | `tests/rules-config.cjs` |
| `rules-declarations` | Rules declarations | `tests/rules-declarations.cjs` |
| `rules-invalid` | Rules invalid | `tests/rules-invalid.cjs` |
| `rules-parity` | Rules parity | `tests/rules-parity.cjs` |

## публичен API (4)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `public-gateway` | Public gateway | `tests/public-gateway.cjs` |
| `public-package` | Public package | `tests/public-package.cjs` |
| `public-rate-limit` | Public rate limit | `tests/public-rate-limit.cjs` |
| `public-route-allowlist` | Public route allowlist | `tests/public-route-allowlist.cjs` |

## HTML (3)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `html-assets` | Html assets | `tests/html-assets.cjs` |
| `html-projects` | Html projects | `tests/html-projects.cjs` |
| `html-publish` | Html publish | `tests/html-publish.cjs` |

## грешки (3)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `error-codes` | Error codes | `tests/error-codes.cjs` |
| `error-log` | Error log | `tests/error-log.cjs` |
| `error-logging` | Error logging | `tests/error-logging.cjs` |

## огледало (3)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `mirror-s3-wiring` | Mirror s3 wiring | `tests/mirror-s3-wiring.cjs` |
| `mirror-target` | Mirror target | `tests/mirror-target.cjs` |
| `mirror-target-timeout` | Mirror target timeout | `tests/mirror-target-timeout.cjs` |

## одит (3)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `audit-chain` | Audit chain | `tests/audit-chain.cjs` |
| `audit-events` | Audit events | `tests/audit-events.cjs` |
| `audit-export` | Audit export | `tests/audit-export.cjs` |

## HACS издание (2)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `haoss-in-sync` | Haoss in sync | `tests/haoss-in-sync.cjs` |
| `haoss-release` | Haoss release | `tests/haoss-release.cjs` |

## jobs (2)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `job-manager` | Job manager | `tests/job-manager.cjs` |
| `job-persistence` | Job persistence | `tests/job-persistence.cjs` |

## връзки (2)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `link-check` | Link check | `tests/link-check.cjs` |
| `link-check-home-assistant` | Link check home assistant | `tests/link-check-home-assistant.cjs` |

## сигурност (2)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `blackbox-security` | Blackbox security | `tests/blackbox-security.cjs` |
| `whitebox-security` | Whitebox security | `tests/whitebox-security.cjs` |

## lint (1)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `lint-config` | Lint config | `tests/lint-config.cjs` |

## посетители (1)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `visitor-sensors` | Visitor sensors | `tests/visitor-sensors.cjs` |

## потоци (1)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `live-stream-lifecycle` | Live stream lifecycle | `tests/live-stream-lifecycle.cjs` |

## сензори (1)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `sensor-settings` | Sensor settings | `tests/sensor-settings.cjs` |

## трансфер (1)

| Правило | Заглавие | Файл |
| --- | --- | --- |
| `transfer-mirror` | Transfer mirror | `tests/transfer-mirror.cjs` |
