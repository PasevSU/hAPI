'use strict';
// Пакетът на целия портал, поискан от ПУБЛИЧНАТА страница (PP-12).
//
// Проверява се обещанието, а не удобството: в пакета влиза само това, което посетителят
// и без това може да свали (FREE и видимо), линкът е еднократен, изтича, не се преизползва
// за друг портал, а отказаните файлове са НАЗОВАНИ в манифеста, вместо да липсват тихо.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ooxml = require('../hapi_enterprise/ooxml.js');
const { startServer } = require('./lib/gui-harness.cjs');

const upload = async (server, portalId, name, body) => {
  const res = await server.authFetch(`${server.base}/admin/api/portals/${portalId}/files`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-File-Name': name, 'X-File-Encrypt': '0' }, body,
  });
  assert.equal(res.status, 201, 'качване на ' + name);
  return (await res.json()).id;
};
const policy = async (server, portalId, fileId, mode, listed) => {
  const res = await server.api(`/admin/api/portals/${portalId}/files/${fileId}/access`, 'PATCH', { mode, reason: 'тест: режим', ...(listed === undefined ? {} : { listed }) });
  assert.equal(res.status, 200, 'политика ' + mode);
};

(async () => {
  const server = await startServer();
  const other = await startServer({ env: { PUBLIC_PACKAGE_TTL_SECONDS: '1' } });
  const off = await startServer({ env: { PUBLIC_PACKAGE: '0' } });
  try {
    // ── Портал с четири файла: един свободен, един с ключ, един забранен, един скрит ──
    const portal = (await server.api('/admin/api/portals', 'POST', { slug: 'paket', title: 'Пакет' })).data;
    assert.ok(portal && portal.id, 'порталът е създаден');
    assert.equal((await server.api(`/admin/api/portals/${portal.id}`, 'PATCH', { visibility: 'public' })).status, 200);
    const free = await upload(server, portal.id, 'svoboden.txt', 'свободно съдържание');
    const keyed = await upload(server, portal.id, 's-klyuch.txt', 'само с ключ');
    const banned = await upload(server, portal.id, 'zabranen.txt', 'забранено');
    const hidden = await upload(server, portal.id, 'skrit.txt', 'скрито');
    await policy(server, portal.id, keyed, 'KEY_REQUIRED');
    await policy(server, portal.id, banned, 'DISABLED');
    await policy(server, portal.id, hidden, 'FREE', false);

    // ── 1. Публичният изглед казва какво може да влезе в пакета ────────────────
    const view = await (await fetch(`${server.base}/api/v1/p/paket`)).json();
    assert.equal(view.package.enabled, true, 'пакетът е включен по подразбиране');
    assert.equal(view.package.eligible, 1, 'само един файл може да влезе: ' + JSON.stringify(view.package));
    assert.equal(view.urls.package, '/api/v1/p/paket/package', 'страницата знае къде да поиска пакета');

    // ── 2. Поискване на пакет → 201, еднократен линк ───────────────────────────
    const asked = await fetch(`${server.base}/api/v1/p/paket/package`, { method: 'POST' });
    assert.equal(asked.status, 201, 'пакетът се построява');
    const grant = await asked.json();
    assert.equal(grant.package.files, 1, 'в пакета е само свободният файл');
    assert.equal(grant.download.once, true, 'линкът е еднократен');
    assert.match(grant.download.url, /^\/api\/v1\/p\/paket\/package\/[a-f0-9]{48}$/, 'адресът носи само токен: ' + grant.download.url);
    assert.ok(grant.download.expiresAt, 'има срок');
    const reasons = grant.excluded.map((x) => x.reason).sort();
    assert.deepEqual(reasons, ['DISABLED', 'KEY_REQUIRED', 'UNLISTED'], 'отказаните са назовани: ' + JSON.stringify(grant.excluded));

    // ── 3. Свалянето: валиден ZIP, само разрешеното, отказът е в манифеста ─────
    const zipRes = await fetch(server.base + grant.download.url);
    assert.equal(zipRes.status, 200, 'линкът сваля');
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());
    assert.equal(zipBuf.subarray(0, 2).toString(), 'PK', 'това е ZIP');
    assert.equal(crypto.createHash('sha256').update(zipBuf).digest('hex'), grant.package.sha256, 'хешът съвпада с обявения');
    const entries = ooxml.unzip(zipBuf);
    const names = [...entries.keys()];
    assert.ok(names.includes('originals/svoboden.txt'), 'свободният файл е вътре: ' + names.join(', '));
    assert.equal(names.some((n) => /s-klyuch|zabranen|skrit/.test(n)), false, 'нищо забранено не е вътре: ' + names.join(', '));
    const index = JSON.parse(entries.get('PACKAGE_INDEX.json')().toString('utf8'));
    assert.equal(index.files.length, 1);
    assert.equal(index.excluded.length, 3, 'манифестът изброява отказаните');
    const manifest = JSON.parse(entries.get('manifest/portal.json')().toString('utf8'));
    assert.equal(manifest.counts.excluded, 3);
    assert.equal(manifest.refused.length, 3, 'и в четимата част на манифеста');

    // ── 4. Линкът се изгаря при първото сваляне ────────────────────────────────
    const again = await fetch(server.base + grant.download.url);
    await again.arrayBuffer();
    assert.equal(again.status, 410, 'второто сваляне е 410');

    // ── 5. Непознат токен не е пакет ───────────────────────────────────────────
    const bogus = await fetch(`${server.base}/api/v1/p/paket/package/${'a'.repeat(48)}`);
    await bogus.arrayBuffer();
    assert.equal(bogus.status, 404, 'случаен токен → 404');

    // ── 6. Токенът е за своя портал, не за всички ─────────────────────────────
    const second = (await server.api('/admin/api/portals', 'POST', { slug: 'vtoriportal', title: 'Втори' })).data;
    assert.equal((await server.api(`/admin/api/portals/${second.id}`, 'PATCH', { visibility: 'public' })).status, 200);
    await upload(server, second.id, 'drug.txt', 'друг портал');
    // Свеж токен, за да не се бърка „чужд портал“ с „вече използван“.
    const fresh = await (await fetch(`${server.base}/api/v1/p/paket/package`, { method: 'POST' })).json();
    const foreign = await fetch(`${server.base}/api/v1/p/vtoriportal/package/${fresh.download.url.split('/').pop()}`);
    await foreign.arrayBuffer();
    assert.equal(foreign.status, 404, 'токенът не отваря друг портал');
    // А на своя портал същият токен още работи — чуждото искане не го е изгорило.
    const own = await fetch(server.base + fresh.download.url);
    await own.arrayBuffer();
    assert.equal(own.status, 200, 'чуждото искане не изгаря токена');

    // ── 7. Портал само със забранени файлове → ясен отказ, не празен архив ────
    const locked = (await server.api('/admin/api/portals', 'POST', { slug: 'zaplashki', title: 'Затворен' })).data;
    assert.equal((await server.api(`/admin/api/portals/${locked.id}`, 'PATCH', { visibility: 'public' })).status, 200);
    const only = await upload(server, locked.id, 'samo-s-klyuch.txt', 'ключ');
    await policy(server, locked.id, only, 'KEY_REQUIRED');
    const refused = await fetch(`${server.base}/api/v1/p/zaplashki/package`, { method: 'POST' });
    const refusedBody = await refused.json();
    assert.equal(refused.status, 409, 'няма какво да се сложи в пакета');
    assert.match(refusedBody.error, /без ключ/, 'съобщението обяснява защо: ' + refusedBody.error);

    // ── 8. Изтекъл линк → 410 ──────────────────────────────────────────────────
    const shortLived = (await other.api('/admin/api/portals', 'POST', { slug: 'kratak', title: 'Кратък' })).data;
    assert.equal((await other.api(`/admin/api/portals/${shortLived.id}`, 'PATCH', { visibility: 'public' })).status, 200);
    await upload(other, shortLived.id, 'kratak.txt', 'кратко');
    const shortAsked = await fetch(`${other.base}/api/v1/p/kratak/package`, { method: 'POST' });
    assert.equal(shortAsked.status, 201);
    const shortGrant = await shortAsked.json();
    assert.ok(shortGrant.download.ttlSeconds <= 1, 'линкът живее секунда: ' + shortGrant.download.ttlSeconds);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const late = await fetch(other.base + shortGrant.download.url);
    await late.arrayBuffer();
    assert.equal(late.status, 410, 'след срока → 410');
    const lateBody = await (await fetch(other.base + shortGrant.download.url)).text();
    assert.match(lateBody, /изтекъл|използван/, 'сървърът казва защо не работи: ' + lateBody);

    // ── 9. Пакетът се изключва с PUBLIC_PACKAGE=0 ────────────────────────────
    const offPortal = (await off.api('/admin/api/portals', 'POST', { slug: 'izkl', title: 'Изключен' })).data;
    assert.equal((await off.api(`/admin/api/portals/${offPortal.id}`, 'PATCH', { visibility: 'public' })).status, 200);
    await upload(off, offPortal.id, 'f.txt', 'съдържание');
    const offView = await (await fetch(`${off.base}/api/v1/p/izkl`)).json();
    assert.equal(offView.package.enabled, false, 'изгледът съобщава, че пакет няма');
    const offAsk = await fetch(`${off.base}/api/v1/p/izkl/package`, { method: 'POST' });
    await offAsk.arrayBuffer();
    assert.equal(offAsk.status, 404, 'изключен пакет → 404, не 500');

    // ── 10. Пакетът не е страничен вход към забраненото ───────────────────────
    // Файлът с ключ се сваля само с ключ; в пакета го няма (проверено в т. 3), а
    // директен опит без ключ продължава да е 403.
    const direct = await fetch(`${server.base}/api/v1/p/paket/files/${keyed}/download`);
    await direct.arrayBuffer();
    assert.equal(direct.status, 403, 'ключовият файл не се отваря от пакета');

    console.log('PASS public-package: еднократен линк · само FREE+видими · отказът е в манифеста · 410 при повторно/изтекло · чужд портал 404 · изключване');
  } finally {
    await server.stop().catch(() => { });
    await other.stop().catch(() => { });
    await off.stop().catch(() => { });
    try { fs.rmSync(path.join(os.tmpdir(), 'hapi-pkg-none'), { recursive: true, force: true }) } catch { /* няма такъв */ }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
