'use strict';
const { stopChild } = require('./helpers.cjs');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const { freePort } = require('./helpers.cjs'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-page-')), port = await freePort(), adminPort = await freePort(), secret = 'test-admin-token-long-enough-123456'; const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PORT: String(adminPort), INGRESS_MODE: 'true', ADMIN_TOKEN: secret }, stdio: 'pipe' });
  const call = (p, opts = {}, admin = false) => fetch(`http://127.0.0.1:${admin ? adminPort : port}${p}`, opts);
  const json = async (p, method, body) => { const r = await call(p, { method, headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, true); assert(r.ok, `${method} ${p} ${r.status}`); return r.json() };
  try {
    let ok = false; for (let i = 0; i < 100; i++) { try { await call('/'); ok = true; break } catch { await new Promise(r => setTimeout(r, 30)) } } assert(ok);
    const p = await json('/admin/api/portals', 'POST', { slug: 'example', title: 'My Portal' });
    assert.equal((await call('/p/example')).status, 404);
    await json('/admin/api/users', 'POST', { username: 'viewer', password: 'viewer-pass-123', scopes: ['read', 'download'] });
    const key = await (await call('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'viewer', password: 'viewer-pass-123' }) })).json();
    let r = await call('/p/example?portal_token=' + encodeURIComponent(key.token)); assert.equal(r.status, 200); assert((await r.text()).includes('/portal.js'));
    assert.equal((await call('/portal.js')).status, 200); assert.equal((await call('/portal.css')).status, 200);
    assert.equal((await call('/p/example?portal_token=invalid')).status, 404);
    assert.equal((await call('/portal.js', {}, true)).status, 404);
    assert.equal((await call('/admin', {}, false)).status, 404);
    // Публичната страница е мястото, където води QR кодът: работи и с „/“ накрая,
    // носи своите локални ресурси и QR изображението (CSP позволява img-src 'self').
    const page = await call('/p/example/?portal_token=' + encodeURIComponent(key.token));
    assert.equal(page.status, 200);
    const pageHtml = await page.text();
    for (const needle of ['/portal.css', '/portal.js', '/portal-i18n.js', 'id="files"', 'id="qr"', 'id="q"', 'id="status"',
      // Текстовете се сменят според артефактите — елементите трябва да имат адресируеми ids.
      'id="toolbar"', 'id="qr-note"', 'id="qr-hint"', 'id="foot-note"', 'id="skip"', 'id="q-label"', 'id="lang"']) assert.ok(pageHtml.includes(needle), `страницата съдържа ${needle}`);
    const pageCsp = page.headers.get('content-security-policy') || '';
    assert.ok(pageCsp.includes("img-src 'self' data:"), 'CSP позволява QR изображението');
    const script = await (await call('/portal.js')).text();
    for (const needle of ['X-File-Key', '/files/', 'textContent', 'portal_token',
      // Адаптивни текстове: профил на съдържанието → вид артефакт → съществителни.
      'buildProfile', 'applyWording', 'KIND_BY_EXT', 'nounOf']) assert.ok(script.includes(needle), `portal.js съдържа ${needle}`);
    // Всеки вид артефакт трябва да има съществително НА ВСЕКИ ЕЗИК, иначе страницата
    // би показала „undefined“ вместо „документи“/„documents“/„Dokumente“.
    // Съществителните живеят в речника (portal-i18n.js), затова се проверяват там.
    const i18n = require('../hapi_enterprise/portal/portal-i18n.js');
    const kindValues = new Set([...((script.match(/const KIND_BY_EXT = \{([\s\S]*?)\};/) || [])[1] || '').matchAll(/:\s*"([a-z]+)"/g)].map(m => m[1]));
    assert.ok(kindValues.size >= 4, `видовете артефакти са разпознати (${kindValues.size})`);
    for (const kind of kindValues) {
      for (const lang of i18n.LANGS) {
        const noun = i18n.nouns(lang)[kind];
        assert.ok(noun && noun.one && noun.many && noun.capMany && noun.for, `видът „${kind}“ има съществително на „${lang}“`);
      }
    }
    assert.equal(/innerHTML\s*=\s*[^'"`]*(file\.|data\.|listing)/.test(script), false, 'данните не се вмъкват през innerHTML');
    assert.equal((await call('/api/v1/p/example?portal_token=' + encodeURIComponent(key.token))).status, 200);
    const f = await call(`/admin/api/portals/${p.id}/files`, { method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'X-File-Name': 'test.txt' }, body: 'hello' }, true); assert.equal(f.status, 201); const file = await f.json();
    const list = await call(`/api/v1/p/example/files?limit=500&portal_token=${encodeURIComponent(key.token)}`); assert.equal(list.status, 200); assert.equal((await list.json()).files.length, 1);
    // Публичният изглед носи контакт и препратки; страницата (там води QR кодът) се
    // адресира с ID на портала — връзката не издава името и не се чупи при смяна на slug-а.
    const view = await (await call(`/api/v1/p/example?portal_token=${encodeURIComponent(key.token)}`)).json();
    assert.equal(view.urls.landing, '/p/' + p.id, 'адресът на страницата е с id на портала, не с име');
    assert.equal(view.urls.qrTarget, '/p/' + p.id, 'QR кодът кодира публичната страница (по id), не JSON API-то');
    assert.ok(view.urls.api.endsWith('/api/v1/p/example'), 'JSON API-то остава по slug');
    assert.ok(view.urls.qr.endsWith('/api/v1/p/example/qr.svg'));
    assert.ok('contact' in view, 'публичният изглед носи контакт (или null)');
    assert.equal(typeof view.fileCount, 'number');
    // И двете форми на адреса работят: /p/<id> (канонична) и /p/<slug> (стари връзки).
    for (const addr of ['/p/' + p.id, '/p/' + p.id + '/', '/p/example']) {
      const rr = await call(addr + '?portal_token=' + encodeURIComponent(key.token));
      assert.equal(rr.status, 200, `${addr} отваря страницата`);
      assert((await rr.text()).includes('/portal.js'), `${addr} сервира portal.js`);
    }
    // API-то също приема id, за да не се налага втора заявка за намиране на slug-а.
    const byId = await call('/api/v1/p/' + p.id + '?portal_token=' + encodeURIComponent(key.token));
    assert.equal(byId.status, 200, '/api/v1/p/<id> работи');
    assert.equal((await byId.json()).slug, 'example', 'по id се връща същият портал');
    const qr = await call(`/api/v1/p/example/qr.svg?portal_token=${encodeURIComponent(key.token)}`);
    assert.equal(qr.status, 200); assert.equal(qr.headers.get('content-type'), 'image/svg+xml');
    const qrById = await call(`/api/v1/p/${p.id}/qr.svg?portal_token=${encodeURIComponent(key.token)}`);
    assert.equal(qrById.status, 200, 'QR изображението се сервира и по id на портала');
    await json(`/admin/api/portals/${p.id}/files/${file.id}/access`, 'PATCH', { mode: 'DISABLED' });
    assert.equal((await call(`/api/v1/p/example/files/${file.id}/download?portal_token=${encodeURIComponent(key.token)}`)).status, 403);
    console.log('PASS: portal HTML access, private token, static assets, ingress isolation, catalog, disabled file');
  } finally { await stopChild(child); fs.rmSync(dir, { recursive: true, force: true }) }
})().catch(e => { console.error(e); process.exitCode = 1 });
