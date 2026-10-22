'use strict';
// Ingress автентикация: роли от опциите на add-on-а (user_roles / group_roles).
// Home Assistant подава X-Remote-User-Id / X-Remote-User-Name / X-Remote-User-Display-Name;
// X-Remote-User / X-Remote-Groups остават като fallback за reverse proxy и стари среди.
// Само на ingress listener-а.
const { stopChild, freePort } = require('./helpers.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-ingress-'));
  const optionsPath = path.join(dir, 'options.json');
  fs.writeFileSync(
    optionsPath,
    JSON.stringify({ user_roles: '{"pasev":"admin"}', group_roles: '{"hapi-admins":"admin"}' }),
    'utf8',
  );
  const port = await freePort();
  const adminPort = await freePort();
  const token = 'ingress-test-admin-token-1234567890';
  const base = `http://127.0.0.1:${port}`;
  const adminBase = `http://127.0.0.1:${adminPort}`;
  let child;

  const get = async (url, headers = {}) => {
    const res = await fetch(url, { headers });
    let value = null;
    try {
      value = await res.json();
    } catch {
      value = null;
    }
    return { status: res.status, value };
  };

  try {
    child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
      env: {
        ...process.env,
        DATA_DIR: dir,
        OPTIONS_PATH: optionsPath,
        PORT: String(port),
        ADMIN_TOKEN: token,
        INGRESS_MODE: 'true',
        ADMIN_PORT: String(adminPort),
        ADMIN_BIND_HOST: '127.0.0.1',
        USER_ROLES: '',
        GROUP_ROLES: '',
      },
      stdio: 'ignore',
    });
    for (let i = 0; i < 120; i++) {
      try {
        if ((await get(base + '/health')).status === 200) break;
      } catch { }
      await new Promise((r) => setTimeout(r, 50));
    }

    // 1. Ingress потребител с роля от опциите → admin.
    const byUser = await get(adminBase + '/admin/api/whoami', { 'X-Remote-User': 'pasev', 'X-Ingress-Path': '/app/c838e403_portal_enterprise' });
    assert.equal(byUser.status, 200, JSON.stringify(byUser.value));
    assert.equal(byUser.value.role, 'admin');
    assert.equal(byUser.value.ingress, true);

    // 1б. ИСТИНСКИТЕ заглавки на Home Assistant: X-Remote-User-Name (и -Id) водят до
    //     същата роля. X-Remote-User не се изпраща от HA — той е само fallback.
    const haName = await get(adminBase + '/admin/api/whoami', { 'X-Remote-User-Name': 'pasev', 'X-Remote-User-Id': 'u-1', 'X-Ingress-Path': '/api/hassio_ingress/abc123' });
    assert.equal(haName.status, 200, JSON.stringify(haName.value));
    assert.equal(haName.value.role, 'admin');
    const haId = await get(adminBase + '/admin/api/whoami', { 'X-Remote-User-Id': 'pasev' });
    assert.equal(haId.status, 200);
    assert.equal(haId.value.role, 'admin', 'ролята се търси и по X-Remote-User-Id');

    // 2. Група с роля от опциите → admin.
    const byGroup = await get(adminBase + '/admin/api/whoami', { 'X-Remote-Groups': 'users,hapi-admins' });
    assert.equal(byGroup.status, 200);
    assert.equal(byGroup.value.role, 'admin');

    // 3. Непознат потребител/група → администраторски права по подразбиране:
    //    профилите са незадължителни и при задаване само свалят ролята.
    const stranger = await get(adminBase + '/admin/api/whoami', { 'X-Remote-User': 'stranger' });
    assert.equal(stranger.status, 200);
    assert.equal(stranger.value.role, 'admin');
    const guests = await get(adminBase + '/admin/api/whoami', { 'X-Remote-Groups': 'guests' });
    assert.equal(guests.status, 200);
    assert.equal(guests.value.role, 'admin');

    // 4. Без ingress listener флагът не се вдига: X-Remote-User на публичния порт не дава достъп
    // (административните маршрути дори не съществуват там → 404).
    const publicAttempt = await get(base + '/admin/api/whoami', { 'X-Remote-User': 'pasev' });
    assert.notEqual(publicAttempt.status, 200);
    assert.equal((await get(base + '/admin/api/v2/export/rules', { 'X-Remote-User': 'pasev' })).status, 404);

    // 5. Bearer токенът работи винаги.
    const byToken = await get(adminBase + '/admin/api/whoami', { Authorization: 'Bearer ' + token });
    assert.equal(byToken.status, 200);
    assert.equal(byToken.value.role, 'admin');

    // 6. Административните правила са достъпни за ingress потребителя (без токен).
    const rules = await get(adminBase + '/admin/api/v2/export/rules', { 'X-Remote-User': 'pasev' });
    assert.equal(rules.status, 200);
    assert.equal(rules.value.export_profiles.profiles.length, 12);

    console.log('PASS ingress-auth: HA X-Remote-User-Name/-Id, user_roles/group_roles от options.json, ingress-only, token fallback');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
