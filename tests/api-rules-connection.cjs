'use strict';
// Сценарий: правила на gateway-я, връзка за GUI-я и показатели за натоварване.
// Това са четирите административни маршрута, които остават извън останалите тестове:
//   GET  /admin/api/rules          — какви правила са заредени и откъде
//   POST /admin/api/rules/reload   — презареждане без рестарт на add-on-а
//   GET  /admin/api/connection     — роля, режим, публичен адрес и версия на API
//   GET  /admin/api/load           — текущото ниво на load control
const { stopChild, freePort, waitHealthy } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-rules-conn-'));
  const port = await freePort();
  const token = 'rules-connection-admin-token-0123456789';
  const viewer = 'rules-connection-viewer-token-0123456789';
  const base = `http://127.0.0.1:${port}`;

  const call = async (route, { method = 'GET', bearer, body } = {}) => {
    const res = await fetch(base + route, {
      method,
      headers: {
        ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let value = null;
    try {
      value = await res.json();
    } catch {
      value = null;
    }
    return { status: res.status, value, headers: res.headers };
  };

  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      OPTIONS_PATH: path.join(dir, 'missing-options.json'),
      PORT: String(port),
      ADMIN_TOKEN: token,
      VIEWER_TOKEN: viewer,
    },
    stdio: 'ignore',
  });

  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try {
        if ((await call('/health')).status === 200) {
          ready = true;
          break;
        }
      } catch { }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, 'сървърът не стартира');

    // 1. Без токен → 401 (административните маршрути не са публични).
    assert.equal((await call('/admin/api/rules')).status, 401);
    assert.equal((await call('/admin/api/connection')).status, 401);
    assert.equal((await call('/admin/api/load')).status, 401);

    // 2. Правилата: статус с източници и списък на липсващите файлове.
    const rules = await call('/admin/api/rules', { bearer: token });
    assert.equal(rules.status, 200);
    assert.ok(Array.isArray(rules.value.dirs), 'rules.dirs трябва да е масив');
    assert.equal(typeof rules.value.files, 'object');
    assert.ok(Array.isArray(rules.value.missing), 'rules.missing трябва да е масив');
    assert.ok(
      Object.keys(rules.value.files).length > 0,
      'rules.files трябва да изброява поне един файл с правила',
    );

    // 3. Презареждане без рестарт: отговорът носи reloaded + същия статус.
    const reloaded = await call('/admin/api/rules/reload', { method: 'POST', bearer: token });
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.value.reloaded, true);
    assert.deepEqual(
      Object.keys(reloaded.value.files).sort(),
      Object.keys(rules.value.files).sort(),
      'презареждането трябва да върне същия набор правила',
    );

    // 4. Връзка за GUI-я: роля, режим, адрес и версия на API — без секрети.
    const connection = await call('/admin/api/connection', { bearer: token });
    assert.equal(connection.status, 200);
    assert.equal(connection.value.role, 'admin');
    assert.equal(connection.value.ingress, false, 'standalone режимът не е Ingress');
    assert.ok(
      /^https?:\/\/127\.0\.0\.1:/.test(connection.value.requestBase),
      'requestBase трябва да е адресът на заявката',
    );
    assert.ok(
      typeof connection.value.apiVersion === 'string' && connection.value.apiVersion.length > 0,
      'connection.apiVersion трябва да е непразен низ',
    );
    assert.ok(!('token' in connection.value), 'connection не бива да връща токена');

    // 5. Load control: ниво, ефективен лимит и прозорец за грешки.
    const load = await call('/admin/api/load', { bearer: token });
    assert.equal(load.status, 200);
    assert.ok(
      typeof load.value.level === 'string' && load.value.level.length > 0,
      'load.level трябва да е непразен низ (LOW/NORMAL/...)',
    );
    for (const key of ['effective', 'base', 'min', 'errorWindowMs', 'sinceLevel']) {
      assert.equal(typeof load.value[key], 'number', `load.${key} трябва да е число`);
    }
    assert.ok(load.value.effective > 0, 'ефективният лимит трябва да е положителен');
    assert.ok(load.value.effective <= load.value.base, 'натоварването може само да сваля лимита');

    // 6. Роли: viewer чете /load (capability load = read), но не пипа правилата
    //    (capability settings е само за admin).
    assert.equal((await call('/admin/api/load', { bearer: viewer })).status, 200);
    assert.equal((await call('/admin/api/rules', { bearer: viewer })).status, 403);
    assert.equal(
      (await call('/admin/api/rules/reload', { method: 'POST', bearer: viewer })).status,
      403,
      'viewer не бива да презарежда правила',
    );

    // 7. Невалиден токен не се приема за admin.
    assert.equal((await call('/admin/api/connection', { bearer: 'x'.repeat(40) })).status, 401);

    console.log(
      'PASS rules/connection/load: статус на правилата, reload, връзка за GUI-я, load control и роли',
    );
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
