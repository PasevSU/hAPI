'use strict';
// ЗАКРИВАНЕ НА ПОРТАЛ: архив за съхранение → 6 месеца → окончателно изтриване.
//
// Проверява се ПЪТЯТ НА ЧОВЕКА, не само отговорът на един маршрут:
//
//   1. портал с реален файл се закрива → изчезва от активния списък, появява се в
//      „Затворени портали“ със срок (183 дни по подразбиране);
//   2. данните НЕ са изтрити: файловете и записът са в `archives/closed/<id>`, а работната
//      папка е освободена — тоест порталът наистина „отива в система за съхранение“;
//   3. публичният адрес отговаря 410 „Порталът е закрит“ — не 404 и не празна страница;
//   4. връщането връща портала с файловете му и адресът пак се отваря;
//   5. след изтичане на срока архивът се изтрива — с `HAPI_PORTAL_RETENTION_DAYS=0`
//      срокът е нула, тоест същият код минава през истинското изтриване, не през подправена
//      дата в базата;
//   6. `DELETE /admin/api/portals/<id>` (старият път) продължава да работи, за да не се
//      счупят скриптове и тестове, които разчитат на него.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const DAY = 86400000;

const makePortal = async (server, slug, title) => {
  const made = await server.api('/admin/api/portals', 'POST', { slug, title, visibility: 'public' });
  assert.equal(made.status, 201, 'порталът се създава: ' + JSON.stringify(made.data));
  return made.data;
};

const upload = async (server, portalId, name, text) => {
  const res = await fetch(server.base + `/admin/api/portals/${portalId}/files`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + server.token,
      'X-File-Name': encodeURIComponent(name),
      'Content-Type': 'application/octet-stream',
    },
    body: Buffer.from(text, 'utf8'),
  });
  const data = await res.json().catch(() => null);
  assert.equal(res.status, 201, 'файлът се качва: ' + JSON.stringify(data));
  return data;
};

