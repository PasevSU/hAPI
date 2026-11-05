# ОБХОД НА СКРИПТОВИТЕ ФАЙЛОВЕ — ПЪЛНА ТАБЛИЦА

Генериран от `node scripts/script-audit.cjs`. Редът е за ВСЕКИ файл, включително когато
сигналите са нула: така „обходено“ може да се провери, вместо да се вярва.

Обходени: **194 файла · 51197 реда**.
Намерени: **212** сигнала — високи **0** · средни 0 · ниски 212.

По правило: `swallow-promise` 99 · `unused-export` 98 · `sync-fs-in-request` 15

## По сегмент

| сегмент | файлове | редове | сигнали |
| --- | ---: | ---: | ---: |
| ядро | 101 | 24885 | 170 |
| ui | 23 | 12215 | 11 |
| скриптове | 36 | 6609 | 0 |
| routes | 17 | 2798 | 25 |
| интеграция | 9 | 2669 | 1 |
| portal | 2 | 1573 | 2 |
| generator | 1 | 285 | 0 |
| plugins | 3 | 90 | 1 |
| evidence-portal | 2 | 73 | 2 |

## По файл

`тестове` = в колко тестови файла се споменава модулът (0 значи, че никой тест не го пипа).

| файл | редове | тестове | сигнали | присъда |
| --- | ---: | ---: | --- | --- |
| `custom_components/hapi_enterprise/__init__.py` | 463 | 19 | — | чисто |
| `custom_components/hapi_enterprise/binary_sensor.py` | 158 | 3 | — | чисто |
| `custom_components/hapi_enterprise/config_flow.py` | 220 | 11 | — | чисто |
| `custom_components/hapi_enterprise/const.py` | 32 | 367 | — | чисто |
| `custom_components/hapi_enterprise/coordinator.py` | 216 | 8 | — | чисто |
| `custom_components/hapi_enterprise/diagnostics.py` | 84 | 15 | — | чисто |
| `custom_components/hapi_enterprise/entity.py` | 57 | 4 | — | чисто |
| `custom_components/hapi_enterprise/portal.js` | 848 | 196 | swallow-promise×1 | нисък |
| `custom_components/hapi_enterprise/sensor.py` | 591 | 9 | — | чисто |
| `hapi_enterprise/admin-api-spec.js` | 429 | 4 | — | чисто |
| `hapi_enterprise/api-registry.js` | 140 | 2 | swallow-promise×3 | нисък |
| `hapi_enterprise/api-spec.js` | 402 | 14 | — | чисто |
| `hapi_enterprise/api-version.js` | 23 | 2 | unused-export×1 | нисък |
| `hapi_enterprise/audit-chain.js` | 33 | 10 | swallow-promise×1 | нисък |
| `hapi_enterprise/cabinet.js` | 88 | 11 | — | чисто |
| `hapi_enterprise/case-access.js` | 66 | 2 | unused-export×1 | нисък |
| `hapi_enterprise/cases.js` | 98 | 47 | — | чисто |
| `hapi_enterprise/cms-sign.js` | 156 | 3 | unused-export×1 | нисък |
| `hapi_enterprise/config-profiles.js` | 25 | 6 | swallow-promise×1 | нисък |
| `hapi_enterprise/container.js` | 44 | 22 | — | чисто |
| `hapi_enterprise/content-id.js` | 47 | 4 | — | чисто |
| `hapi_enterprise/core-store.js` | 327 | 2 | — | чисто |
| `hapi_enterprise/crypto-options.js` | 40 | 3 | — | чисто |
| `hapi_enterprise/decision-sensors.js` | 290 | 2 | — | чисто |
| `hapi_enterprise/directory.js` | 301 | 29 | unused-export×2 | нисък |
| `hapi_enterprise/download-access.js` | 466 | 11 | — | чисто |
| `hapi_enterprise/download-stream.js` | 147 | 2 | unused-export×1 | нисък |
| `hapi_enterprise/error-log.js` | 32 | 6 | swallow-promise×1 | нисък |
| `hapi_enterprise/event-bus.js` | 44 | 3 | — | чисто |
| `hapi_enterprise/event-stream.js` | 114 | 3 | unused-export×3 | нисък |
| `hapi_enterprise/evidence-portal.js` | 206 | 9 | unused-export×1 | нисък |
| `hapi_enterprise/evidence-portal/assets/app.js` | 46 | 44 | swallow-promise×2 | нисък |
| `hapi_enterprise/evidence-portal/assets/consent.js` | 27 | 0 | — | чисто |
| `hapi_enterprise/exif.js` | 242 | 2 | unused-export×4 | нисък |
| `hapi_enterprise/export-manager.js` | 416 | 7 | swallow-promise×5 | нисък |
| `hapi_enterprise/export-rules.js` | 450 | 14 | — | чисто |
| `hapi_enterprise/file-crypto.js` | 23 | 2 | — | чисто |
| `hapi_enterprise/forensic.js` | 175 | 9 | unused-export×1 | нисък |
| `hapi_enterprise/gateway-api.js` | 386 | 7 | unused-export×4, sync-fs-in-request×3 | нисък |
| `hapi_enterprise/generator.js` | 193 | 16 | unused-export×1 | нисък |
| `hapi_enterprise/generator/app.js` | 285 | 44 | — | чисто |
| `hapi_enterprise/idempotency.js` | 216 | 2 | unused-export×4 | нисък |
| `hapi_enterprise/instance-lock.js` | 334 | 8 | unused-export×4 | нисък |
| `hapi_enterprise/interpolate.js` | 100 | 5 | — | чисто |
| `hapi_enterprise/job-manager.js` | 183 | 6 | unused-export×1 | нисък |
| `hapi_enterprise/layout.js` | 138 | 10 | — | чисто |
| `hapi_enterprise/links.js` | 228 | 30 | — | чисто |
| `hapi_enterprise/load-control.js` | 30 | 3 | — | чисто |
| `hapi_enterprise/logger.js` | 243 | 4 | unused-export×1 | нисък |
| `hapi_enterprise/migration-bridge.js` | 90 | 0 | — | чисто |
| `hapi_enterprise/mirror-target.js` | 232 | 4 | unused-export×4, swallow-promise×2 | нисък |
| `hapi_enterprise/notify.js` | 41 | 10 | — | чисто |
| `hapi_enterprise/observer.js` | 344 | 3 | unused-export×2 | нисък |
| `hapi_enterprise/oidc.js` | 187 | 3 | unused-export×1 | нисък |
| `hapi_enterprise/ooxml.js` | 214 | 15 | — | чисто |
| `hapi_enterprise/package-crypto.js` | 179 | 2 | — | чисто |
| `hapi_enterprise/packager.js` | 486 | 8 | unused-export×1 | нисък |
| `hapi_enterprise/path-crypto.js` | 393 | 4 | unused-export×1 | нисък |
| `hapi_enterprise/pdf-writer.js` | 437 | 10 | — | чисто |
| `hapi_enterprise/pgp.js` | 1554 | 32 | unused-export×2 | нисък |
| `hapi_enterprise/plugins.js` | 24 | 6 | — | чисто |
| `hapi_enterprise/plugins/ocr.js` | 32 | 3 | — | чисто |
| `hapi_enterprise/plugins/renderer.js` | 28 | 3 | — | чисто |
| `hapi_enterprise/plugins/storage.js` | 30 | 64 | swallow-promise×1 | нисък |
| `hapi_enterprise/portal-access.js` | 64 | 2 | unused-export×1 | нисък |
| `hapi_enterprise/portal-folder.js` | 358 | 13 | unused-export×1, swallow-promise×4 | нисък |
| `hapi_enterprise/portal-integrity.js` | 167 | 3 | unused-export×1, swallow-promise×2 | нисък |
| `hapi_enterprise/portal-policy.js` | 176 | 1 | unused-export×4 | нисък |
| `hapi_enterprise/portal-qr.js` | 234 | 4 | unused-export×3 | нисък |
| `hapi_enterprise/portal/portal-i18n.js` | 486 | 13 | — | чисто |
| `hapi_enterprise/portal/portal.js` | 1087 | 196 | swallow-promise×2 | нисък |
| `hapi_enterprise/preview.js` | 116 | 17 | unused-export×3 | нисък |
| `hapi_enterprise/problem.js` | 41 | 5 | — | чисто |
| `hapi_enterprise/process-guards.js` | 49 | 2 | — | чисто |
| `hapi_enterprise/public-gateway.js` | 430 | 13 | — | чисто |
| `hapi_enterprise/public-package.js` | 108 | 2 | unused-export×1 | нисък |
| `hapi_enterprise/public-route-allowlist.js` | 112 | 4 | — | чисто |
| `hapi_enterprise/qrcode.js` | 2303 | 12 | — | чисто |
| `hapi_enterprise/rbac.js` | 128 | 17 | — | чисто |
| `hapi_enterprise/readiness.js` | 43 | 8 | — | чисто |
| `hapi_enterprise/registry.js` | 113 | 13 | unused-export×1 | нисък |
| `hapi_enterprise/report-manifest.js` | 543 | 27 | — | чисто |
| `hapi_enterprise/report-package.js` | 153 | 2 | unused-export×1 | нисък |
| `hapi_enterprise/report-render.js` | 375 | 11 | unused-export×3 | нисък |
| `hapi_enterprise/report-stamp.js` | 277 | 5 | unused-export×4 | нисък |
| `hapi_enterprise/repository.js` | 20 | 10 | — | чисто |
| `hapi_enterprise/respond.js` | 58 | 3 | — | чисто |
| `hapi_enterprise/retention.js` | 141 | 16 | — | чисто |
| `hapi_enterprise/routes/admin-docs.js` | 38 | 1 | — | чисто |
| `hapi_enterprise/routes/events.js` | 47 | 23 | — | чисто |
| `hapi_enterprise/routes/evidence.js` | 95 | 36 | — | чисто |
| `hapi_enterprise/routes/file-transfer.js` | 186 | 5 | swallow-promise×8 | нисък |
| `hapi_enterprise/routes/folders.js` | 189 | 29 | swallow-promise×2 | нисък |
| `hapi_enterprise/routes/forensic.js` | 86 | 9 | — | чисто |
| `hapi_enterprise/routes/generator.js` | 65 | 16 | — | чисто |
| `hapi_enterprise/routes/link-check.js` | 168 | 3 | swallow-promise×1 | нисък |
| `hapi_enterprise/routes/oidc.js` | 145 | 3 | — | чисто |
| `hapi_enterprise/routes/pgp-keyring.js` | 92 | 2 | — | чисто |
| `hapi_enterprise/routes/portal-archive.js` | 290 | 3 | swallow-promise×11 | нисък |
| `hapi_enterprise/routes/portal-page.js` | 64 | 7 | — | чисто |
| `hapi_enterprise/routes/portal-qr.js` | 258 | 4 | swallow-promise×2 | нисък |
| `hapi_enterprise/routes/portal-storage.js` | 441 | 3 | swallow-promise×1 | нисък |
| `hapi_enterprise/routes/portal-tokens.js` | 215 | 4 | — | чисто |
| `hapi_enterprise/routes/reports.js` | 314 | 23 | — | чисто |
| `hapi_enterprise/routes/webhooks.js` | 105 | 5 | — | чисто |
| `hapi_enterprise/runtime-config.js` | 179 | 11 | swallow-promise×1 | нисък |
| `hapi_enterprise/secret-links.js` | 368 | 6 | unused-export×8 | нисък |
| `hapi_enterprise/secret-lock.js` | 42 | 4 | — | чисто |
| `hapi_enterprise/secret-page.js` | 41 | 0 | — | чисто |
| `hapi_enterprise/secret-view.js` | 205 | 5 | — | чисто |
| `hapi_enterprise/send.js` | 141 | 7 | unused-export×1 | нисък |
| `hapi_enterprise/server.js` | 2722 | 225 | sync-fs-in-request×12, swallow-promise×32 | нисък |
| `hapi_enterprise/share-links.js` | 103 | 3 | — | чисто |
| `hapi_enterprise/shared-data.js` | 362 | 6 | unused-export×2 | нисък |
| `hapi_enterprise/signer.js` | 34 | 3 | — | чисто |
| `hapi_enterprise/site-csp.js` | 31 | 1 | unused-export×1 | нисък |
| `hapi_enterprise/sqlite-repository.js` | 52 | 3 | — | чисто |
| `hapi_enterprise/sqlite-store.js` | 353 | 12 | — | чисто |
| `hapi_enterprise/standalone.js` | 126 | 8 | unused-export×4 | нисък |
| `hapi_enterprise/start.js` | 277 | 75 | — | чисто |
| `hapi_enterprise/storage-check.js` | 20 | 3 | — | чисто |
| `hapi_enterprise/storage-migrate.js` | 23 | 4 | — | чисто |
| `hapi_enterprise/storage-preflight.js` | 77 | 8 | unused-export×5 | нисък |
| `hapi_enterprise/storage-tree.js` | 201 | 9 | — | чисто |
| `hapi_enterprise/throttle.js` | 112 | 3 | unused-export×3 | нисък |
| `hapi_enterprise/tsa-client.js` | 450 | 8 | unused-export×4 | нисък |
| `hapi_enterprise/ui/api-base.js` | 60 | 4 | — | чисто |
| `hapi_enterprise/ui/app.js` | 372 | 44 | — | чисто |
| `hapi_enterprise/ui/bootstrap.js` | 52 | 11 | — | чисто |
| `hapi_enterprise/ui/dashboard-panel.js` | 398 | 9 | swallow-promise×1 | нисък |
| `hapi_enterprise/ui/data.js` | 207 | 203 | — | чисто |
| `hapi_enterprise/ui/directory-panel.js` | 496 | 6 | — | чисто |
| `hapi_enterprise/ui/export-center.js` | 624 | 6 | — | чисто |
| `hapi_enterprise/ui/files-manager.js` | 4048 | 27 | swallow-promise×9 | нисък |
| `hapi_enterprise/ui/i18n.js` | 422 | 19 | — | чисто |
| `hapi_enterprise/ui/icons.js` | 106 | 15 | — | чисто |
| `hapi_enterprise/ui/panel-registry.js` | 202 | 7 | — | чисто |
| `hapi_enterprise/ui/portal-control.js` | 191 | 11 | — | чисто |
| `hapi_enterprise/ui/portal-files.js` | 229 | 13 | — | чисто |
| `hapi_enterprise/ui/portal-folders.js` | 200 | 9 | — | чисто |
| `hapi_enterprise/ui/portals.js` | 286 | 161 | — | чисто |
| `hapi_enterprise/ui/public-gateway.js` | 449 | 13 | — | чисто |
| `hapi_enterprise/ui/report-objects.js` | 85 | 7 | — | чисто |
| `hapi_enterprise/ui/report-scope.js` | 289 | 5 | — | чисто |
| `hapi_enterprise/ui/report-sign.js` | 198 | 7 | — | чисто |
| `hapi_enterprise/ui/report-studio.js` | 1272 | 14 | — | чисто |
| `hapi_enterprise/ui/secret-share.js` | 242 | 7 | — | чисто |
| `hapi_enterprise/ui/settings-panel.js` | 1538 | 25 | — | чисто |
| `hapi_enterprise/ui/visitors-panel.js` | 249 | 9 | swallow-promise×1 | нисък |
| `hapi_enterprise/versioning.js` | 57 | 3 | — | чисто |
| `hapi_enterprise/virtual-storage.js` | 156 | 8 | — | чисто |
| `hapi_enterprise/visitor-intel.js` | 549 | 2 | — | чисто |
| `hapi_enterprise/webhooks.js` | 336 | 5 | unused-export×2, swallow-promise×1 | нисък |
| `hapi_enterprise/workdir-crypto.js` | 116 | 1 | unused-export×1 | нисък |
| `hapi_enterprise/workdir-io.js` | 39 | 0 | — | чисто |
| `hapi_enterprise/workdir-migrate.js` | 121 | 0 | swallow-promise×3 | нисък |
| `hapi_enterprise/worm.js` | 364 | 6 | swallow-promise×1 | нисък |
| `hapi_enterprise/x509.js` | 163 | 5 | unused-export×3 | нисък |
| `scripts/api-reference.cjs` | 157 | 3 | — | чисто |
| `scripts/artifact-smoke.cjs` | 203 | 0 | — | чисто |
| `scripts/audit-events.cjs` | 128 | 3 | — | чисто |
| `scripts/audit-gui-compat.cjs` | 166 | 0 | — | чисто |
| `scripts/bad-code-scan.cjs` | 310 | 2 | — | чисто |
| `scripts/build-haoss.cjs` | 416 | 3 | — | чисто |
| `scripts/build-release.cjs` | 200 | 8 | — | чисто |
| `scripts/check-tag-version.cjs` | 64 | 2 | — | чисто |
| `scripts/decrypt-package.cjs` | 61 | 1 | — | чисто |
| `scripts/dev-dashboard.cjs` | 284 | 0 | — | чисто |
| `scripts/docs-index.cjs` | 104 | 3 | — | чисто |
| `scripts/document-empty-catches.cjs` | 81 | 0 | — | чисто |
| `scripts/error-codes.cjs` | 123 | 2 | — | чисто |
| `scripts/export-release.cjs` | 146 | 1 | — | чисто |
| `scripts/export-tracked.cjs` | 105 | 4 | — | чисто |
| `scripts/fetch-package.cjs` | 111 | 1 | — | чисто |
| `scripts/gen-test-rules.cjs` | 187 | 2 | — | чисто |
| `scripts/join-package.cjs` | 83 | 1 | — | чисто |
| `scripts/logic-audit.cjs` | 394 | 3 | — | чисто |
| `scripts/manifest-schema.cjs` | 71 | 2 | — | чисто |
| `scripts/openapi-admin.cjs` | 119 | 2 | — | чисто |
| `scripts/pre-push-audit.cjs` | 87 | 2 | — | чисто |
| `scripts/release-audit.cjs` | 209 | 0 | — | чисто |
| `scripts/release-lib.cjs` | 397 | 10 | — | чисто |
| `scripts/release-notes.cjs` | 76 | 2 | — | чисто |
| `scripts/release-status.cjs` | 213 | 3 | — | чисто |
| `scripts/resume-package.cjs` | 98 | 1 | — | чисто |
| `scripts/run-tests.cjs` | 57 | 0 | — | чисто |
| `scripts/script-audit.cjs` | 344 | 0 | — | чисто |
| `scripts/secret-patterns.cjs` | 40 | 3 | — | чисто |
| `scripts/settings-defaults.cjs` | 339 | 2 | — | чисто |
| `scripts/source-inventory.cjs` | 161 | 2 | — | чисто |
| `scripts/split-styles.cjs` | 87 | 0 | — | чисто |
| `scripts/sync-addon-changelog.cjs` | 74 | 1 | — | чисто |
| `scripts/test-matrix.cjs` | 247 | 2 | — | чисто |
| `scripts/verify-release.cjs` | 667 | 4 | — | чисто |

