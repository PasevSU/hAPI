'use strict';
// ОРАКУЛ: QR кодът на портала води до СТРАНИЦАТА С ФАЙЛОВЕ, не до суровия JSON —
// и при създаване, и след „генерирай API“ от панела.
//
// Дефектът: `POST /admin/api/v2/portals/<slug>/api` строеше отделен регистър без
// `qrPayload`, затова презаписваше `api/<slug>/qr.svg` с адрес на API-то. Панелът вика
// точно този път веднага след създаване, т.е. новосъздаденият портал получаваше QR към
// JSON. Тук се сверява самото съдържание на QR-а (генериран независимо от сървъра).
const { stopChild } = require('./helpers.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
const svgFor = (text) => { const q = require('../hapi_enterprise/qrcode.js')(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 8, margin: 4, scalable: true }) };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-apiqr-'));
  const token = 'apiqr-test-admin-secret-2026-b7c3', pub = 18297;
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env: { ...process.env, DATA_DIR: dir, ADMIN_TOKEN: token, PORT: String(pub), PUBLIC_GATEWAY_PORT: '0', PUBLIC_BASE_URL: 'https://example.test' }, stdio: 'pipe' });
  try {
    let ready = false;
    for (let i = 0; i < 70; i++) { try { if ((await fetch(`http://127.0.0.1:${pub}/health`)).ok) { ready = true; break } } catch { } await new Promise(r => setTimeout(r, 70)) }
    assert(ready, 'server startup');
    const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    const mk = await fetch(`http://127.0.0.1:${pub}/admin/api/portals`, { method: 'POST', headers: H, body: JSON.stringify({ slug: 'demo', title: 'Demo' }) });
    assert.equal(mk.status, 201); const pid = (await mk.json()).id;
    const d = path.join(dir, 'api', 'demo');
    for (const f of ['api.json', 'openapi.json', 'qr.svg']) assert(fs.existsSync(path.join(d, f)), f + ' missing');
    const info = JSON.parse(fs.readFileSync(path.join(d, 'api.json'), 'utf8'));
    assert.equal(info.apiUrl, 'https://example.test/api/v1/p/demo');
    const landing = 'https://example.test/p/' + pid;
    assert.equal(info.links.landingUrl, landing, 'api.json сочи страницата на портала');
    // 1. При създаване QR кодът кодира страницата с файловете.
    assert.equal(fs.readFileSync(path.join(d, 'qr.svg'), 'utf8'), svgFor(landing), 'qr.svg при създаване = страницата на портала');
    // 2. След „генерирай API“ от панела — СЪЩОТО (не API адресът).
    const regen = await fetch(`http://127.0.0.1:${pub}/admin/api/v2/portals/demo/api`, { method: 'POST', headers: H, body: '{}' });
    assert.equal(regen.status, 201, await regen.text());
    const afterRegen = fs.readFileSync(path.join(d, 'qr.svg'), 'utf8');
    assert.equal(afterRegen, svgFor(landing), 'след генериране QR-ът пак води до страницата');
    assert.notEqual(afterRegen, svgFor('https://example.test/api/v1/p/demo'), 'QR-ът не води до суровия JSON');
    // 3. Панелът получава същия адрес и готов NFC/universal линк.
    const apiInfo = await (await fetch(`http://127.0.0.1:${pub}/admin/api/portals/${pid}/api-info`, { headers: H })).json();
    assert.equal(apiInfo.qrTarget, landing, 'qrTarget = страницата с файлове');
    assert.match(apiInfo.qr, /^<svg/);
    assert.equal(apiInfo.links.universal.target, landing, 'universal link води до страницата');
    assert.match(apiInfo.links.nfc.write, /^https:\/\/www\.home-assistant\.io\/tag\//, 'тагът е по официалния формат');
    const r = await fetch(`http://127.0.0.1:${pub}/api/v1/p/demo/qr.svg`, { headers: { authorization: 'Bearer ' + token } });
    assert([200, 404].includes(r.status));
    const del = await fetch(`http://127.0.0.1:${pub}/admin/api/portals/${pid}`, { method: 'DELETE', headers: H });
    assert.equal(del.status, 200);
    assert(!fs.existsSync(d), 'api dir not removed');
    console.log('portal-api-qr OK: QR → /p/<id> при създаване · пак след „генерирай API“ · qrTarget/NFC/universal водят до страницата');
  } finally { await stopChild(child); fs.rmSync(dir, { recursive: true, force: true }) }
})().catch(e => { console.error(e); process.exit(1) });
