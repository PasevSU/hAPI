'use strict';
// PG-6: backend прилагане — мапинг на legacy модела, решения за достъп, експорт API.
const assert = require('node:assert/strict');
const api = require('../hapi_enterprise/gateway-api.js');
const ACC = require('../hapi_enterprise/download-access.js');

const cfg = api.config();
assert.equal(cfg.gateway.public.published, false, 'публичният порт не е публикуван по подразбиране');
assert.equal(cfg.gateway.public.port, 8088);
assert.equal(cfg.rules.overwrite, false);
assert.equal(cfg.rules.evidence.overwrite, 'forbidden');
assert.equal(cfg.profiles.profiles.length, 12);
assert.equal(cfg.permissions.permissions.length, 8);
assert.equal(api.config(), cfg, 'конфигурацията се кешира');

// 1. Legacy → gateway: видимост и режим.
const publicPortal = { id: 'p1', slug: 'public-notices', title: 'Public notices', visibility: 'public', files: [] };
const vault = { id: 'p2', slug: 'chronoseal-vault', title: 'Chronoseal', visibility: 'private' };
assert.equal(api.portalMode(publicPortal), 'FREE');
assert.equal(api.portalMode(vault), 'KEY_REQUIRED');
assert.equal(api.portalMode({ visibility: 'public', accessMode: 'DISABLED' }), 'DISABLED');
assert.equal(api.portalView(vault, cfg).visibility, 'hidden');
assert.equal(api.portalView(publicPortal, cfg).visibility, 'public');
assert.equal(api.portalView({ ...vault, status: 'paused' }, cfg).status, 'paused');

// 2. Файлови политики: legacy accessMode, конфигурационен override, скрит файл.
const freeFile = { id: 'f1', name: 'Public_Report.pdf', size: 10, listed: true };
assert.equal(api.fileView(publicPortal, freeFile, cfg).access, 'FREE');
assert.equal(api.fileView(publicPortal, { ...freeFile, accessMode: 'DISABLED' }, cfg).access, 'DISABLED');
const auditFile = { id: 'f2', name: 'Internal_Audit.json', listed: true };
const auditView = api.fileView(vault, auditFile, cfg);
assert.equal(auditView.access, 'PRIVATE', 'override от file_permissions.json');
assert.deepEqual(auditView.roles, ['admin']);
assert.equal(auditView.visibility, 'hidden');
assert.equal(api.fileView(vault, { id: 'f3', name: 'Revoked_File.pdf' }, cfg).access, 'DISABLED');
assert.equal(api.fileView(publicPortal, { id: 'f4', name: 'x.pdf', listed: false }, cfg).visibility, 'hidden');

// 3. Адреси. Публичната страница се адресира с ID на портала (там води QR кодът),
// JSON API-то — по slug (четим ключ за клиентите).
const urls = api.urlsFor(api.portalView(publicPortal, cfg), cfg);
assert.equal(urls.landing, 'https://portal.example.com/p/p1/');
assert.equal(urls.portal, 'https://portal.example.com/api/public/v1/portals/public-notices');
assert.equal(urls.files, 'https://portal.example.com/api/public/v1/portals/public-notices/files');
assert.equal(
  api.downloadUrlFor(api.fileView(publicPortal, freeFile, cfg), cfg),
  'https://portal.example.com/api/public/v1/files/f1/download',
);

// 4. Решения: публичен файл се изтегля без ключ и без HA сесия.
const open = api.decideFile({ portal: publicPortal, file: freeFile });
assert.equal(open.allowed, true, JSON.stringify(open.checks));
assert.equal(open.mode, 'FREE');
assert.equal(open.behaviour.listed, true);
assert.ok(open.checks.length >= 8);

// 5. DISABLED не се изтегля дори с ключ.
const disabled = api.decideFile({ portal: publicPortal, file: { id: 'f5', name: 'Revoked_File.pdf', accessMode: 'DISABLED' } });
assert.equal(disabled.allowed, false);
assert.equal(disabled.reason, 'mode-enabled');

