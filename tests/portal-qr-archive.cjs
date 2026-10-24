'use strict';
// 0.69.77 — QR ревизии, физически архиви и дълбочина на дървото (архитектурният план).
//
// Проверява се онова, което планът изисква, а не „има бутон“:
//   PORTAL_IDENTITY        — нов портал получава основен QR (QR-001) още при създаване;
//   QR_REVISION_CHAIN      — архив → следващ QR, който помни предходния (QR-002 → QR-001);
//   QR_ARCHIVE_PHYSICAL    — архивът е РЕАЛЕН ZIP на диска със свой SHA-256 и манифест;
//   NO_SILENT_SUBSTITUTION — старият QR остава; съдържанието му е фиксирано в манифеста;
//   MAX_BRANCH_DEPTH_3     — четвърто ниво се отказва от СЪРВЪРА, ширината е свободна;
//   LOCK_REASON_REQUIRED   — прекратяване/заключване без основание се отказва.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const shareRoot = path.resolve('/share');
const cleaned = [];

(async () => {
  const server = await startServer();
  try {
    const api = (p, method = 'GET', bodyJson) =>
      server.authFetch(server.base + p, {
        method,
        headers: bodyJson === undefined ? {} : { 'content-type': 'application/json' },
        body: bodyJson === undefined ? undefined : JSON.stringify(bodyJson),
      });
    const jsonOf = async (p, method, bodyJson) => {
      const res = await api(p, method, bodyJson);
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      return { status: res.status, data };
    };

    const slug = 'qr-' + Date.now().toString(36);
    const portal = (await jsonOf('/admin/api/portals', 'POST', { slug, title: 'QR портал', visibility: 'public' })).data;
    cleaned.push(portal.slug);
    const folder = path.join(shareRoot, slug);
    fs.mkdirSync(folder, { recursive: true });
    const put = (rel, text) => {
      const full = path.join(folder, ...rel.split('/'));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, text);
    };
    put('документ-1.txt', 'първи документ');
    put('тема/документ-2.txt', 'втори документ');

    // ── 1. Основен QR се създава с портала ───────────────────────────────────
    const first = await jsonOf(`/admin/api/portals/${portal.id}/qr`);
    assert.equal(first.status, 200, 'регистърът се чете');
    assert.equal(first.data.active.id, 'QR-001', 'новият портал получава QR-001');
    assert.equal(first.data.revisions.length, 1);
    assert.equal(first.data.policy.maxDepth, 3, 'политиката казва три нива');
    assert.equal(first.data.policy.code, 'MAX_BRANCH_DEPTH_3');
    assert.deepEqual(first.data.archives, [], 'още няма архиви');

    // ── 2. Архивиране: физически файл + манифест + следващ QR ────────────────
    const archived = await jsonOf(`/admin/api/portals/${portal.id}/qr/archive`, 'POST', { note: 'първи етап' });
    assert.equal(archived.status, 201, 'архивирането минава: ' + JSON.stringify(archived.data).slice(0, 200));
    const ar = archived.data.archive;
    assert.equal(ar.id, 'AR-001');
    assert.equal(ar.qrId, 'QR-001', 'архивът принадлежи на предходния QR');
    assert.match(ar.sha256, /^[0-9a-f]{64}$/, 'архивът има собствен SHA-256');
    assert.ok(ar.size > 0 && ar.files === 2, `архивът съдържа двата файла (${ar.size} B)`);
    const onDisk = path.join(server.dir, 'archives', portal.id, ar.file);
    assert.equal(fs.existsSync(onDisk), true, 'архивният файл е РЕАЛЕН на диска: ' + onDisk);
    assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(onDisk)).digest('hex'), ar.sha256, 'хешът на файла съвпада с регистрирания');
    // §10.1.7 / §19: архивът се ПРОВЕРЯВА преди да се отчете като успешен.
    assert.equal(ar.verificationStatus, 'verified', 'архивът е проверен при създаване, не след това');
    assert.ok(ar.verifiedAt, 'има време на проверката');
    assert.equal(archived.data.active, 'QR-002', 'след архив има следващ QR');
    assert.equal(archived.data.archivedQr, 'QR-001');

    // ── 3. Манифестът е в архива и сочи съдържанието ─────────────────────────
    const zipBuf = Buffer.from(await (await api(`/admin/api/portals/${portal.id}/qr/QR-001/archive`)).arrayBuffer());
    const unzipped = require('../hapi_enterprise/ooxml.js').unzip(zipBuf);
    assert.ok(unzipped.has('manifest.json'), 'архивът съдържа manifest.json');
    assert.ok(unzipped.has('files/документ-1.txt') && unzipped.has('files/тема/документ-2.txt'), 'архивът съдържа самите байтове на файловете');
    const manifest = JSON.parse(unzipped.get('manifest.json')().toString('utf8'));
    assert.equal(manifest.qr_id, 'QR-001');
    assert.equal(manifest.previous_qr_id, null, 'първият QR няма предходен');
    assert.equal(manifest.archive_id, 'AR-001');
    assert.equal(manifest.files.length, 2);
    for (const f of manifest.files) assert.match(f.sha256, /^[0-9a-f]{64}$/);
    assert.equal(manifest.depth_policy.max_depth, 3);

    const rev1 = await jsonOf(`/admin/api/portals/${portal.id}/qr/QR-001`);
    assert.equal(rev1.status, 200);
    assert.match(rev1.data.qr.manifestHash, /^[0-9a-f]{64}$/, 'манифестът има хеш');
    assert.equal(rev1.data.next.id, 'QR-002', 'веригата сочи наследника');
    assert.equal(rev1.data.archive.id, 'AR-001');

    // ── 4. Втори архив: веригата пази историята ──────────────────────────────
    put('документ-3.txt', 'трети документ');
    const second = await jsonOf(`/admin/api/portals/${portal.id}/qr/archive`, 'POST', { note: 'втори етап' });
    assert.equal(second.status, 201);
    assert.equal(second.data.archive.id, 'AR-002');
    assert.equal(second.data.archive.qrId, 'QR-002');
    const rev2 = (await jsonOf(`/admin/api/portals/${portal.id}/qr/QR-002`)).data;
    assert.equal(rev2.qr.previousQrId, 'QR-001', 'QR-002 помни предходния');
    assert.equal(rev2.qr.previousManifestHash, rev1.data.qr.manifestHash, 'веригата пази хеша на предходния манифест');
    assert.equal((await jsonOf(`/admin/api/portals/${portal.id}/qr`)).data.revisions.length, 3, 'три ревизии след два архива');
    assert.equal(fs.existsSync(path.join(server.dir, 'archives', portal.id, 'AR-001'.length ? ar.file : '')), true, 'старият архив НЕ е изтрит');

    // ── 4б. Публичен QR договор: идентичност, списък и сваляне на архив ─────
    const pubQr = await jsonOf(`/api/v1/p/${slug}/qr.json`);
    assert.equal(pubQr.status, 200, 'публичният QR договор се чете');
    assert.equal(pubQr.data.active, 'QR-003', 'активният QR е последният');
    assert.equal(pubQr.data.revisions.length, 3, 'историята се вижда');
    const pubFirst = pubQr.data.revisions.find((r) => r.id === 'QR-001');
    assert.equal(pubFirst.archive.id, 'AR-001', 'архивът е свързан с QR-001');
    assert.match(pubFirst.archive.sha256, /^[0-9a-f]{64}$/);
    assert.equal(pubFirst.archive.verificationStatus, 'verified', 'публичният изглед казва, че архивът е проверен');
    assert.equal(pubFirst.nextQrId, 'QR-002', '§3.4: ревизията сочи следващия QR');
    assert.equal(pubFirst.previousQrId, null, 'първата ревизия няма предходна');
    assert.equal('note' in pubFirst.archive, false, 'вътрешните бележки не излизат публично');
    const pubZip = Buffer.from(await (await api(`/api/v1/p/${slug}/qr/QR-001/archive`)).arrayBuffer());
    assert.equal(require('node:crypto').createHash('sha256').update(pubZip).digest('hex'), ar.sha256, 'публичният архив е същият файл');
    const withQr = await api(`/portal.html?order=${encodeURIComponent('share/' + slug)}&qr=QR-001`);
    assert.equal(withQr.status, 200, 'order + qr отваря страницата');
    assert.match(await withQr.text(), /data-qr="QR-001"/, 'страницата знае с кой QR е дошъл посетителят');
    assert.equal((await api(`/portal.html?order=${encodeURIComponent('share/' + slug)}&qr=QR-999`)).status, 404, 'непознат QR → 404');

    // ── 4в. Сензорите виждат същото (един източник: portal-qr.stats) ────────
    const sensors = (await jsonOf('/admin/api/sensors')).data;
    assert.ok(sensors.qr, 'сензорите носят блок `qr`');
    assert.equal(sensors.qr.active, 1, 'един активен QR');
    assert.equal(sensors.qr.blocked, 0, 'още няма прекратени');
    assert.equal(sensors.qr.archives, 2, 'два физически архива');
    assert.equal(sensors.qr.maxDepth, 3, 'политиката за дълбочина идва от сензорите');

    // ── 5. Прекратяване: иска основание, пази историята ──────────────────────    assert.equal((await jsonOf(`/admin/api/portals/${portal.id}/qr/block`, 'POST', {})).status, 400, 'без основание не се прекратява');
    const blocked = await jsonOf(`/admin/api/portals/${portal.id}/qr/block`, 'POST', { reason: 'подадена е нова редакция на делото' });
    assert.equal(blocked.status, 200, 'с основание се прекратява');
    assert.equal(blocked.data.blocked, 'QR-003');
    const after = (await jsonOf(`/admin/api/portals/${portal.id}/qr`)).data;
    assert.equal(after.active, null, 'няма активен QR след прекратяване');
    assert.equal(after.revisions.length, 3, 'историята остава');
    const last = after.revisions[after.revisions.length - 1];
    assert.equal(last.blockedAt ? true : false, true, 'прекратяването е записано');
    assert.equal(last.blockReason, 'подадена е нова редакция на делото', 'основанието е записано');
    assert.equal((await jsonOf(`/admin/api/portals/${portal.id}/qr/archive`, 'POST', {})).status, 409, 'след прекратяване не се архивира');
    // `blok`: прекратеният QR не отдава съдържание, но казва защо — с 410.
    const blok = await api(`/portal.html?order=${encodeURIComponent('share/' + slug)}&qr=QR-003`);
    assert.equal(blok.status, 410, 'прекратен QR дава blok страница');
    const blokHtml = await blok.text();
    assert.match(blokHtml, /QR-003/, 'страницата назовава прекратения QR');
    assert.match(blokHtml, /подадена е нова редакция на делото/, 'основанието е публично видимо');
    assert.equal(/документ-1\.txt/.test(blokHtml), false, 'blok не показва съдържание');

    // ── 6. Дълбочина: три клона се приемат, четвърти — не ────────────────────
    const mk = (parentValue, name) => jsonOf(`/admin/api/portals/${portal.id}/tree/folder`, 'POST', { parent: parentValue, name });
    assert.equal((await mk('', 'a')).status, 201, 'клон 1');
    assert.equal((await mk('a', 'b')).status, 201, 'клон 2');
    assert.equal((await mk('a/b', 'c')).status, 201, 'клон 3');
    const tooDeep = await mk('a/b/c', 'd');
    assert.equal(tooDeep.status, 409, 'четвърти клон се отказва');
    assert.match(String(tooDeep.data.error || tooDeep.data), /MAX_BRANCH_DEPTH_3/, 'отказът носи кода на правилото');
    // ширината е свободна: много паралелни папки на едно ниво
    for (const name of ['т1', 'т2', 'т3', 'т4', 'т5']) assert.equal((await mk('', name)).status, 201, 'паралелна папка ' + name);
    // …и по-дълбок път през качване също се отказва
    const deep = await server.authFetch(server.base + `/admin/api/portals/${portal.id}/tree/upload?path=${encodeURIComponent('/a/b/c/d/файл.txt')}&mkdir=1`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'x',
    });
    assert.equal(deep.status, 409, 'качване на четвърто ниво се отказва');
    assert.equal(fs.existsSync(path.join(folder, 'a', 'b', 'c', 'd')), false, 'и на диска не се е появила папка');

    console.log('PASS portal-qr-archive: QR-001 при създаване · реален ZIP архив със SHA-256 и манифест · верига QR-001→QR-002→QR-003 · прекратяване с основание · 3 клона, четвърти → 409');
  } finally {
    await server.stop();
    for (const name of cleaned) {
      try { fs.rmSync(path.join(shareRoot, name), { recursive: true, force: true }) } catch { /* Linux */ }
    }
  }
})().catch((e) => {
  console.error('FAIL portal-qr-archive:', e && e.message ? e.message : e);
  if (e && e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
