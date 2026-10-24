'use strict';
// ЛИНКЪТ, КОЙТО ПАНЕЛЪТ ПОКАЗВА, ТРЯБВА ДА СЕ ОТВАРЯ В БРАУЗЪР.
//
// Докладван дефект: адресът, който панелът показваше като „публичен“
// (`/api/public/v1/files/<id>/download`), на практика иска ключ и връща 403 в браузър;
// същият адрес през curl с токен изглежда работи — оттам и „в терминала работи, в браузъра не“.
// Причината: порталът е частен по подразбиране и gateway-ят изисква токен/ключ.
//
// Затова панелът показва:
//   • за FREE файл — ПОДПИСАН адрес (sig + expires), който не иска заглавки;
//   • за защитен файл — администраторски адрес (изисква вход в панела).
// Тук се доказва с ЖИВ сървър, че подписаният адрес наистина отваря файла без заглавки.
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { stopChild, freePort } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
let step = 'старт';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-filelink-'));
  const port = await freePort();
  const token = 'file-link-token-at-least-24-chars';
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
    return { status: r.status, value, headers: r.headers };
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
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await call('/health')).status === 200) { ready = true; break } } catch { /* сървърът още пали */ }
      await new Promise((r) => setTimeout(r, 30));
    }
    assert(ready, 'сървърът трябва да стартира');

    step = 'портал и файл';
    const body = crypto.randomBytes(48 * 1024);
    const portal = (await call('/admin/api/portals', 'POST', JSON.stringify({ slug: 'link', title: 'Линк', category: 'Правни дела' }), { 'Content-Type': 'application/json' })).value;
    assert.ok(portal.id, 'порталът е създаден');
    const file = (await call(`/admin/api/portals/${portal.id}/files`, 'POST', body, { 'X-File-Name': 'dokument.pdf' })).value;
    assert.ok(file.id, 'файлът е качен');

    // ── 1. Старият „публичен“ адрес НЕ отваря файла — затова панелът го махна ──
    step = 'старият адрес';
    const oldLink = `${base}/api/public/v1/files/${file.id}/download`;
    const old = await fetch(oldLink);
    await old.arrayBuffer();
    assert.notEqual(old.status, 200, 'старият gateway адрес не дава файла без ключ (той иска токен)');

    // ── 2. Подписаният адрес отваря файла БЕЗ заглавки ──────────────────────
    step = 'подписан адрес';
    const issued = await call(`/admin/api/portals/${portal.id}/files/${file.id}/signed-url`, 'POST', JSON.stringify({ ttlSeconds: 3600 }), { 'Content-Type': 'application/json' });
    assert.equal(issued.status, 201, 'подписаният адрес е издаден: ' + issued.status);
    const url = base + issued.value.path;
    assert.match(issued.value.path, /^\/api\/v1\/p\/link\/files\/.+\/download\?expires=\d+&sig=[0-9a-f]{64}$/, 'адресът носи expires и sig');
    const pub = await fetch(url); // нарочно БЕЗ Authorization — така го отваря браузърът
    assert.equal(pub.status, 200, 'подписаният адрес отваря файла без токен: ' + pub.status);
    const got = Buffer.from(await pub.arrayBuffer());
    assert.equal(got.length, body.length, 'дължината съвпада');
    assert.equal(sha256(got), sha256(body), 'съдържанието съвпада байт-в-байт');
    assert.match(pub.headers.get('content-disposition') || '', /dokument\.pdf/, 'името е в Content-Disposition');

    // ── 3. Подправен/изтекъл подпис не работи ───────────────────────────────
    step = 'подправен подпис';
    const tampered = await fetch(`${base}${issued.value.path.replace(/sig=[0-9a-f]{64}/, 'sig=' + 'a'.repeat(64))}`);
    await tampered.arrayBuffer();
    assert.equal(tampered.status, 404, 'подправен подпис → 404');
    const shortTtl = (await call(`/admin/api/portals/${portal.id}/files/${file.id}/signed-url`, 'POST', JSON.stringify({ ttlSeconds: 1 }), { 'Content-Type': 'application/json' })).value;
    await new Promise((r) => setTimeout(r, 1200));
    const expired = await fetch(base + shortTtl.path);
    await expired.arrayBuffer();
    assert.equal(expired.status, 404, 'изтекъл подпис → 404');

    // ── 4. За защитен файл подписан адрес не се издава ─────────────────────
    step = 'защитен файл';
    await call(`/admin/api/portals/${portal.id}/files/${file.id}/access`, 'PATCH', JSON.stringify({ mode: 'KEY_REQUIRED', listed: true, reason: 'тест: ключ' }), { 'Content-Type': 'application/json' });
    const denied = await call(`/admin/api/portals/${portal.id}/files/${file.id}/signed-url`, 'POST', JSON.stringify({ ttlSeconds: 300 }), { 'Content-Type': 'application/json' });
    assert.equal(denied.status, 403, 'KEY_REQUIRED → подписан адрес е забранен (403)');

    // ── 5. Панелът строи точно тези адреси ─────────────────────────────────
    step = 'панелът';
    const ui = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'ui', 'files-manager.js'), 'utf8');
    assert.equal(/api\/public\/v1\/files\//.test(ui), false, 'панелът не показва повече адреса, който иска ключ');
    assert.match(ui, /files\/\$\{f\.id\}\/signed-url/, 'панелът издава подписан адрес през административния маршрут');
    assert.match(ui, /Администраторски адрес за изтегляне/, 'за защитените файлове има ясен надпис');

    process.stdout.write(
      `PASS file-link-works: подписаният адрес отваря ${body.length} B без заглавки · старият gateway адрес не дава файла · подправен/изтекъл подпис → 404 · KEY_REQUIRED → без подписан адрес · панелът строи точно този адрес\n`
    );
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  const cause = e && e.cause ? ` (причина: ${e.cause.code || e.cause.message})` : '';
  process.stderr.write(`FAIL file-link-works [етап: ${step}]: ${e && e.message ? e.message : e}${cause}\n`);
  process.exitCode = 1;
});