// 6. KEY_REQUIRED: без ключ → отказ; с приет ключ → достъп.
const keyedPortal = { ...publicPortal, slug: 'keyed-portal', visibility: 'private' };
const keyedFile = { id: 'f6', name: 'Evidence_Package.zip', listed: true };
assert.equal(api.decideFile({ portal: keyedPortal, file: keyedFile }).reason, 'token-active');
assert.equal(api.decideFile({ portal: keyedPortal, file: keyedFile, key: 'hapi_' + 'a'.repeat(24), keyOk: false }).reason, 'token-active');
const withKey = api.decideFile({ portal: keyedPortal, file: keyedFile, key: 'hapi_' + 'a'.repeat(24), keyOk: true });
assert.equal(withKey.allowed, true, JSON.stringify(withKey.checks));

// 7. HA JWT не е публичен ключ.
const ha = api.decideFile({
  portal: keyedPortal,
  file: keyedFile,
  key: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln',
  keyOk: false,
});
assert.equal(ha.allowed, false);
assert.equal(ha.reason, 'token-scheme');

// 8. PRIVATE: нужен е потребител с роля.
assert.equal(api.decideFile({ portal: vault, file: auditFile }).reason, 'authenticated');
const withAdmin = api.decideFile({
  portal: vault,
  file: auditFile,
  user: { id: 'u1', roles: ['admin'], permissions: ['files.read', 'files.download'] },
});
assert.equal(withAdmin.allowed, true, JSON.stringify(withAdmin.checks));
const withViewer = api.decideFile({
  portal: vault,
  file: auditFile,
  user: { id: 'u2', roles: ['viewer'], permissions: ['files.read', 'files.download'] },
});
assert.equal(withViewer.reason, 'role');

// 9. Глобална забрана печели винаги.
assert.equal(api.decideFile({ portal: publicPortal, file: freeFile, allowDownloads: false }).reason, 'system-allow');

// 10. Права: анонимен посетител не получава export права.
assert.equal(api.decideFile({ portal: publicPortal, file: freeFile, permission: 'evidence.export' }).reason, 'permission');

// 11. Административни отговори.
const payload = api.exportRulesPayload();
assert.equal(payload.export_profiles.profiles.length, 12);
assert.equal(payload.capabilities.length, 6);
assert.ok(payload.capabilities.every((c) => c.implemented === false));
assert.deepEqual(payload.access.levels, ACC.LEVELS);
assert.equal(payload.public_gateway.public.port, 8088);

const pre = api.exportPreflight({
  config: { mode: 'evidence', verifySha256: false, files: ['protokol.pdf'] },
  env: { freeBytes: 1024 * 1024 },
});
assert.equal(pre.ok, true, JSON.stringify(pre.validation.errors));
assert.equal(pre.config.verifySha256, true, 'доказателствен режим форсира SHA-256');
assert.ok(pre.entries.some((e) => e.path === 'PACKAGE_INDEX.json'));
assert.ok(pre.entries.some((e) => e.path === 'originals/protokol.pdf'));
assert.equal(pre.summary, 'Избрани категории: 7 · Формат: ZIP · SHA-256: Включена · Цел: FOLDER');
assert.match(pre.packageId, /^RPT-\d{8}-\d{6}-[A-Z0-9]{1,24}$/);

const invalid = api.exportPreflight({ config: { mode: 'evidence', format: 'json' } });
assert.equal(invalid.ok, false, 'доказателствен пакет не може да е единичен JSON');
assert.ok(invalid.validation.errors.some((e) => e.code === 'format-evidence'));

const abort = api.exportPreflight({
  config: { mode: 'verified', onConflict: 'abort' },
  env: { freeBytes: 1024, exists: ['originals/a.txt'] },
});
assert.equal(abort.ok, false);

console.log('gateway-api OK');
