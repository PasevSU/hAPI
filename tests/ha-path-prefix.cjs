'use strict';
// hAPI зад Home Assistant живее под префикс (`/hapi/…`), защото `/api/` е пространството на
// самия HA. Страницата на портала получава адресите си ОТ СЪРВЪРА (`data-api`, `data-base`),
// а те бяха root-absolute: при `/hapi/p/<id>` браузърът би търсил `/api/v1/p/…` в корена на
// HA, тоест на чужд маршрут. Тук се проверява, че префиксът от proxy-то (`X-Forwarded-Prefix`)
// влиза и в двата адреса, че невалиден префикс се игнорира, и че интеграцията сервира
// `/hapi/…`, защото `/api/…` може да бъде засенчен от HA.
const { stopChild } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const port = 18411;
const token = 'prefix-test-admin-secret-2026-k4m2';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-prefix-'));
  const child = spawn(process.execPath, [path.join(root, 'hapi_enterprise', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, ADMIN_TOKEN: token, PORT: String(port), PUBLIC_GATEWAY_PORT: '0', PUBLIC_BASE_URL: '' },
    stdio: 'pipe',
  });
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { ready = true; break; } } catch { /* още се вдига */ }
      await new Promise((r) => setTimeout(r, 80));
    }
    assert.ok(ready, 'сървърът се вдига');
    const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    const mk = await fetch(`http://127.0.0.1:${port}/admin/api/portals`, {
      method: 'POST', headers: H, body: JSON.stringify({ slug: 'prefixed', title: 'Prefixed', visibility: 'public' }),
    });
    assert.equal(mk.status, 201, 'порталът се създава');
    const portal = JSON.parse(await mk.text());

    const page = async (headers = {}) => {
      const r = await fetch(`http://127.0.0.1:${port}/p/${portal.id}`, { headers });
      assert.equal(r.status, 200, 'страницата се сервира');
      return r.text();
    };
    const attr = (html, name) => {
      const m = html.match(new RegExp(`data-${name}="([^"]*)"`));
      assert.ok(m, 'страницата има data-' + name);
      return m[1];
    };

    // 1. Без префикс адресите са както досега.
    const plain = await page();
    assert.equal(attr(plain, 'api'), '/api/v1/p/prefixed', 'без префикс API-то е /api/v1/p/<slug>');
    assert.equal(attr(plain, 'base'), `http://127.0.0.1:${port}`, 'без префикс базата е адресът на заявката');

    // 2. С префикс и двата адреса остават вътре в него.
    const prefixed = await page({ 'x-forwarded-prefix': '/hapi' });
    assert.equal(attr(prefixed, 'api'), '/hapi/api/v1/p/prefixed', 'под префикс API-то е /hapi/api/v1/p/<slug>');
    assert.equal(attr(prefixed, 'base'), `http://127.0.0.1:${port}/hapi`, 'под префикс базата носи /hapi');

    // 3. Префиксът се проверява: обхождане нагоре не се приема.
    const traversal = await page({ 'x-forwarded-prefix': '/../x' });
    assert.equal(attr(traversal, 'api'), '/api/v1/p/prefixed', 'невалиден префикс се игнорира');

    // 4. Интеграцията сервира своя префикс, защото `/api/…` може да е на HA.
    const py = fs.readFileSync(path.join(root, 'custom_components', 'hapi_enterprise', '__init__.py'), 'utf8');
    assert.ok(py.includes('url = "/hapi/{tail:.*}"'), 'интеграцията регистрира /hapi/…');
    assert.ok(py.includes('"X-Forwarded-Prefix": "/hapi"'), 'интеграцията подава префикса към backend-а');
    assert.ok(py.includes('request.path[len("/hapi"):]'), 'интеграцията маха префикса от пътя');

    console.log('ha-path-prefix OK: /hapi/api/v1/p/<slug> · база с /hapi · невалиден префикс игнориран · /hapi/… в интеграцията');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
