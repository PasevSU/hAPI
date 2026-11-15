'use strict';
// Портал „само за преглед“ — СПЪТНИК със собствен QR (0.69.211).
//
// Изискването: при създаване на портал „паралелно“ се създава и портал само за преглед, в
// който файловете могат САМО да се гледат. Затова се мери на живия сървър:
//   1. POST с `readonlyView: true` връща и `viewPortal` — втори запис със собствен slug/QR,
//      същата папка, `readonly: true`;
//   2. файлът от него идва `Content-Disposition: inline` (преглед), а от нормалния портал —
//      `attachment` (сваляне);
//   3. пакетът (ZIP) на спътника е ОТКАЗАН (403), защото „свали всичко“ не е преглед;
//   4. спътникът има СВОЙ QR артефакт, а слагът му не е същият като на портала;
//   5. без флага в тялото втори портал НЕ се създава (API-то не прави изненади).
const assert = require('node:assert/strict');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const { stopChild } = require('./helpers.cjs');
const portalView = require('../hapi_enterprise/portal-view');

(async () => {
  const server = await startServer();
  try {
    // ── 1. Чистата политика: slug, флаг, опции за отдаване ────────────────────
    assert.equal(portalView.readOnlySlug('dokumenti'), 'dokumenti-view', 'slug на спътника идва от портала');
    assert.equal(portalView.readOnlySlug('x'.repeat(63)), 'x'.repeat(58) + '-view', 'slug остава в лимита от 63 знака');
    assert.equal(portalView.isReadonly({ readonly: true }), true);
    assert.equal(portalView.isReadonly({}), false, 'липсващ флаг значи нормален портал');
    assert.deepEqual(portalView.downloadOptions({ readonly: true }), { inline: true }, 'read-only → преглед в браузъра');
    assert.deepEqual(portalView.downloadOptions({}), {}, 'нормален портал → сваляне');
    assert.equal(portalView.allowsPackage({ readonly: true }), false, 'спътникът не дава пакет');

    // ── 2. Живият сървър: портал + спътник в ЕДНА заявка ─────────────────────
    const slug = 'ro-' + Math.random().toString(16).slice(2, 8);
    const created = await server.api('/admin/api/portals', 'POST', { slug, title: 'Договори', visibility: 'public', readonlyView: true });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data).slice(0, 200));
    const main = created.data;
    assert.ok(main.viewPortal, 'заявката връща и портала само за преглед');
    const view = main.viewPortal;
    assert.equal(view.slug, slug + '-view', 'спътникът има собствен slug');
    assert.notEqual(view.id, main.id, 'спътникът е отделен запис, не същият');
    assert.equal(view.storage_root, main.storage_root, 'гледа СЪЩАТА папка — няма второ копие на файловете');
    assert.match(view.title, /преглед/, 'заглавието казва какво е: ' + view.title);

    // ── 3. Файл в папката: гледа се от спътника, сваля се от портала ──────────
    const storage = require('../hapi_enterprise/paths').resolveStoragePath(main.storage_root, '', { STORAGE_ROOT_OVERRIDE: server.storageRoot() });
    const fs = require('node:fs');
    fs.mkdirSync(storage, { recursive: true });
    fs.writeFileSync(path.join(storage, 'dogovor.txt'), 'текст за преглед');

    const attach = await server.authFetch(`${server.base}/admin/api/portals/${main.id}/files`, {
      method: 'POST',
      headers: { 'x-file-name': 'dogovor.txt', 'content-type': 'text/plain' },
      body: 'текст за преглед',
    });
    assert.equal(attach.status, 201, 'файлът е прикачен: ' + attach.status);
    const attachBody = await attach.json();
    const fileId = (attachBody.file && attachBody.file.id) || attachBody.id;
    assert.ok(fileId, 'има id на файла: ' + JSON.stringify(attachBody).slice(0, 200));

    const inlineRes = await fetch(`${server.base}/api/v1/p/${view.slug}/tree/file?path=${encodeURIComponent('/dogovor.txt')}`);
    assert.equal(inlineRes.status, 200, 'спътникът отдава файла за преглед: ' + inlineRes.status);
    assert.match(String(inlineRes.headers.get('content-disposition')), /^inline/, 'спътникът: inline, не attachment');
    await inlineRes.arrayBuffer();

    const attachRes = await fetch(`${server.base}/api/v1/p/${main.slug}/tree/file?path=${encodeURIComponent('/dogovor.txt')}`);
    assert.equal(attachRes.status, 200, 'нормалният портал отдава файла');
    assert.match(String(attachRes.headers.get('content-disposition')), /^attachment/, 'нормалният портал: attachment (сваляне)');
    await attachRes.arrayBuffer();

    // ── 4. Пакетът (ZIP) на спътника е отказан ───────────────────────────────
    const packView = await server.authFetch(`${server.base}/api/v1/p/${view.slug}/package`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(packView.status, 403, 'спътникът НЕ строи пакет: ' + packView.status);
    const packBody = await packView.json().catch(() => ({}));
    assert.match(String(packBody.detail || packBody.message || ''), /преглед/, 'отказът обяснява защо: ' + JSON.stringify(packBody).slice(0, 160));
    const packMain = await server.authFetch(`${server.base}/api/v1/p/${main.slug}/package`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(packMain.status, 201, 'нормалният портал строи пакет: ' + packMain.status);
    await packMain.arrayBuffer();

    // ── 5. Собствен QR и публична страница ───────────────────────────────────
    const viewInfo = await server.api(`/admin/api/portals/${view.id}/api-info`);
    assert.equal(viewInfo.status, 200, 'api-info на спътника отговаря');
    assert.notEqual(viewInfo.data.landingUrl, main.apiUrl, 'адресът на спътника е свой');
    assert.ok(String(viewInfo.data.qr || '').includes('<svg'), 'спътникът има СВОЙ QR код');
    const publicView = await server.api(`/api/v1/p/${view.slug}`);
    assert.equal(publicView.status, 200, 'публичният изглед на спътника отговаря');
    assert.equal(publicView.data.readonly, true, 'публичният изглед казва „само за преглед“');
    assert.equal(publicView.data.parentId, main.id, 'спътникът сочи кой е порталът му');
    const publicMain = await server.api(`/api/v1/p/${main.slug}`);
    assert.equal(publicMain.data.readonly, false, 'нормалният портал НЕ е само за преглед');

    // ── 6. Без флаг не се създава нищо излишно ──────────────────────────────
    const plain = await server.api('/admin/api/portals', 'POST', { slug: slug + '-plain', title: 'Без спътник', visibility: 'private' });
    assert.equal(plain.status, 201, 'порталът се създава');
    assert.equal(plain.data.viewPortal, undefined, 'без `readonlyView` втори портал НЕ се създава');

    // Панелът иска спътника по подразбиране: квадратчето е отметнато.
    const ui = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', 'files-manager.js'), 'utf8');
    assert.match(ui, /name="readonly_view"[^>]*checked/, 'квадратчето „само за преглед“ е отметнато по подразбиране');
    assert.match(ui, /readonlyView: readonlyWanted/, 'панелът подава флага при създаване');
  } finally {
    await stopChild(server.child);
    await server.stop();
  }

  console.log('PASS portal-readonly: спътник със собствен QR и slug · същата папка · inline преглед срещу attachment · пакет 403 · без флаг няма втори портал');
})();
