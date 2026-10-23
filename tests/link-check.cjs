'use strict';
// ВЕРЕН АДРЕС НЕ ЗНАЧИ АДРЕС, КОЙТО СЕ ОТВАРЯ.
//
// Докладван дефект: панелът показваше подписания URL като `${location.origin}${path}`.
// Под Home Assistant Ingress `location.origin` е адресът на Home Assistant, т.е. връзката
// ставаше `https://<ha>/api/v1/p/…` — там отговаря Home Assistant, не add-on-ът, и
// получателят вижда 401/404. Оттам идваше „и правилните линкове не се отварят“.
//
// Тук се проверяват двете неща, които го поправят:
//   1. `POST /admin/api/links/check` казва ИСТИНАТА причина, когато адресът не се отваря
//      (DNS, сертификат, порт, HTTP статус) — вместо мъртва връзка без обяснение;
//   2. проверката е ограничена до собствените адреси (не е начин да се удря чужд хост);
//   3. панелът строи връзките на ПУБЛИЧНИЯ адрес и не измисля такъв.
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { stopChild, freePort } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
let step = 'старт';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-linkcheck-'));
  const port = await freePort();
  const token = 'link-check-token-at-least-24-chars';
  const child = spawn(process.execPath, [path.join(ROOT, 'hapi_enterprise', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: token },
    cwd: os.tmpdir(),
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const once = async (p, method = 'GET', data, headers = {}) => {
    const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, ...headers }, body: data });
    const type = r.headers.get('content-type') || '';
    const value = type.includes('application/json') ? await r.json() : await r.arrayBuffer();
    return { status: r.status, value };
  };
  const call = async (p, method = 'GET', data, headers = {}) => {
    try {
      return await once(p, method, data, headers);
    } catch (e) {
      if (!/fetch failed|UND_ERR_SOCKET/i.test(String(e && e.message))) throw e;
      await new Promise((r) => setTimeout(r, 200));
      return once(p, method, data, headers);
    }
  };
  const check = (url) => call('/admin/api/links/check', 'POST', JSON.stringify({ url }), { 'Content-Type': 'application/json' });
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await call('/health')).status === 200) { ready = true; break } } catch { /* сървърът още пали */ }
      await new Promise((r) => setTimeout(r, 30));
    }
    assert(ready, 'сървърът трябва да стартира');

    step = 'портал и файл';
    const portal = (await call('/admin/api/portals', 'POST', JSON.stringify({ slug: 'lc', title: 'Проверка', category: 'Правни дела' }), { 'Content-Type': 'application/json' })).value;
    assert.ok(portal.id, 'порталът е създаден');
    const body = crypto.randomBytes(2048);
    const file = (await call(`/admin/api/portals/${portal.id}/files`, 'POST', body, { 'X-File-Name': 'proverka.pdf' })).value;
    assert.ok(file.id, 'файлът е качен');
    const signed = (await call(`/admin/api/portals/${portal.id}/files/${file.id}/signed-url`, 'POST', JSON.stringify({ ttlSeconds: 600 }), { 'Content-Type': 'application/json' })).value;
    assert.ok(signed.path, 'подписаният път е издаден');

    // ── 1. Работещ публичен адрес минава проверката и връща истинския статус ──
    step = 'работещ адрес';
    const good = await check(base + signed.path);
    assert.equal(good.status, 200, `проверката трябва да мине: ${JSON.stringify(good.value)}`);
    assert.equal(good.value.ok, true, 'работещият адрес е ok');
    assert.equal(good.value.status, 206, 'един байт се връща като 206 Partial Content');
    assert.ok(good.value.latencyMs >= 0, 'има измерено време');
    assert.ok(good.value.address, 'проверката показва до кой адрес се резолвира името');
    assert.equal(good.value.path, signed.path.split('?')[0], 'в отговора НЕ влиза подписът');

    // ── 2. Липсващ път на собствения хост: казва се, че страницата не съществува ──
    step = 'липсващ път';
    const missing = await check(`${base}/api/v1/p/lc/files/nope/download`);
    assert.equal(missing.status, 200, 'проверката се изпълнява, само резултатът е отрицателен');
    assert.equal(missing.value.ok, false, 'липсващият път не е ok');
    assert.equal(missing.value.status, 404, 'връща се истинският 404');
    assert.match(String(missing.value.reason), /не съществува/, 'причината е с думи, не само код');

    // ── 3. Друг порт е друг хост — не се проверява (иначе проверката става сканер) ──
    step = 'друг порт';
    const otherPort = await freePort();
    const dead = await check(`http://127.0.0.1:${otherPort}/`);
    assert.equal(dead.status, 400, 'друг порт на същия хост не е разрешен адрес');

    // ── 4. Чужд хост не се проверява — проверката не е инструмент за удряне на други ──
    step = 'чужд хост';
    const foreign = await check('http://example.com/');
    assert.equal(foreign.status, 400, 'чужд хост се отказва');
    assert.match(String(foreign.value.error || ''), /not allowed/i, 'причината е Host not allowed');

    // ── 5. Невалиден вход се отказва, без да се ходи по мрежата ──
    step = 'невалиден вход';
    assert.equal((await check('not-a-url')).status, 400, 'боклук не е адрес');
    assert.equal((await check('file:///etc/passwd')).status, 400, 'само http/https');
    assert.equal((await call('/admin/api/links/check', 'POST', JSON.stringify({}), { 'Content-Type': 'application/json' })).status, 400, 'липсващ адрес');

    // ── 6. Панелът: строи връзките на публичния адрес и не измисля такъв ──
    step = 'панелът';
    const ui = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'ui', 'files-manager.js'), 'utf8');
    assert.ok(!ui.includes("'https://portal.example.com'"), 'панелът не измисля публичен адрес');
    assert.ok(!ui.includes('${location.origin}${r.data.path}'), 'подписаният URL вече не се строи от location.origin');
    assert.ok(ui.includes('const linkBase = () => publicBase() || base();'), 'има един източник за базовия адрес на връзките');
    assert.ok(ui.includes("api('/admin/api/links/check'"), 'панелът проверява адреса, който показва');
    assert.ok(ui.includes('НЕ СЕ ОТВАРЯ'), 'когато адресът не работи, това се вижда до връзката');

    // ── 7. Нерезолвиращо се име: причината е DNS, а не „не може“ ──
    // Точно това се случваше с `homeassistant.local` — адресът изглежда верен, но името
    // не се открива и връзката не се отваря от никъде, освен от машината, която го знае.
    step = 'DNS';
    const publicBase = 'http://net-hapi.invalid';
    const port2 = await freePort();
    const child2 = spawn(process.execPath, [path.join(ROOT, 'hapi_enterprise', 'server.js')], {
      env: { ...process.env, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-linkdns-')), PORT: String(port2), ADMIN_TOKEN: token, PUBLIC_BASE_URL: publicBase },
      cwd: os.tmpdir(),
      stdio: 'ignore',
    });
    try {
      const base2 = `http://127.0.0.1:${port2}`;
      let ready2 = false;
      for (let i = 0; i < 120; i++) {
        try { if ((await fetch(`${base2}/health`)).status === 200) { ready2 = true; break } } catch { /* още пали */ }
        await new Promise((r) => setTimeout(r, 30));
      }
      assert(ready2, 'вторият сървър трябва да стартира');
      const r = await fetch(`${base2}/admin/api/links/check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `${publicBase}/api/v1/p/lc/files/x/download` }),
      });
      assert.equal(r.status, 200, 'проверката се изпълнява (адресът е собственият publicBaseUrl)');
      const dns = await r.json();
      assert.equal(dns.ok, false, 'нерезолвиращото се име не е ok');
      assert.equal(dns.status, 0, 'до HTTP не се стига');
      assert.equal(dns.code, 'ENOTFOUND', 'кодът показва DNS');
      assert.match(String(dns.reason), /резолвира/, 'причината е с думи: името не се резолвира');
    } finally {
      await stopChild(child2);
    }
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('✔ link-check: проверката казва причината, а връзките се строят на публичния адрес');
})().catch((e) => {
  console.error(`✖ link-check (${step}): ${e.message}`);
  process.exit(1);
});
