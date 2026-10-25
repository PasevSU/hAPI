'use strict';
// ПРЕМЕСТВАНЕ И КОПИРАНЕ МЕЖДУ ПОРТАЛИ (F2-10 / F2-11) — с жив сървър.
//
// Договорът, който се проверява:
//   1. копие в друг портал носи СЪЩИТЕ байтове (същият `sha256`) и РАЗЛИЧЕН `contentId`,
//      защото `content_id` съдържа `portalId` — два портала не бива да сочат един идентификатор;
//   2. „премести“ маха файла от източника само след успешен запис при целта;
//   3. отказите са с причина и код: същият портал → 400, заключен файл → 409, файл с версии
//      → 409, доказателство (в манифест на QR) → 409 при „премести“ и РАЗРЕШЕНО при „копирай“.
//
// Последното е същото правило като при задържането (`EVIDENCE_NEVER_DELETED`), но погледнато
// от другия вход: там триеше политиката, тук трие човек с бутон.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-transfer-'));
  const port = await freePort();
  const token = 'file-transfer-token-at-least-24-chars';
  const child = spawn(process.execPath, [path.join(ROOT, 'hapi_enterprise', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: token },
    cwd: dir,
    stdio: 'ignore',
  });
  // `/share` се резолвва спрямо диска на работната папка на сървъра (тя е `dir`), затова
  // тестът гледа същия корен, вместо да гадае къде отива папката на портала.
  const shareRoot = path.join(path.parse(dir).root, 'share');
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
  const json = (p, method, body) => call(p, method, JSON.stringify(body), { 'Content-Type': 'application/json' });
  const upload = (portalId, name, data) => call(`/admin/api/portals/${portalId}/files`, 'POST', data, { 'X-File-Name': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' });
  const filesOf = async (portalId) => (await call(`/admin/api/portals/${portalId}`)).value.files || [];
  const transfer = (portalId, fileId, mode, targetPortalId) => json(`/admin/api/portals/${portalId}/files/${fileId}/transfer`, 'POST', { mode, targetPortalId });

  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await call('/health')).status === 200) { ready = true; break } } catch { /* сървърът още пали */ }
      await new Promise((r) => setTimeout(r, 30));
    }
    assert(ready, 'сървърът трябва да стартира');

    step = 'два портала и файл';
    const A = (await json('/admin/api/portals', 'POST', { slug: 'iztochnik', title: 'Източник' })).value;
    const B = (await json('/admin/api/portals', 'POST', { slug: 'cel', title: 'Цел' })).value;
    assert.ok(A.id && B.id, 'двата портала са създадени');
    // Папката на портала по подразбиране е `/share/<slug>` — там се архивира QR.
    const folderA = path.join(shareRoot, A.slug);
    fs.mkdirSync(folderA, { recursive: true });
    const body = Buffer.from('съдържание на документа, което трябва да оцелее при прехвърляне', 'utf8');
    const src = (await upload(A.id, 'документ.txt', body)).value;
    assert.ok(src.id, 'файлът е качен в източника');

    // ── 1. Копиране ────────────────────────────────────────────────────────────
    step = 'копиране';
    const copied = await transfer(A.id, src.id, 'copy', B.id);
    assert.equal(copied.status, 201, 'копирането е успешно: ' + JSON.stringify(copied.value));
    assert.equal(copied.value.verified, true, 'копието е сверено по SHA-256');
    assert.equal(copied.value.source.removed, false, 'при копиране източникът остава');
    assert.equal(copied.value.sha256, src.sha256, 'байтовете са същите (един и същ SHA-256)');
    assert.notEqual(copied.value.contentId, src.contentId, '`content_id` е различен: съдържа `portalId`');
    const copyId = copied.value.target.fileId;
    assert.notEqual(copyId, src.id, 'копието е нов запис, не същият идентификатор');

    const stillA = await filesOf(A.id);
    assert.ok(stillA.some((f) => f.id === src.id), 'източникът пази файла си');
    const inB = await filesOf(B.id);
    assert.ok(inB.some((f) => f.id === copyId), 'целта има своя запис');
    assert.equal(inB.find((f) => f.id === copyId).sha256, src.sha256, 'регистърът на целта носи същия хеш');

    const fromB = await call(`/admin/api/portals/${B.id}/files/${copyId}/download`);
    assert.equal(fromB.status, 200, 'копието се тегли от целта');
    assert.equal(sha256(Buffer.from(fromB.value)), src.sha256, 'байтовете на копието съвпадат с оригинала');

    // ── 2. Отказите имат код и причина ─────────────────────────────────────────
    step = 'откази';
    assert.equal((await transfer(A.id, src.id, 'copy', A.id)).status, 400, 'същият портал → 400');
    assert.equal((await transfer(A.id, src.id, 'duplicate', B.id)).status, 400, 'непознат режим → 400');
    assert.equal((await transfer(A.id, src.id, 'copy', 'ffffffffffffffffffffffff')).status, 404, 'непозната цел → 404');
    assert.equal((await transfer(A.id, 'ffffffffffffffffffffffff', 'copy', B.id)).status, 404, 'непознат файл → 404');

    // ── 3. Заключен файл не се мести ───────────────────────────────────────────
    step = 'заключен файл';
    await json(`/admin/api/portals/${B.id}/files/${copyId}/lock`, 'PATCH', { locked: true, by: 'тест' });
    const locked = await transfer(B.id, copyId, 'move', A.id);
    assert.equal(locked.status, 409, 'заключен файл → 409');
    assert.match(String(locked.value.error), /Locked/i, 'причината е изписана');
    await json(`/admin/api/portals/${B.id}/files/${copyId}/lock`, 'PATCH', { locked: false });

    // ── 4. Преместване ────────────────────────────────────────────────────────
    step = 'преместване';
    const moved = await transfer(B.id, copyId, 'move', A.id);
    assert.equal(moved.status, 201, 'преместването е успешно: ' + JSON.stringify(moved.value));
    assert.equal(moved.value.source.removed, true, 'при преместване източникът се освобождава');
    assert.equal((await filesOf(B.id)).some((f) => f.id === copyId), false, 'целта вече не пази файла');
    assert.equal((await filesOf(A.id)).some((f) => f.id === moved.value.target.fileId), true, 'файлът е при новия портал');
    const back = await call(`/admin/api/portals/${A.id}/files/${moved.value.target.fileId}/download`);
    assert.equal(sha256(Buffer.from(back.value)), src.sha256, 'байтовете оцеляват при преместването');

    // ── 5. Файл с версии не се мести ──────────────────────────────────────────
    step = 'файл с версии';
    const versioned = (await upload(A.id, 'версии.txt', Buffer.from('първа версия'))).value;
    assert.equal((await call(`/admin/api/portals/${A.id}/files/${versioned.id}/versions`, 'POST', Buffer.from('втора версия'), { 'X-Version-Note': 'v2', 'Content-Type': 'application/octet-stream' })).status, 201);
    const versionedMove = await transfer(A.id, versioned.id, 'move', B.id);
    assert.equal(versionedMove.status, 409, 'файл с версии → 409 (архивът на версиите е под източника)');
    assert.match(String(versionedMove.value.error), /Version/i, 'причината е изписана');

    // ── 6. Доказателство: преместване НЕ, копиране ДА ─────────────────────────
    step = 'доказателство';
    const proof = (await upload(A.id, 'доказателство.txt', Buffer.from('публикувано съдържание'))).value;
    // QR архивът архивира ПАПКАТА на портала; същото съдържание се слага и там, за да влезе
    // в манифеста с онзи `content_id`, който носи записът в регистъра (връзката е по съдържание).
    fs.writeFileSync(path.join(folderA, 'доказателство.txt'), Buffer.from('публикувано съдържание'));
    const archived = await json(`/admin/api/portals/${A.id}/qr/archive`, 'POST', { note: 'преди прехвърляне' });
    assert.equal(archived.status, 201, 'QR архивът е създаден: ' + JSON.stringify(archived.value));
    const proofMove = await transfer(A.id, proof.id, 'move', B.id);
    assert.equal(proofMove.status, 409, 'доказателство не се мести (манифестът твърди какво е публикувано)');
    assert.match(String(proofMove.value.error), /qr-manifest/, 'причината е конкретна, не обща');
    assert.ok((await filesOf(A.id)).some((f) => f.id === proof.id), 'байтовете остават в източника');
    const proofCopy = await transfer(A.id, proof.id, 'copy', B.id);
    assert.equal(proofCopy.status, 201, 'копирането на доказателство е разрешено — оригиналът остава');
    assert.equal(proofCopy.value.sha256, proof.sha256, 'копието е байт по байт');

    // ── 7. Същото правило и при ръчно изтриване през API (не само при политиката) ────
    step = 'ръчно изтриване на доказателство';
    const del = await call(`/admin/api/portals/${A.id}/files/${proof.id}`, 'DELETE');
    assert.equal(del.status, 409, 'файл в манифест не се трие и с бутона „Изтрий“');
    assert.match(String(del.value.error), /qr-manifest/, 'причината е същата като при задръжането');
    assert.ok((await filesOf(A.id)).some((f) => f.id === proof.id), 'записът остава в регистъра');

    // ── 8. Публикувай → качи нова версия → изтрий: публикуваното остава доказателство ──
    step = 'публикувана версия, после нова';
    const newVersion = await call(`/admin/api/portals/${A.id}/files/${proof.id}/versions`, 'POST', Buffer.from('ново съдържание след публикуването'), { 'X-Version-Note': 'v2', 'Content-Type': 'application/octet-stream' });
    assert.equal(newVersion.status, 201, 'новата версия е приета: ' + JSON.stringify(newVersion.value));
    const afterVersion = (await filesOf(A.id)).find((f) => f.id === proof.id);
    assert.equal(afterVersion.version, 2, 'файлът вече е версия 2');
    assert.notEqual(afterVersion.sha256, proof.sha256, 'текущото съдържание е различно от публикуваното');
    const delVersioned = await call(`/admin/api/portals/${A.id}/files/${proof.id}`, 'DELETE');
    assert.equal(delVersioned.status, 409, 'публикуваната версия пази файла дори след нова версия');
    assert.match(String(delVersioned.value.error), /qr-manifest-version/, 'причината сочи историята на файла');
    assert.ok((await filesOf(A.id)).some((f) => f.id === proof.id), 'файлът остава');

    // ── 9. Портал с архивирани QR ревизии не се трие без изрично ?force=1 ──────────
    step = 'изтриване на портал с доказателства';
    const C = (await json('/admin/api/portals', 'POST', { slug: 'treti', title: 'Трети', visibility: 'public' })).value;
    assert.ok(C.id, 'третият портал е създаден');
    fs.mkdirSync(path.join(shareRoot, C.slug), { recursive: true });
    fs.writeFileSync(path.join(shareRoot, C.slug, 'архив.txt'), 'съдържание за QR');
    const archivedC = await json(`/admin/api/portals/${C.id}/qr/archive`, 'POST', { note: 'преди изтриване' });
    assert.equal(archivedC.status, 201, 'QR архивът на третия портал е създаден');
    const plainDelete = await call(`/admin/api/portals/${C.id}`, 'DELETE');
    assert.equal(plainDelete.status, 409, 'портал с архивирани ревизии не се трие „направо“');
    assert.match(String(plainDelete.value.error), /архивирани QR ревизии/, 'причината е изписана');
    assert.ok((await call(`/admin/api/portals/${C.id}`)).value.id, 'порталът е непокътнат след отказа');
    const forced = await call(`/admin/api/portals/${C.id}?force=1`, 'DELETE');
    assert.equal(forced.status, 200, 'с ?force=1 изтриването минава: ' + JSON.stringify(forced.value));
    assert.equal(forced.value.forced, true, 'отчетено е, че е принудително');
    assert.equal(forced.value.purgedArchives, 1, 'архивът също е премахнат — иначе остава сирак');
    assert.equal((await call(`/admin/api/portals/${C.id}`)).status, 404, 'порталът го няма');

    console.log('file-transfer OK: копие с нов content_id · преместване с освобождаване на източника · откази 400/404/409 (заключен · версии · доказателство) · доказателство не се трие и ръчно, и след нова версия · портал с архиви иска ?force=1');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const slug of ['iztochnik', 'cel']) fs.rmSync(path.join(shareRoot, slug), { recursive: true, force: true });
  }
})().catch((e) => {
  console.error('FAILED at step: ' + step);
  console.error(e);
  process.exit(1);
});
