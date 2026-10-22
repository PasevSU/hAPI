'use strict';
// Сценарий: пълен жизнен цикъл на една инсталация, от старт до рестарт.
//
//   старт → /ready → admin по подразбиране → потребител със скоуп → портал →
//   качване на файлове → цялост → одит верига → публичен API → пакет (zip) →
//   QR/api-info → метрики → експорт на правила → retention → backup →
//   storage check → рестарт и проверка, че нищо не е изгубено.
//
// Това е „дишащият“ тест: ако една стъпка от веригата се счупи, продуктът не
// изпълнява обещанието си, дори когато отделните модули имат зелени юнит тестове.
const { stopChild, freePort, waitHealthy } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ADMIN = 'lifecycle-admin-token-0123456789abcdef';
const PASSWORD = 'lifecycle-password-123';

const FILES = [
  { name: 'evidence-A.txt', body: 'първи документ — одитен отпечатък A' },
  { name: 'evidence-B.txt', body: 'втори документ — одитен отпечатък B' },
];

async function boot(dir, port) {
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      OPTIONS_PATH: path.join(dir, 'missing-options.json'),
      PORT: String(port),
      ADMIN_TOKEN: ADMIN,
      ENCRYPT_FILES: 'true',
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (route, { method = 'GET', bearer, body, raw, headers = {} } = {}) => {
    const res = await fetch(base + route, {
      method,
      headers: {
        ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : raw,
    });
    const type = res.headers.get('content-type') || '';
    const isJson = type.includes('application/json');
    return {
      status: res.status,
      type,
      headers: res.headers,
      value: isJson ? await res.json() : null,
      buffer: isJson ? null : Buffer.from(await res.arrayBuffer()),
    };
  };
  await waitHealthy(child, base, { attempts: 140 });
  return { child, call };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-lifecycle-'));
  const port = await freePort();
  let server = await boot(dir, port);
  let portalId = '';
  let fileIds = [];
  let packageId = '';
  let backupName = '';

  try {
    const { call } = server;
    const admin = (route, opts = {}) => call(route, { ...opts, bearer: ADMIN });

    // 1. Старт: liveness и readiness (storage + база).
    const health = await call('/health');
    assert.equal(health.status, 200);
    assert.equal(health.value.status, 'ok');
    const readyProbe = await call('/ready');
    assert.equal(readyProbe.status, 200, JSON.stringify(readyProbe.value));
    assert.equal(readyProbe.value.ready, true);
    assert.equal(readyProbe.value.checks.storage, true);
    assert.equal(readyProbe.value.checks.db, true);

    // 2. Роля по подразбиране без никаква карта.
    const who = await admin('/admin/api/whoami');
    assert.equal(who.value.role, 'admin');
    assert.equal(who.value.defaultRole, 'admin');
    assert.equal(who.value.mapped, false);

    // 3. Потребител с скоуп 'read' + вход с парола.
    const user = await admin('/admin/api/users', {
      method: 'POST',
      body: { username: 'auditor', password: PASSWORD, scopes: ['read'] },
    });
    assert.equal(user.status, 201, JSON.stringify(user.value));
    const login = await call('/api/v1/auth/login', {
      method: 'POST',
      body: { username: 'auditor', password: PASSWORD },
    });
    assert.equal(login.status, 200);
    const userToken = login.value.token;
    assert.ok(userToken && userToken.length >= 24, 'входът трябва да върне токен');

    // 4. Портал + брандиране + видимост.
    const createdPortal = await admin('/admin/api/portals', {
      method: 'POST',
      body: { slug: 'lifecycle', title: 'Lifecycle', visibility: 'public' },
    });
    assert.equal(createdPortal.status, 201, JSON.stringify(createdPortal.value));
    portalId = createdPortal.value.id;
    const branded = await admin(`/admin/api/portals/${portalId}`, {
      method: 'PATCH',
      body: { branding: { accentColor: '#0f766e' } },
    });
    assert.equal(branded.status, 200);
    assert.equal(branded.value.branding.accentColor, '#0f766e');

    // 5. Качване на два файла (сурово тяло + X-File-Name).
    for (const file of FILES) {
      const up = await admin(`/admin/api/portals/${portalId}/files`, {
        method: 'POST',
        raw: file.body,
        headers: { 'X-File-Name': file.name },
      });
      assert.equal(up.status, 201, JSON.stringify(up.value));
      assert.equal(up.value.name, file.name);
    }
    const detail = await admin(`/admin/api/portals/${portalId}`);
    assert.equal(detail.value.files.length, 2, 'порталът трябва да има два файла');
    fileIds = detail.value.files.map((f) => f.id);

    // 6. Цялост: и двата файла са VERIFIED.
    const integrity = await admin(`/admin/api/portals/${portalId}/integrity`);
    assert.equal(integrity.status, 200);
    assert.equal(integrity.value.verified, true, JSON.stringify(integrity.value));
    assert.equal(integrity.value.files.filter((f) => f.status === 'VERIFIED').length, 2);

    // 7. Одит: веригата е валидна и съдържа събитията от веригата.
    const verify = await admin('/admin/api/audit/verify');
    assert.equal(verify.status, 200, JSON.stringify(verify.value));
    assert.equal(verify.value.valid, true);
    const audit = await admin('/admin/api/audit?limit=100');
    assert.equal(audit.status, 200);
    const kinds = audit.value.events.map((e) => String(e.event || e.kind || e.type || ''));
    assert.ok(audit.value.events.length >= 3, 'очаквам поне 3 одитни събития');
    assert.ok(kinds.some((k) => /portal/i.test(k)), `очаквам събитие за портал: ${kinds.join(',')}`);
    assert.ok(kinds.some((k) => /file|upload/i.test(k)), `очаквам събитие за файл: ${kinds.join(',')}`);

    // 8. Публичен API със скоуп 'read': списък + изтегляне на файл.
    const listing = await call('/api/v1/p/lifecycle/files', { bearer: userToken });
    assert.equal(listing.status, 200);
    assert.equal(listing.value.files.length, 2);
    const download = await call(`/api/v1/p/lifecycle/files/${fileIds[0]}/download`, {
      bearer: userToken,
    });
    assert.equal(download.status, 200);
    assert.equal(download.buffer.toString('utf8'), FILES[0].body, 'съдържанието трябва да съвпада');

    // 9. Пакет (zip) с двата файла, подписан по подразбиране не е задължителен.
    const pkg = await admin('/admin/api/packages', { method: 'POST', body: { portalId } });
    assert.equal(pkg.status, 201, JSON.stringify(pkg.value));
    packageId = pkg.value.id;
    assert.equal(pkg.value.files, 2, 'пакетът трябва да съдържа два файла');
    assert.match(pkg.value.sha256, /^[a-f0-9]{64}$/, 'пакетът трябва да има SHA-256');
    const zip = await admin(`/admin/api/packages/${packageId}/download`);
    assert.equal(zip.status, 200);
    assert.equal(zip.buffer.subarray(0, 2).toString('latin1'), 'PK', 'артефактът трябва да е zip');

    // 10. QR и адреси за портала (без вътрешен адрес в QR).
    const apiInfo = await admin(`/admin/api/portals/${portalId}/api-info`);
    assert.equal(apiInfo.status, 200);
    assert.match(apiInfo.value.apiUrl, /\/api\/v1\/p\/lifecycle$/, 'apiUrl трябва да сочи портала');
    assert.match(apiInfo.value.qr, /<svg/, 'QR трябва да е SVG');
    assert.equal(apiInfo.value.qrTarget, apiInfo.value.landingUrl);

    // 11. Метрики и диагностика отчитат реалния трафик.
    const metrics = await admin('/admin/api/metrics');
    assert.equal(metrics.status, 200);
    assert.ok(metrics.value.requests > 0);
    assert.equal(metrics.value.portals, 1);
    const diagnostics = await admin('/admin/api/diagnostics');
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.value.catalog.portals, 1);
    assert.equal(diagnostics.value.catalog.files, 2);

    // 12. Правила и връзка (четат се и от GUI-я).
    const rules = await admin('/admin/api/rules');
    assert.equal(rules.status, 200);
    assert.ok(rules.value.files && Object.keys(rules.value.files).length > 0);
    const connection = await admin('/admin/api/connection');
    assert.equal(connection.status, 200);
    assert.equal(connection.value.role, 'admin');
    assert.ok(connection.value.apiVersion);

    // 13. Експорт на правила (договор за публичния gateway).
    const exported = await admin('/admin/api/v2/export/rules');
    assert.equal(exported.status, 200);
    assert.ok(exported.value.schema_version, 'експортът носи schema_version');

    // 14. Retention: dry-run преглед, после прилагане (нищо не е за изтриване).
    const preview = await admin('/admin/api/retention');
    assert.equal(preview.status, 200);
    assert.equal(typeof preview.value, 'object');
    const applied = await admin('/admin/api/retention', { method: 'POST' });
    assert.equal(applied.status, 200, JSON.stringify(applied.value));

    // 15. Backup на базата + списък с архивите.
    const backup = await admin('/admin/api/database/backup', { method: 'POST' });
    assert.equal(backup.status, 201, JSON.stringify(backup.value));
    backupName = backup.value.backup.name;
    assert.ok(backup.value.backup.bytes > 0);
    assert.match(backup.value.backup.sha256, /^[a-f0-9]{64}$/);
    const backups = await admin('/admin/api/database/backups');
    assert.ok(
      backups.value.backups.some((b) => b.name === backupName),
      'новият backup трябва да е в списъка',
    );

    // 16. Проверка на хранилището (ръчна, същият код като при старт).
    const storage = await admin('/admin/api/storage/check', { method: 'POST' });
    assert.equal(storage.status, 200);
    assert.equal(storage.value.healthy, true, JSON.stringify(storage.value));
    assert.ok(storage.value.locations.length >= 3, 'проверката покрива всички локации');
    assert.ok(
      storage.value.locations.every((l) => l.available && l.writable),
      'всички локации трябва да са достъпни и записваеми',
    );

    // 17. Рестарт: същите данни, същите хешове, същата одит верига.
    await stopChild(server.child);
    server = await boot(dir, port + 500);
    const second = server.call;
    const afterRestart = await second(`/admin/api/portals/${portalId}`, { bearer: ADMIN });
    assert.equal(afterRestart.status, 200, 'порталът трябва да оцелее след рестарт');
    assert.equal(afterRestart.value.files.length, 2);
    assert.equal(afterRestart.value.branding.accentColor, '#0f766e', 'брандирането се пази');
    const integrityAfter = await second(`/admin/api/portals/${portalId}/integrity`, { bearer: ADMIN });
    assert.equal(integrityAfter.value.verified, true, 'файловете остават валидни след рестарт');
    const auditAfter = await second('/admin/api/audit/verify', { bearer: ADMIN });
    assert.equal(auditAfter.value.valid, true, 'одит веригата остава валидна след рестарт');
    const readyAfter = await second('/ready');
    assert.equal(readyAfter.value.ready, true);

    console.log(
      'PASS enterprise lifecycle: старт→ready→admin→портал→файлове→цялост→одит→' +
      'публичен API→пакет→QR→метрики→правила→експорт→retention→backup→storage→рестарт',
    );
  } finally {
    await stopChild(server.child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
