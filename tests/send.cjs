'use strict';
// „Бърз линк“ (Send-lite): безсрочен по подразбиране, еднократен билет, парола по избор,
// лимит на свалянията, отмяна. Проверява и че публичните изгледи не изтичат хеша на паролата.
const { stopChild } = require('./helpers.cjs');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const sendLite = require('../hapi_enterprise/send');
(async () => {
  // ── 1. Модулни инварианти (без сървър) ──────────────────────────────────────
  const rec = sendLite.createRecord({});
  assert.equal(rec.expiresAt, null, 'по подразбиране линкът е БЕЗСРОЧЕН');
  assert.equal(rec.maxAccess, 0, 'по подразбиране без лимит на свалянията');
  assert.equal(rec.id.length, 22, 'id е 22 знака');
  assert(/^[0-9A-HJKMNP-TV-Z]{22}$/.test(rec.id), 'id е Crockford base32 без I/L/O/U');
  assert.equal(sendLite.canAccess(rec).ok, true);
  assert.equal(sendLite.adminView(rec).protected, false, 'без парола → protected=false');
  const guarded = sendLite.createRecord({ passphrase: 'таен-код' });
  assert.equal(guarded.pass.hash.length > 0, true);
  assert.equal(sendLite.verifyPassphrase('таен-код', guarded), true, 'вярна парола минава');
  assert.equal(sendLite.verifyPassphrase('грешна', guarded), false, 'грешна парола не минава');
  assert.equal(sendLite.verifyPassphrase('', guarded), false, 'празна парола не минава');
  assert.equal(JSON.stringify(sendLite.adminView(guarded)).includes(guarded.pass.hash), false, 'adminView не показва хеша');
  const secret = 'unit-secret-for-tickets';
  const minted = sendLite.mintTicket({ sendId: rec.id, fileId: 'file-1', secret, ttlMs: 60_000 });
  assert.equal(sendLite.verifyTicket(minted.ticket, secret).sendId, rec.id, 'билетът се проверява');
  assert.equal(sendLite.verifyTicket(minted.ticket, 'друг-секрет'), null, 'чужд подпис не минава');
  assert.equal(sendLite.verifyTicket(minted.ticket.slice(0, -2) + 'aa', secret), null, 'подправен билет не минава');
  const expiredTicket = sendLite.mintTicket({ sendId: rec.id, fileId: 'file-1', secret, ttlMs: -1000 });
  assert.equal(sendLite.verifyTicket(expiredTicket.ticket, secret), null, 'изтекъл билет не минава');
  assert.equal(sendLite.canAccess({ ...rec, expiresAt: new Date(Date.now() - 1000).toISOString() }).reason, 'expired');
  assert.equal(sendLite.canAccess({ ...rec, maxAccess: 1, accessCount: 1 }).reason, 'exhausted');
  assert.equal(sendLite.canAccess({ ...rec, disabled: true }).reason, 'revoked');

  // ── 2. HTTP поток ───────────────────────────────────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-'));
  const port = 33000 + Math.floor(Math.random() * 1500), adminPort = 36000 + Math.floor(Math.random() * 1500);
  const token = 'send-test-admin-token-1234567890';
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PORT: String(adminPort), INGRESS_MODE: 'true', ADMIN_TOKEN: token }, stdio: 'pipe' });
  const call = (p, opts = {}, admin = false) => fetch(`http://127.0.0.1:${admin ? adminPort : port}${p}`, opts);
  const adminJson = async (p, method, payload) => { const r = await call(p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, true); assert(r.ok, `${method} ${p} → ${r.status}`); return r.json() };
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) { try { await call('/health'); ready = true; break } catch { await new Promise(r => setTimeout(r, 40)) } }
    assert(ready, 'сървърът стартира');
    const portal = await adminJson('/admin/api/portals', 'POST', { slug: 'send-test', title: 'Send test' });
    const upload = await call(`/admin/api/portals/${portal.id}/files`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-File-Name': 'report.txt' }, body: 'hello send' }, true);
    assert.equal(upload.status, 201, 'файлът е качен');
    const file = await upload.json();

    // Без срок, без парола, без лимит — режимът по подразбиране.
    const open = await adminJson(`/admin/api/portals/${portal.id}/files/${file.id}/sends`, 'POST', {});
    assert.equal(open.expiresAt, null, 'създаденият линк е безсрочен');
    assert.equal(open.maxAccess, 0, 'без лимит по подразбиране');
    assert.ok(open.url.endsWith('/s/' + open.id), 'връща се публичен адрес /s/<id>');

    const landing = await call('/s/' + open.id);
    assert.equal(landing.status, 200, 'публичната страница се отваря');
    const html = await landing.text();
    assert(html.includes('report.txt'), 'страницата показва името на файла');
    assert(html.includes('Безсрочна връзка'), 'страницата казва, че връзката е безсрочна');
    assert(!html.includes('name="passphrase"'), 'без парола няма поле за парола');
    assert(!/pasev|@gmail|имейл/i.test(html), 'страницата не издава подател/имейл');
    assert.equal(landing.headers.get('referrer-policy'), 'no-referrer');
    assert.ok((landing.headers.get('content-security-policy') || '').includes("form-action 'self'"), 'CSP ограничава формата до себе си');

    // Форма → 303 към еднократен билет → файл.
    const access = await call('/api/v1/sends/' + open.id + '/access', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '', redirect: 'manual' });
    assert.equal(access.status, 303, 'успешният достъп пренасочва към билета');
    const location = access.headers.get('location');
    assert(location.includes('ticket='), 'билетът е в адреса на свалянето');
    const download = await call(location);
    assert.equal(download.status, 200, 'свалянето работи с билета');
    assert.equal(await download.text(), 'hello send', 'съдържанието е същото');
    assert.equal((await call(location)).status, 404, 'същият билет не работи втори път (еднократен)');

    // Парола: грешна → 403, вярна → билет; брояч на опитите не блокира първите.
    const locked = await adminJson(`/admin/api/portals/${portal.id}/files/${file.id}/sends`, 'POST', { passphrase: 'код-123' });
    const lockedPage = await (await call('/s/' + locked.id)).text();
    assert(lockedPage.includes('name="passphrase"'), 'защитеният линк иска парола');
    const wrong = await call('/api/v1/sends/' + locked.id + '/access', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ passphrase: 'грешна' }) });
    assert.equal(wrong.status, 403, 'грешната парола се отказва');
    const right = await (await call('/api/v1/sends/' + locked.id + '/access', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ passphrase: 'код-123' }) })).json();
    assert(right.ticket, 'вярната парола дава билет');
    assert.equal((await call(right.url)).status, 200, 'файлът се сваля след парола');

    // Лимит на свалянията: 1 → вторият достъп е отказан.
    const once = await adminJson(`/admin/api/portals/${portal.id}/files/${file.id}/sends`, 'POST', { maxAccess: 1 });
    const first = await call('/api/v1/sends/' + once.id + '/access', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' });
    assert.equal(first.status, 200, 'първият достъп минава');
    const second = await call('/api/v1/sends/' + once.id + '/access', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' });
    assert.equal(second.status, 404, 'след изчерпване на лимита достъпът е отказан');

    // Срок: кратък живот → след изтичане страницата и достъпът са 404.
    const shortLived = await adminJson(`/admin/api/portals/${portal.id}/files/${file.id}/sends`, 'POST', { expiresAt: new Date(Date.now() + 1200).toISOString() });
    assert.equal((await call('/s/' + shortLived.id)).status, 200, 'преди изтичане страницата работи');
    await new Promise(r => setTimeout(r, 1400));
    assert.equal((await call('/s/' + shortLived.id)).status, 404, 'след изтичане страницата е 404');
    assert.equal((await call('/api/v1/sends/' + shortLived.id + '/access', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' })).status, 404, 'след изтичане достъпът е отказан');

    // Отмяна: линкът умира, без да се пипа файлът.
    const revocable = await adminJson(`/admin/api/portals/${portal.id}/files/${file.id}/sends`, 'POST', {});
    const del = await call(`/admin/api/portals/${portal.id}/files/${file.id}/sends/${revocable.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }, true);
    assert.equal(del.status, 200, 'линкът се отменя');
    assert.equal((await call('/s/' + revocable.id)).status, 404, 'отмененият линк е 404');
    assert.equal((await call(`/admin/api/portals/${portal.id}/files/${file.id}/sends/${revocable.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }, true)).status, 404, 'повторна отмяна е 404');

    // Административният списък показва линковете, но не и хеша на паролата.
    const list = await (await call(`/admin/api/portals/${portal.id}/files/${file.id}/sends`, { headers: { Authorization: 'Bearer ' + token } }, true)).json();
    assert(list.sends.length >= 3, 'списъкът връща активните линкове');
    assert.equal(JSON.stringify(list).includes('"hash"'), false, 'списъкът не изтича хеша на паролата');
    assert.ok(list.sends.every(s => s.url.includes('/s/')), 'всеки линк носи публичен адрес');
    const catalog = await (await call(`/admin/api/portals`, { headers: { Authorization: 'Bearer ' + token } }, true)).json();
    assert.equal(JSON.stringify(catalog).includes('"pass"'), false, 'каталогът на порталите не изтича паролата');
    const publicFiles = await (await call('/api/v1/p/send-test/files')).json();
    assert.equal(JSON.stringify(publicFiles).includes('sends'), false, 'публичният списък не показва линковете');

    console.log('PASS send: безсрочен по подразбиране, еднократен билет, парола, лимит, срок и отмяна');
  } finally { await stopChild(child); fs.rmSync(dir, { recursive: true, force: true }) }
})().catch(e => { console.error(e); process.exitCode = 1 });
