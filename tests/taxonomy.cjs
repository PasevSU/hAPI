'use strict';
const { stopChild } = require('./helpers.cjs');
const assert = require('node:assert/strict'), { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
(async () => {
  const { freePort } = require('./helpers.cjs'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-taxonomy-')), port = await freePort(), token = 'taxonomy-test-token-with-32-characters'; const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: token }, stdio: 'ignore' }); const base = `http://127.0.0.1:${port}`;
  async function call(route, method = 'GET', data) { const r = await fetch(base + route, { method, headers: { Authorization: 'Bearer ' + token, ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: data !== undefined ? JSON.stringify(data) : undefined }); return { status: r.status, data: await r.json() } }
  try {
    let ready = false; for (let i = 0; i < 60; i++) { try { const r = await fetch(base + '/health'); if (r.ok) { ready = true; break } } catch { } await new Promise(r => setTimeout(r, 50)) } assert.ok(ready, 'server starts');
    const p = (await call('/admin/api/portals', 'POST', { slug: 'taxonomy', title: 'Taxonomy' })).data; assert.ok(p.id);
    const uploaded = await fetch(base + '/admin/api/portals/' + p.id + '/files', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-File-Name': 'test.txt' }, body: 'example' }); assert.equal(uploaded.status, 201); const f = await uploaded.json();
    const endpoint = '/admin/api/portals/' + p.id + '/files/' + f.id + '/metadata'; assert.equal((await call(endpoint, 'PATCH', { topic: 'Security', category: 'Reports', group: 'Legal', tags: ['evidence', 'review'] })).status, 200);
    assert.equal((await call(endpoint, 'PATCH', { tags: [''] })).status, 400);
    // Иконата 👁/🚫 на файла: видимост в публичния каталог през metadata (без смяна на политиката).
    assert.equal((await call(endpoint, 'PATCH', { listed: 'yes' })).status, 400, 'listed трябва да е boolean');
    // Публичният каталог се вижда само за публичен портал.
    assert.equal((await call('/admin/api/portals/' + p.id, 'PATCH', { visibility: 'public' })).status, 200);
    const publicFiles = async () => (await call('/api/v1/p/taxonomy/files')).data.total;
    assert.equal(await publicFiles(), 1, 'видимият файл е в публичния каталог');
    const hidden = await call(endpoint, 'PATCH', { listed: false }); assert.equal(hidden.status, 200); assert.equal(hidden.data.listed, false);
    assert.equal(await publicFiles(), 0, 'скритият файл излиза от публичния каталог');
    const shown = await call(endpoint, 'PATCH', { listed: true }); assert.equal(shown.data.listed, true);
    assert.equal(await publicFiles(), 1, 'файлът се връща в публичния каталог');
    assert.equal(shown.data.accessMode, 'FREE', 'видимостта не пипа политиката за достъп');
    const page = await call('/admin/api/portals/' + p.id + '/files?category=reports&tag=evidence&group=legal&topic=security'); assert.equal(page.data.total, 1); assert.equal(page.data.files[0].topic, 'Security');
    assert.equal((await call('/admin/api/portals/' + p.id + '/files?tag=missing')).data.total, 0);
    const taxonomy = await call('/admin/api/portals/' + p.id + '/taxonomy'); assert.deepEqual(taxonomy.data.tags, ['evidence', 'review']);
    const unauth = await fetch(base + '/admin/api/portals/' + p.id + '/taxonomy'); assert.equal(unauth.status, 401);
    // F2-10: смяната на тема/категория/група МЕСТИ файла във виртуалното дърво — id-то остава,
    // пътят се сменя. Това е „Премести“ по план 17 и се вижда в публичния манифест.
    const pathOf = async () => (await call('/api/v1/p/' + p.slug + '/manifest')).data.files[0].path;
    const beforeMove = await pathOf();
    assert.equal(beforeMove, '/Security/Reports/Legal/test.txt', 'пътят следва таксономията: ' + beforeMove);
    assert.equal((await call(endpoint, 'PATCH', { category: 'Contracts', group: 'Archive' })).status, 200);
    const afterMove = await pathOf();
    assert.equal(afterMove, '/Security/Contracts/Archive/test.txt', 'смяната на категория/група мести файла: ' + afterMove);
    const afterFiles = await call('/admin/api/portals/' + p.id + '/files');
    assert.equal(afterFiles.data.files[0].id, f.id, 'идентификаторът не се мени при преместване');
    console.log('PASS taxonomy: metadata, validation, four filters, taxonomy facets, admin authorization, F2-10 virtual move keeps the id');
  } finally { await stopChild(child); fs.rmSync(dir, { recursive: true, force: true }) }
})().catch(e => { console.error(e); process.exitCode = 1 });