(async () => {
  const server = await startServer({ keepData: true });
  let second = null;
  try {
    const portal = await makePortal(server, 'archive-me', 'Портал за закриване');
    const file = await upload(server, portal.id, 'договор-2026.txt', 'съдържание, което трябва да оцелее');

    const live = await fetch(server.base + '/p/' + portal.id);
    await live.text();
    assert.equal(live.status, 200, 'преди закриването адресът на портала се отваря');

    // ── 1. Закриване ──────────────────────────────────────────────────────────
    const closed = await server.api(`/admin/api/portals/${portal.id}/close`, 'POST');
    assert.equal(closed.status, 200, 'закриването минава: ' + JSON.stringify(closed.data));
    assert.equal(closed.data.retentionDays, 183, 'срокът по подразбиране е 6 месеца (183 дни)');
    assert.equal(closed.data.files, 1, 'в архива влиза един файл');
    const days = Math.round((Date.parse(closed.data.purgeAfter) - Date.now()) / DAY);
    assert.ok(days >= 182 && days <= 183, 'изтриването е след 6 месеца, а е след ' + days + ' дни');
    assert.equal(closed.data.daysLeft, 183, 'остават 183 дни');

    // Изчезва от активните, появява се в архива.
    const active = await server.api('/admin/api/portals');
    assert.equal(active.data.portals.some((x) => x.id === portal.id), false, 'закритият портал не е в активния списък');
    const archive = await server.api('/admin/api/portals/archive');
    assert.equal(archive.status, 200, 'списъкът на затворените се чете');
    const entry = archive.data.portals.find((x) => x.id === portal.id);
    assert.ok(entry, 'порталът е в „Затворени портали“');
    assert.equal(entry.title, 'Портал за закриване');
    assert.equal(entry.slug, 'archive-me');

    // ── 2. Данните са в системата за съхранение, не са изтрити ────────────────
    const archivedDir = path.join(server.dir, 'archives', 'closed', portal.id);
    assert.ok(fs.existsSync(path.join(archivedDir, 'portal.json')), 'записът на портала е в архива');
    const snapshot = JSON.parse(fs.readFileSync(path.join(archivedDir, 'portal.json'), 'utf8'));
    assert.equal(snapshot.record.id, portal.id, 'снимката съдържа целия запис');
    assert.equal(snapshot.record.files.length, 1, 'снимката пази и файловете');
    assert.ok(fs.existsSync(path.join(archivedDir, 'files')), 'файловете са преместени в архива');
    assert.equal(
      fs.existsSync(path.join(server.dir, 'files', portal.id)),
      false,
      'работната папка на портала е освободена — иначе „закрит“ не значи нищо',
    );
    assert.ok(
      fs.existsSync(path.join(archivedDir, 'files', file.id)),
      'байтовете на файла са в архива под същото id',
    );

    // ── 3. Адресът казва, че порталът е закрит ───────────────────────────────
    const gone = await fetch(server.base + '/p/' + portal.id);
    const goneBody = await gone.text();
    assert.equal(gone.status, 410, 'закритият портал отговаря 410, не 404 и не 200');
    assert.match(goneBody, /Порталът е закрит/, 'страницата казва, че порталът е закрит');
    const goneBySlug = await fetch(server.base + '/p/archive-me');
    await goneBySlug.text();
    assert.equal(goneBySlug.status, 410, 'и по slug, не само по id');

    // ── 4. Връщане ────────────────────────────────────────────────────────────
    const back = await server.api(`/admin/api/portals/archive/${portal.id}/restore`, 'POST');
    assert.equal(back.status, 200, 'връщането минава: ' + JSON.stringify(back.data));
    const active2 = await server.api('/admin/api/portals');
    const restored = active2.data.portals.find((x) => x.id === portal.id);
    assert.ok(restored, 'порталът се връща в активния списък');
    assert.equal(restored.files.length, 1, 'файлът се връща заедно с портала');
    const after = await fetch(server.base + '/p/' + portal.id);
    await after.text();
    assert.equal(after.status, 200, 'адресът отново се отваря');
    assert.equal(fs.existsSync(archivedDir), false, 'архивната папка е премахната след връщането');
    const archive2 = await server.api('/admin/api/portals/archive');
    assert.equal(archive2.data.portals.some((x) => x.id === portal.id), false, 'и не е в „Затворени портали“');

    // ── 5. Изтекъл срок → окончателно изтриване ──────────────────────────────
    // Срокът се задава от средата; нула значи „изтече веднага“, тоест проверява се същият
    // код, който при човека работи след 6 месеца — без да се подправя дата в базата.
    second = await startServer({ env: { HAPI_PORTAL_RETENTION_DAYS: '0' } });
    const shortLived = await makePortal(second, 'short-lived', 'Портал с нулев срок');
    await upload(second, shortLived.id, 'кратко.txt', 'за изтриване');
    const closedShort = await second.api(`/admin/api/portals/${shortLived.id}/close`, 'POST');
    assert.equal(closedShort.status, 200, 'закриването минава и с нулев срок');
    assert.equal(closedShort.data.retentionDays, 0, 'срокът идва от средата');
    const shortDir = path.join(second.dir, 'archives', 'closed', shortLived.id);
    assert.ok(fs.existsSync(shortDir), 'първо отива в архива');
    const purged = await second.api('/admin/api/portals/archive');
    assert.equal(purged.status, 200);
    assert.ok(purged.data.purged.includes(shortLived.id), 'изтеклият срок се изтрива при първото четене');
    assert.equal(purged.data.portals.some((x) => x.id === shortLived.id), false, 'и изчезва от списъка');
    assert.equal(fs.existsSync(shortDir), false, 'архивът е изтрит от диска');
    const goneShort = await fetch(second.base + '/p/' + shortLived.id);
    await goneShort.text();
    assert.equal(goneShort.status, 404, 'след изтриването адресът вече е 404, а не 410');

    // ── 6. Старият DELETE остава ─────────────────────────────────────────────
    const third = await makePortal(second, 'plain-delete', 'Портал за директно изтриване');
    const del = await second.api(`/admin/api/portals/${third.id}`, 'DELETE');
    assert.equal(del.status, 200, 'DELETE /admin/api/portals/<id> още работи');
    assert.equal(del.data.deleted, third.id);
    const listThird = await second.api('/admin/api/portals');
    assert.equal(listThird.data.portals.some((x) => x.id === third.id), false, 'и порталът го няма');

    console.log('PASS portal-archive: закриване → архив (файлове + запис) → 410 на адреса → връщане → изтриване след срока · 183 дни по подразбиране');
  } finally {
    await server.stop({ keep: false });
    if (second) await second.stop({ keep: false });
  }
})().catch((error) => {
  console.error('FAIL portal-archive:', error && error.message ? error.message : error);
  process.exitCode = 1;
});