## Сигнали по файл

### hapi_enterprise/server.js — 44

- **low** · `sync-fs-in-request` · ред 30: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `const addonOptions = (() => { try { return JSON.parse(fs.readFileSync(process.env.OPTIONS_PATH || '/data/options.json', 'utf8')) || {} } catch { return {} } })(`
- **low** · `sync-fs-in-request` · ред 96: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `if (f.encrypted) { const plain = fileCrypto.decrypt(fs.readFileSync(filePath), adminToken); actual = crypto.createHash('sha256').update(plain).digest('hex'); st`
- **low** · `sync-fs-in-request` · ред 296: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `let buf; try { buf = fs.readFileSync(fp) } catch { release(); return fail(res, 404, 'File unavailable') }`
- **low** · `sync-fs-in-request` · ред 338: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `try { buf = fs.readFileSync(fp) } catch {`
- **low** · `sync-fs-in-request` · ред 340: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `try { buf = fs.readFileSync(mirrorFilePath(p.id, f.id)) } catch { return null }`
- **low** · `sync-fs-in-request` · ред 343: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `try { fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.copyFileSync(mirrorFilePath(p.id, f.id), fp); log.warn('file.mirror.restored', { ns: 'storage', po`
- **low** · `swallow-promise` · ред 378: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(path.join(dir, base + '.json'), { force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 379: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(path.join(dir, base + '.tsr'), { force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 430: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(target, { force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 443: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `} catch (e) { await fsp.rm(destination, { force: true }).catch(() => { }); throw e }`
- **low** · `swallow-promise` · ред 444: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `}); backupQueue = job.catch(() => { }); return job;`
- **low** · `swallow-promise` · ред 457: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `for (const f of files.slice(0, files.length - maxKeep)) await fsp.rm(path.join(backupsDir, f.name), { force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 740: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `async function writeApiDir(p, base) { try { const made = await apiRegistry.ensure(p, { baseUrl: base || '' }); await portalFolder.writeArtifacts(p, base || '', `
- **low** · `swallow-promise` · ред 1151: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `try { const st = await fsp.stat(location); return { name: path.basename(location), available: st.isDirectory(), writable: !!(await fsp.access(location, fs.const`
- **low** · `swallow-promise` · ред 1287: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `else { const bytes = await fsp.readFile(primary); if (mirror.kind === 'path') await fsp.rm(mirrorFilePath(p.id, f.id), { force: true }).catch(() => { }); const `
- **low** · `swallow-promise` · ред 1288: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const afterPrimary = await shaOf(primary).catch(() => null);`
- **low** · `swallow-promise` · ред 1330: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `result = await new Promise((resolve, reject) => { const run = queue.then(() => { try { const r = metadataStore.restoreFrom(source); sharedData.refresh(); resolv`
- **low** · `sync-fs-in-request` · ред 1448: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `const uiFile = rel => { const candidates = [path.join(__dirname, rel)]; const prefix = 'hapi_enterprise/'; if (rel.startsWith(prefix)) candidates.push(path.join`
- **low** · `sync-fs-in-request` · ред 1453: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `return res.end(fs.readFileSync(file));`
- **low** · `sync-fs-in-request` · ред 1482: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `try { manifest = JSON.parse(fs.readFileSync(path.join(root, a.relativeDirectory, 'manifest.json'), 'utf8')) } catch { /* липсващ или повреден манифест значи пра`
- **low** · `swallow-promise` · ред 1572: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `if (rec) await secretLinks.remove(root, rec.idHash).catch(() => { });`
- **low** · `swallow-promise` · ред 1595: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `if (rec) await secretLinks.remove(root, rec.idHash).catch(() => { });`
- **low** · `swallow-promise` · ред 1874: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const stat = await fsp.stat(path.join(dir, entry.name)).catch(() => null);`
- **low** · `swallow-promise` · ред 1877: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const sealedSize = stat ? await workdirIo.size(path.join(dir, entry.name)).catch(() => null) : null;`
- **low** · `swallow-promise` · ред 1917: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `if (parts.length === 3 && method === 'GET') { await packager.prune({ maxAgeHours: settings.ttlHours, maxCount: settings.maxKept }).catch(() => { }); return json`
- **low** · `swallow-promise` · ред 1960: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await packager.prune({ maxAgeHours: settings.ttlHours, maxCount: settings.maxKept }).catch(() => { });`
- **low** · `swallow-promise` · ред 2071: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await secretLinks.sweep(root, undefined, (s) => log.warn('secret.sweep.skipped', { ns: 'secret', err: s.error, hash: String(s.hash).slice(0, 12) })).catch(() =>`
- **low** · `swallow-promise` · ред 2081: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `void secretLinks.sweep(root, undefined, (s) => log.warn('secret.sweep.skipped', { ns: 'secret', err: s.error, hash: String(s.hash).slice(0, 12) })).catch(() => `
- **low** · `swallow-promise` · ред 2174: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `return json(res, 201, await update(async () => { if (getPortal(slug)) throw Object.assign(new Error('Slug exists'), { status: 409 }); const p = { id: id(), slug`
- **low** · `swallow-promise` · ред 2188: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `} catch (e) { for (const [from, to] of moved.reverse()) await fsp.rename(to, from).catch(() => { }); throw e }`
- **low** · `swallow-promise` · ред 2370: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `if (parts.length === 4 && method === 'PATCH') { const b = await parse(req); return json(res, 200, await update(async () => { if (b.title !== undefined) { if (!c`
- **low** · `swallow-promise` · ред 2446: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const base = await fsp.realpath(htmlProjectsRoot).catch(() => null); if (!base) return fail(res, 400, 'Project storage unavailable');`
- **low** · `swallow-promise` · ред 2472: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `if (parts[4] === 'files' && parts.length === 5 && method === 'POST') { const rawName = String(req.headers['x-file-name'] || ''); let decoded; try { decoded = de`
- **low** · `swallow-promise` · ред 2485: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `if (parts.length === 6 && method === 'DELETE') { const why = retention.protection(p, f); if (why) { void audit('file.delete.refused', { portalId: p.id, fileId: `
- **low** · `sync-fs-in-request` · ред 2498: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `const plain = fileCrypto.decrypt(fs.readFileSync(fp), adminToken); size = plain.length; for (const a of algos) hashes[a].update(plain);`
- **low** · `swallow-promise` · ред 2535: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `try { await fsp.writeFile(curPath, stored, { flag: 'wx', mode: 0o600 }) } catch (e) { await fsp.rename(archPath, curPath).catch(() => { }); throw e }`
- **low** · `swallow-promise` · ред 2543: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `}, async () => { await fsp.rm(curPath, { force: true }).catch(() => { }); await fsp.rename(archPath, curPath).catch(() => { }) });`
- **low** · `swallow-promise` · ред 2544: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `for (const vn of result.pruned) await fsp.rm(versioning.versionPath(filesRoot, p.id, f.id, vn), { force: true }).catch(() => { });`
- **low** · `sync-fs-in-request` · ред 2552: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `if (v.encrypted) { let buf; try { buf = fileCrypto.decrypt(fs.readFileSync(vp), adminToken) } catch { return fail(res, 500, 'Decryption failed') } res.writeHead`
- **low** · `swallow-promise` · ред 2565: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `try { await fsp.copyFile(vp, curPath) } catch (e) { await fsp.rename(archPath, curPath).catch(() => { }); throw e }`
- **low** · `swallow-promise` · ред 2570: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `}, async () => { await fsp.rm(curPath, { force: true }).catch(() => { }); await fsp.rename(archPath, curPath).catch(() => { }) });`
- **low** · `sync-fs-in-request` · ред 2617: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `let init = {}; try { init = JSON.parse(fs.readFileSync(process.env.OPTIONS_PATH || '/data/options.json', 'utf8')) } catch { /* липсващи опции значат празен обек`
- **low** · `swallow-promise` · ред 2701: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `if (foldersNormalized) { await update(() => { }); log.info('portal.folders.normalized', { ns: 'portal', portals: foldersNormalized }) } applyBackupSchedule(); w`
- **low** · `swallow-promise` · ред 2719: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const shutdown = signal => { if (shuttingDown) return; shuttingDown = true; log.info('shutdown', { ns: 'server', signal }); webhooks.stop(); eventStream.closeAl`

### hapi_enterprise/routes/portal-archive.js — 11

- **low** · `swallow-promise` · ред 132: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(dir, { recursive: true, force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 136: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(path.join(apiRoot, portal.slug), { recursive: true, force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 137: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await portalFolder.removeArtifacts(portal).catch(() => { });`
- **low** · `swallow-promise` · ред 138: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `if (mirrorPortalDir) await fsp.rm(mirrorPortalDir(portal.id), { recursive: true, force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 163: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(dir, { recursive: true, force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 166: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await portalFolder.ensure(record).catch(() => { });`
- **low** · `swallow-promise` · ред 181: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(archiveDir(entry.id), { recursive: true, force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 238: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await portalFolder.removeArtifacts(portal).catch(() => { });`
- **low** · `swallow-promise` · ред 239: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `if (mirrorPortalDir) await fsp.rm(mirrorPortalDir(portal.id), { recursive: true, force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 243: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(path.join(archiveRoot, portal.id), { recursive: true, force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 283: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const timer = setInterval(() => { purgeDue().catch(() => { }); }, PURGE_EVERY_MS);`

### hapi_enterprise/ui/files-manager.js — 9

- **low** · `swallow-promise` · ред 1067: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await loadMonitor().catch(() => { });`
- **low** · `swallow-promise` · ред 3307: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `void loadMonitor().catch(() => { }).then(render);`
- **low** · `swallow-promise` · ред 4008: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `.catch(() => { })`
- **low** · `swallow-promise` · ред 4010: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `.catch(() => { })`
- **low** · `swallow-promise` · ред 4012: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `.catch(() => { })`
- **low** · `swallow-promise` · ред 4014: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `.catch(() => { })`
- **low** · `swallow-promise` · ред 4016: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `.catch(() => { })`
- **low** · `swallow-promise` · ред 4018: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `.catch(() => { })`
- **low** · `swallow-promise` · ред 4020: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `.catch(() => { })`

### hapi_enterprise/routes/file-transfer.js — 8

- **low** · `swallow-promise` · ред 122: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(dstAbs, { force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 135: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(dstAbs, { force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 146: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `: await portalFolder.store(dst, created.name, bytes).catch(() => null);`
- **low** · `swallow-promise` · ред 151: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(srcAbs, { force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 152: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await removeMirrored(p.id, src.id).catch(() => { });`
- **low** · `swallow-promise` · ред 153: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `if (src.storagePath) await portalFolder.remove(p, src.storagePath).catch(() => { });`
- **low** · `swallow-promise` · ред 156: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await writeApiDir(dst, baseUrl(req)).catch(() => { });`
- **low** · `swallow-promise` · ред 157: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `if (mode === 'move') await writeApiDir(p, baseUrl(req)).catch(() => { });`

### hapi_enterprise/secret-links.js — 8

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `HASH_LENGTH`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `DEFAULT_VIEWS`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `MAX_HINT_LENGTH`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `MIN_PBKDF2_ITERATIONS`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `MAX_PBKDF2_ITERATIONS`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `newReceipt`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `isValidIv`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `normalizeHint`

### hapi_enterprise/gateway-api.js — 7

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `BUNDLED_DIR`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `defaultSeedDir`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `fileModeFor`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `overrideFor`
- **low** · `sync-fs-in-request` · ред 79: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));`
- **low** · `sync-fs-in-request` · ред 100: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `options = JSON.parse(fs.readFileSync(process.env.OPTIONS_PATH || '/data/options.json', 'utf8')) || {};`
- **low** · `sync-fs-in-request` · ред 187: синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти
  `fs.mkdirSync(dir, { recursive: true, mode: 0o700 });`

### hapi_enterprise/mirror-target.js — 6

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `signV4`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `keyFor`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `uriEncode`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `pathTarget`
- **low** · `swallow-promise` · ред 147: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(target, { force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 160: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(fileFor(portalId, fileId), { force: true }).catch(() => { });`

### hapi_enterprise/export-manager.js — 5

- **low** · `swallow-promise` · ред 317: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.unlink(tmp).catch(() => {});`
- **low** · `swallow-promise` · ред 321: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.unlink(tmp).catch(() => {});`
- **low** · `swallow-promise` · ред 325: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.unlink(tmp).catch(() => {});`
- **low** · `swallow-promise` · ред 330: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `if (opt.readOnly) await fsp.chmod(target.target, 0o444).catch(() => {});`
- **low** · `swallow-promise` · ред 342: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.unlink(tmp).catch(() => {});`

### hapi_enterprise/portal-folder.js — 5

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `GENERATED`
- **low** · `swallow-promise` · ред 129: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const stat = await fsp.stat(path.join(dir, entry.name)).catch(() => null);`
- **low** · `swallow-promise` · ред 282: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(tmp, { force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 289: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const stat = await fsp.stat(folderPath(portal && portal.storage_root)).catch(() => null);`
- **low** · `swallow-promise` · ред 313: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const stat = await fsp.stat(dir).catch(() => null);`

### hapi_enterprise/storage-preflight.js — 5

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `hasData`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `DEFAULT_LOCATION`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `DEFAULT_SUB`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `LEGACY_LOCATION`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `LEGACY_SUB`

### hapi_enterprise/exif.js — 4

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `parseTiff`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `parseJpeg`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `NAMED_TAGS`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `GPS_TAGS`

### hapi_enterprise/idempotency.js — 4

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `MIN_KEY`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `MAX_KEY`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `TTL_MS`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `MAX_STORED_BODY`

### hapi_enterprise/instance-lock.js — 4

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `pruneShared`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `peersDir`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `PEERS_DIR`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `DEFAULT_STALE_MS`

### hapi_enterprise/portal-policy.js — 4

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `readSessionToken`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `clearCookie`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `COOKIE_SECURE`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `COOKIE_PLAIN`

### hapi_enterprise/report-stamp.js — 4

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `BINDING`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `TOKEN_FORMAT`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `startFields`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `stopFields`

### hapi_enterprise/standalone.js — 4

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `hasSqlite`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `resolveRuntime`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `resolveDataDir`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `tokenPath`

### hapi_enterprise/tsa-client.js — 4

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `ALGORITHMS`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `STATUS_TEXT`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `parseTstInfo`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `stampOne`

### hapi_enterprise/api-registry.js — 3

- **low** · `swallow-promise` · ред 42: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(tmp, { force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 75: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const next = previous.catch(() => { }).then(task);`
- **low** · `swallow-promise` · ред 76: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const guarded = next.catch(() => { });`

### hapi_enterprise/event-stream.js — 3

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `HEARTBEAT_MS`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `MAX_LIFETIME_MS`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `RING_SIZE`

### hapi_enterprise/portal-integrity.js — 3

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `DEFAULT_INTERVAL_MS`
- **low** · `swallow-promise` · ред 64: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const buf = await fsp.readFile(full).catch(() => null);`
- **low** · `swallow-promise` · ред 161: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const timer = setInterval(() => { void Promise.resolve().then(run).catch(() => { }) }, ms);`

### hapi_enterprise/portal-qr.js — 3

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `DEPTH_CODE`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `depthOf`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `manifestFor`

### hapi_enterprise/preview.js — 3

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `mdToHtml`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `xlsxToHtml`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `pptxToHtml`

### hapi_enterprise/report-render.js — 3

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `certificateRows`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `dynamicRows`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `imageBytes`

### hapi_enterprise/throttle.js — 3

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `pacedByBudget`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `MIN_KBPS`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `MAX_KBPS`

### hapi_enterprise/webhooks.js — 3

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `EVENT_HEADER`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `DELIVERY_HEADER`
- **low** · `swallow-promise` · ред 192: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `if (res && typeof res.body !== 'undefined' && res.body && typeof res.body.cancel === 'function') await res.body.cancel().catch(() => { });`

### hapi_enterprise/workdir-migrate.js — 3

- **low** · `swallow-promise` · ред 45: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const stat = await fsp.stat(full).catch(() => null);`
- **low** · `swallow-promise` · ред 83: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const raw = await fsp.readFile(file.full).catch(() => null);`
- **low** · `swallow-promise` · ред 109: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(file.full + '.hapi-tmp', { force: true }).catch(() => { });`

### hapi_enterprise/x509.js — 3

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `toPem`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `utcTime`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `ALG_SHA256_RSA`

### hapi_enterprise/directory.js — 2

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `ORG_KINDS`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `sanitizeAddresses`

### hapi_enterprise/evidence-portal/assets/app.js — 2

- **low** · `swallow-promise` · ред 37: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const r = await fetch(`/api/evidence/${encodeURIComponent(id)}/manifest`, { credentials: 'include', cache: 'no-store' }).catch(() => null);`
- **low** · `swallow-promise` · ред 41: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const demo = await fetch('./data/demo-evidence.json', { cache: 'no-store' }).catch(() => null);`

### hapi_enterprise/observer.js — 2

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `normalizePath`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `statusClass`

### hapi_enterprise/pgp.js — 2

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `rolesOfKeyFlags`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `ALGO`

### hapi_enterprise/portal/portal.js — 2

- **low** · `swallow-promise` · ред 725: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const data = await res.json().catch(() => null);`
- **low** · `swallow-promise` · ред 988: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const data = await res.json().catch(() => null);`

### hapi_enterprise/routes/folders.js — 2

- **low** · `swallow-promise` · ред 175: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(path.join(filesRoot, p.id, f.id), { force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 176: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(path.join(internalRoot, p.id, f.id), { recursive: true, force: true }).catch(() => { });`

### hapi_enterprise/routes/portal-qr.js — 2

- **low** · `swallow-promise` · ред 77: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fsp.rm(full, { force: true }).catch(() => { });`
- **low** · `swallow-promise` · ред 234: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const data = await fsp.readFile(path.join(archiveRoot, p.id, archive.file)).catch(() => null);`

### hapi_enterprise/shared-data.js — 2

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `DEFAULT_LOCK_TIMEOUT_MS`
- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `DEFAULT_STALE_LOCK_MS`

### custom_components/hapi_enterprise/portal.js — 1

- **low** · `swallow-promise` · ред 448: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const data = await res.json().catch(() => null);`

### hapi_enterprise/api-version.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `SUNSET`

### hapi_enterprise/audit-chain.js — 1

- **low** · `swallow-promise` · ред 22: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `function append(event, details = {}) { const task = queue.then(async () => { await init(); const e = { seq: ++sequence, at: new Date().toISOString(), event, det`

### hapi_enterprise/case-access.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `isCourtRole`

### hapi_enterprise/cms-sign.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `signedAttributes`

### hapi_enterprise/config-profiles.js — 1

- **low** · `swallow-promise` · ред 14: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `try{const h=await fsp.open(tmp,'wx',0o600);try{await h.writeFile(JSON.stringify(profiles,null,2));await h.sync()}finally{await h.close()}await fsp.rename(tmp,fi`

### hapi_enterprise/download-stream.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `rateSpec`

### hapi_enterprise/error-log.js — 1

- **low** · `swallow-promise` · ред 19: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `}).catch(()=>{});`

### hapi_enterprise/evidence-portal.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `SUBPATH`

### hapi_enterprise/forensic.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `sniff`

### hapi_enterprise/generator.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `NAME_RE`

### hapi_enterprise/job-manager.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `PauseRequestedError`

### hapi_enterprise/logger.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `NAMES`

### hapi_enterprise/oidc.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `FLOW_TTL_MS`

### hapi_enterprise/packager.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `MAX_TOTAL_BYTES`

### hapi_enterprise/path-crypto.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `KEY_ERRORS`

### hapi_enterprise/plugins/storage.js — 1

- **low** · `swallow-promise` · ред 20: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `exists:async rel=>fsp.stat(safe(base,rel)).then(()=>true).catch(()=>false),`

### hapi_enterprise/portal-access.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `TTL_SECONDS`

### hapi_enterprise/public-package.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `MAX_TOKENS`

### hapi_enterprise/registry.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `FIELD_KEY`

### hapi_enterprise/report-package.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `FORMAT`

### hapi_enterprise/routes/link-check.js — 1

- **low** · `swallow-promise` · ред 107: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `if (res.body && typeof res.body.cancel === 'function') await res.body.cancel().catch(() => { });`

### hapi_enterprise/routes/portal-storage.js — 1

- **low** · `swallow-promise` · ред 340: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const data = await fsp.readFile(path.join(archiveRoot, portal.id, archive.file)).catch(() => null);`

### hapi_enterprise/runtime-config.js — 1

- **low** · `swallow-promise` · ред 139: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `async function atomic(file, data) { const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp'; await fsp.mkdir(path.dirname(file), { recursive: tr`

### hapi_enterprise/send.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `TICKET_TTL_MS`

### hapi_enterprise/site-csp.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `SANDBOX`

### hapi_enterprise/ui/dashboard-panel.js — 1

- **low** · `swallow-promise` · ред 20: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const data = await res.json().catch(() => null);`

### hapi_enterprise/ui/visitors-panel.js — 1

- **low** · `swallow-promise` · ред 24: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `const data = await res.json().catch(() => null);`

### hapi_enterprise/workdir-crypto.js — 1

- **low** · `unused-export` · ред 1: експорт без външен клиент (ползва се само в модула) — разширява публичния договор
  `CHUNK`

### hapi_enterprise/worm.js — 1

- **low** · `swallow-promise` · ред 191: обещание, чиято грешка се хвърля на пода — при отказ никой не разбира
  `await fs.rm(staging, { force: true }).catch(() => undefined);`

