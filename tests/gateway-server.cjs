'use strict';
// PG-6 / FD-6: реален сървър — административни правила и публичен gateway канал.
const { stopChild, freePort } = require('./helpers.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-gateway-'));
  const port = await freePort();
  const gwPort = await freePort();
  const token = 'gateway-test-admin-token-1234567890';
  const base = `http://127.0.0.1:${port}`;
  const gwBase = `http://127.0.0.1:${gwPort}`;
  let child;

  const req = async (route, method = 'GET', data, headers = {}) => {
    const r = await fetch(base + route, { method, headers, ...(data === undefined ? {} : { body: data }) });
    let value = null;
    try {
      value = await r.json();
    } catch {
      value = null;
    }
    return { status: r.status, value, text: null };
  };
  const admin = (route, method, data) =>
    req(route, method, data === undefined ? undefined : JSON.stringify(data), {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    });
  const download = (fileId, headers = {}) => fetch(`${base}/api/public/v1/files/${fileId}/download`, { headers });

  const boot = async () => {
    child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
      env: {
        ...process.env,
        DATA_DIR: dir,
        PORT: String(port),
        ADMIN_TOKEN: token,
        PUBLIC_GATEWAY_PORT: String(gwPort),
        PUBLIC_GATEWAY: '1',
        PUBLIC_DOMAIN: 'gateway.test',
        PUBLIC_GATEWAY_BIND: '127.0.0.1',
      },
      stdio: 'ignore',
    });
    for (let i = 0; i < 100; i++) {
      try {
        const [main, gw] = await Promise.all([req('/health'), fetch(gwBase + '/api/public/v1/portals/nope')]);
        if (main.status === 200 && gw.status === 404) return;
      } catch { }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error('Startup failed');
  };

  try {
    await boot();

    // 1. Правилата са само за административния канал.
    assert.equal((await req('/admin/api/v2/export/rules')).status, 401);
    const rules = await admin('/admin/api/v2/export/rules');
    assert.equal(rules.status, 200);
    assert.equal(rules.value.export_profiles.profiles.length, 12);
    assert.equal(rules.value.download_rules.evidence.overwrite, 'forbidden');
    assert.equal(rules.value.public_gateway.public.port, 8088);
    assert.equal(rules.value.public_gateway.public.published, true, 'PUBLIC_GATEWAY=1 публикува порта');
    assert.equal(rules.value.public_gateway.public.domain, 'gateway.test', 'PUBLIC_DOMAIN се прилага');
    assert.deepEqual(rules.value.capabilities.filter((c) => c.implemented).map((c) => c.id), ['compression'], 'само компресията е готова');
    assert.ok(rules.value.capabilities.filter((c) => c.id !== 'compression').every((c) => c.implemented === false));

    // 2. Preflight изчислява пакета и форсира SHA-256 за доказателствен режим.
    const pre = await admin('/admin/api/v2/export/preflight', 'POST', {
      config: { mode: 'evidence', verifySha256: false, files: ['a.pdf'] },
      env: { freeBytes: 1048576 },
    });
    assert.equal(pre.status, 200);
    assert.equal(pre.value.ok, true, JSON.stringify(pre.value.validation.errors));
    assert.equal(pre.value.config.verifySha256, true);
    assert.ok(pre.value.entries.some((e) => e.path === 'PACKAGE_INDEX.json'));
    assert.match(pre.value.packageId, /^RPT-\d{8}-\d{6}-[A-Z0-9]{1,24}$/);

    // 3. Портал + файл.
    const created = await admin('/admin/api/portals', 'POST', {
      slug: 'gw-test',
      title: 'GW Test',
      category: 'Правни дела',
      subject: 'посещение на лице',
      flag: 'urgent',
      storage_root: '/share/portal-files/gw-test',
    });
    assert.equal(created.status, 201);
    const portalId = created.value.id;
    assert.equal(created.value.category, 'Правни дела');
    assert.equal(created.value.subject, 'посещение на лице');
    assert.equal(created.value.flag, 'urgent');
    assert.equal(created.value.storage_root, '/share/portal-files/gw-test');
    // Папката с файлове е ограничена до /share и /media.
    assert.equal(
      (await admin('/admin/api/portals', 'POST', { slug: 'bad-root', title: 'Bad', storage_root: '/etc/passwd' })).status,
      400,
    );
    assert.equal(
      (await admin('/admin/api/portals', 'POST', { slug: 'bad-root2', title: 'Bad', storage_root: '/share/../etc' })).status,
      400,
    );
    // Контакт: нов (POST /directory/contacts) или съществуващ, свързан към портала.
    const contact = await admin('/admin/api/directory/contacts', 'POST', {
      email: 'ivan.petrov@example.bg',
      fields: { name: 'Иван Петров', phone: '+359 89 765 4321', organization: 'Петров ЕООД' },
    });
    assert.equal(contact.status, 201);
    assert.equal(contact.value.fields.name, 'Иван Петров');
    assert.equal(
      (await admin('/admin/api/directory/contacts', 'POST', { email: 'ivan.petrov@example.bg' })).status,
      409,
    );
    assert.equal((await admin('/admin/api/directory/contacts', 'POST', { email: 'not-an-email' })).status, 400);
    const linked = await admin('/admin/api/portals/' + portalId, 'PATCH', { contactId: contact.value.id });
    assert.equal(linked.status, 200);
    assert.equal(linked.value.contactId, contact.value.id);
    assert.equal(linked.value.contact.name, 'Иван Петров');
    assert.equal(linked.value.contact.phone, '+359 89 765 4321');
    assert.equal((await admin('/admin/api/portals/' + portalId, 'PATCH', { contactId: 'no-such-contact' })).status, 400);
    // Полета по желание към контакта.
    const cExtra = await admin('/admin/api/directory/contacts/' + contact.value.id, 'PATCH', {
      fields: { phone: '+359 89 765 4321' },
      extras: [{ key: 'Роля', value: 'адвокат' }, { key: '', value: 'skip' }],
    });
    assert.equal(cExtra.status, 200);
    assert.deepEqual(cExtra.value.extras, [{ key: 'Роля', value: 'адвокат' }]);
    // Дела (cases): ново, уникален номер, полета по желание, връзка към портала.
    const kase = await admin('/admin/api/cases', 'POST', {
      number: '2026-777',
      title: 'Дело 2026-777',
      category: 'Правни дела',
      subject: 'посещение на лице',
      contactId: contact.value.id,
      extras: [{ key: 'Съд', value: 'СРС' }],
    });
    assert.equal(kase.status, 201);
    assert.deepEqual(kase.value.extras, [{ key: 'Съд', value: 'СРС' }]);
    assert.equal(kase.value.contactId, contact.value.id);
    assert.equal(
      (await admin('/admin/api/cases', 'POST', { number: '2026-778', contactId: 'no-such-contact' })).status,
      400,
    );
    assert.equal((await admin('/admin/api/cases', 'POST', { number: '2026-777' })).status, 409);
    assert.equal((await admin('/admin/api/cases', 'POST', { title: '' })).status, 400);
    assert.ok((await admin('/admin/api/cases')).value.cases.some((c) => c.number === '2026-777'));
    const casePatched = await admin('/admin/api/cases/' + kase.value.id, 'PATCH', {
      extras: [{ key: 'Статус', value: 'в ход' }],
    });
    assert.equal(casePatched.status, 200);
    assert.deepEqual(casePatched.value.extras, [{ key: 'Статус', value: 'в ход' }]);
    const linkedCase = await admin('/admin/api/portals/' + portalId, 'PATCH', { caseId: kase.value.id });
    assert.equal(linkedCase.status, 200);
    assert.equal(linkedCase.value.caseId, kase.value.id);
    assert.equal(linkedCase.value.case.number, '2026-777');
    assert.equal(linkedCase.value.case.extras[0].value, 'в ход');
    assert.equal(linkedCase.value.contact.extras[0].key, 'Роля');
    assert.equal((await admin('/admin/api/portals/' + portalId, 'PATCH', { caseId: 'no-such-case' })).status, 400);
    assert.equal((await admin('/admin/api/portals/' + portalId, 'PATCH', { visibility: 'public' })).status, 200);
    const patched = await admin('/admin/api/portals/' + portalId, 'PATCH', {
      category: 'Договори',
      subject: 'доставка на документи',
      flag: 'not-a-real-flag',
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.value.category, 'Договори');
    assert.equal(patched.value.subject, 'доставка на документи');
    assert.equal(patched.value.flag, 'none', 'непознат флаг се нормализира до none');

    const upload = await req('/admin/api/portals/' + portalId + '/files', 'POST', 'hello-gateway', {
      Authorization: 'Bearer ' + token,
      'X-File-Name': 'public.txt',
      'Content-Type': 'application/octet-stream',
    });
    assert.equal(upload.status, 201);
    const fileId = upload.value.id;
    assert.equal(upload.value.accessMode, 'FREE');

    // 4. Публичният канал: портал, списък, решение, изтегляне без HA сесия.
    const portal = await req('/api/public/v1/portals/gw-test');
    assert.equal(portal.status, 200);
    assert.equal(portal.value.portal.access, 'FREE');
    // Публичните метаданни излизат, но контактът (лични данни) — не.
    assert.equal(portal.value.portal.category, 'Договори');
    assert.equal(portal.value.portal.subject, 'доставка на документи');
    assert.equal(portal.value.portal.flag, 'none');
    assert.equal(portal.value.portal.contact, undefined);
    assert.equal(portal.value.portal.contactId, undefined);
    assert.ok(portal.value.urls.landing.endsWith('/p/' + portalId + '/'), portal.value.urls.landing);

    const files = await req('/api/public/v1/portals/gw-test/files');
    assert.equal(files.status, 200);
    assert.equal(files.value.files.length, 1);
    assert.equal(files.value.files[0].id, fileId);

    const access = await req(`/api/public/v1/files/${fileId}/access`);
    assert.equal(access.status, 200);
    assert.equal(access.value.allowed, true, JSON.stringify(access.value.checks));

    const ok = await download(fileId);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), 'hello-gateway');

    // 4b. Отделен gateway listener: публичният канал не вижда административни маршрути.
    assert.equal(
      (await fetch(gwBase + '/admin/api/v2/export/rules', { headers: { Authorization: 'Bearer ' + token } })).status,
      404,
      'административните правила не са достъпни на публичния порт',
    );
    assert.equal((await fetch(gwBase + '/ui/index.html')).status, 404);
    const gwPortal = await (await fetch(gwBase + '/api/public/v1/portals/gw-test')).json();
    assert.equal(gwPortal.urls.landing, 'https://gateway.test/p/' + portalId + '/');
    const gwDownload = await fetch(gwBase + '/api/public/v1/files/' + fileId + '/download');
    assert.equal(gwDownload.status, 200);
    assert.equal(await gwDownload.text(), 'hello-gateway');

    // 5. Заключен файл: решение и 403 без ключ.
    assert.equal((await admin('/admin/api/portals/' + portalId + '/files/' + fileId + '/access', 'PATCH', { mode: 'KEY_REQUIRED' })).status, 200);
    const denied = await req(`/api/public/v1/files/${fileId}/access`);
    assert.equal(denied.value.allowed, false);
    assert.equal(denied.value.reason, 'token-active');
    const deniedDl = await download(fileId);
    assert.equal(deniedDl.status, 403);
    const deniedBody = await deniedDl.json();
    assert.equal(deniedBody.reason, 'token-active');

    // 6. Легитимен файлов ключ (hash проверен) минава като X-Portal-Key.
    const issued = await admin('/admin/api/portals/' + portalId + '/files/' + fileId + '/access-keys', 'POST', {});
    assert.equal(issued.status, 201);
    assert.ok(issued.value.key);
    const withKey = await download(fileId, { 'X-Portal-Key': issued.value.key });
    assert.equal(withKey.status, 200);
    assert.equal(await withKey.text(), 'hello-gateway');

    // 7. HA JWT не е публичен ключ.
    const ha = await req(`/api/public/v1/files/${fileId}/access`, 'GET', undefined, {
      'X-Portal-Key': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln',
    });
    assert.equal(ha.value.allowed, false);
    assert.equal(ha.value.reason, 'token-scheme');

    // 8. DISABLED печели пред всичко.
    assert.equal((await admin('/admin/api/portals/' + portalId + '/files/' + fileId + '/access', 'PATCH', { mode: 'DISABLED' })).status, 200);
    const off = await req(`/api/public/v1/files/${fileId}/access`, 'GET', undefined, { 'X-Portal-Key': issued.value.key });
    assert.equal(off.value.allowed, false);
    assert.equal(off.value.reason, 'mode-enabled');
    assert.equal((await download(fileId, { 'X-Portal-Key': issued.value.key })).status, 403);

    // 9. Непознат ресурс → 404, без изтичане на информация.
    assert.equal((await req('/api/public/v1/portals/nope')).status, 404);
    assert.equal((await req('/api/public/v1/files/deadbeef/access')).status, 404);

    console.log('PASS gateway-server: rules, preflight, public portal, access decision, keyed download, HA token rejection, DISABLED');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
