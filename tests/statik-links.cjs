'use strict';
// `/statik/<id>/<име>` — ЛИНКЪТ НА ОТЧЕТА (ADR-0028, стъпка 3).
//
// Защо има тест: линкът е публичен (без токен), тоест това е единственият адрес в add-on-а,
// който дава файл на който и да е. Затова тук се проверява, че:
//   1. линкът работи БЕЗ токен и дава PDF с `attachment` и `noindex` — само за изтегляне;
//   2. името в адреса не участва в намирането на файла (пътят от URL-а не пипа диска);
//   3. непознат, чужд и изтекъл `id` дават 404 — без изброяване и без 403;
//   4. `If-None-Match` дава 304 без тяло, а `HEAD` — заглавки без байтове;
//   5. счупен лист не събаря сървъра: четенето е толерантно (празен списък + предупреждение).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const makePortal = async (server, slug) => {
  const made = await server.api('/admin/api/portals', 'POST', { slug, title: 'Портал с линкове', visibility: 'public' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  return made.data;
};

const upload = async (server, portalId, name, text) => {
  const res = await fetch(server.base + `/admin/api/portals/${portalId}/files`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + server.token, 'X-File-Name': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' },
    body: Buffer.from(text, 'utf8'),
  });
  assert.equal(res.status, 201);
  return res.json();
};

(async () => {
  const server = await startServer({ keepData: true });
  try {
    const portal = await makePortal(server, 'statik-demo');
    await upload(server, portal.id, 'документ.txt', 'съдържание за отчета');
    const built = await server.api('/admin/api/v2/reports/oneclick', 'POST', { portal: portal.id, type: 'portal' });
    assert.equal(built.status, 201, JSON.stringify(built.data));
    const record = built.data;

    // ── 1. Линкът работи без токен и е само за изтегляне ─────────────────────
    const res = await fetch(server.base + record.url);
    assert.equal(res.status, 200, 'линкът се отваря без токен');
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition') || '', /^attachment; filename="report-portal-/, 'файлът се изтегля, не се показва');
    assert.match(res.headers.get('cache-control') || '', /immutable/, 'един id никога не сочи друго съдържание');
    assert.match(res.headers.get('x-robots-tag') || '', /noindex/, 'линкът не влиза в търсачки');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(body.subarray(0, 5).toString('latin1'), '%PDF-', 'тялото е PDF');
    assert.equal(body.length, record.bytes, 'байтовете съвпадат със записа');

    // ── 2. Името в адреса не участва в намирането на файла ───────────────────
    // Същият `id`, но друго име дава СЪЩИЯ файл: пътят от URL-а не се използва за диск.
    const other = await fetch(server.base + '/statik/' + record.id + '/друго-име.pdf');
    assert.equal(other.status, 200, 'името е само за човека');
    assert.equal(Buffer.from(await other.arrayBuffer()).length, record.bytes, 'същият файл, друго име в адреса');

    // ── 3. Непознат и чужд id → 404 (не 403: без изброяване) ────────────────
    const unknown = await fetch(server.base + '/statik/' + 'a'.repeat(32) + '/x.pdf');
    assert.equal(unknown.status, 404, 'непознат id е 404');
    const broken = await fetch(server.base + '/statik/късо/x.pdf');
    assert.equal(broken.status, 404, 'невалиден id е 404');
    const traversal = await fetch(server.base + '/statik/' + record.id + '/../../../db.json');
    assert.equal(traversal.status, 404, 'изход с .. от адреса не стига до диск');

    // ── 4. 304 и HEAD ───────────────────────────────────────────────────────
    const etag = res.headers.get('etag');
    assert.match(etag || '', /^"[A-Za-z0-9_-]{27}"$/, 'ETag е от съдържанието');
    const cached = await fetch(server.base + record.url, { headers: { 'if-none-match': etag } });
    assert.equal(cached.status, 304, 'повторна заявка с етикет не тегли файла');
    assert.equal((await cached.arrayBuffer()).byteLength, 0, '304 е без тяло');
    const head = await fetch(server.base + record.url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get('content-length')), record.bytes, 'HEAD носи дължината');
    assert.equal((await head.arrayBuffer()).byteLength, 0, 'HEAD е без тяло');

    // ── 5. Одитът помни изтеглянето ─────────────────────────────────────────
    const audit = fs.readFileSync(path.join(server.dir, 'audit.jsonl'), 'utf8');
    assert.match(audit, /"statik\.get"/, 'изтеглянето влиза в одита');
    assert.match(audit, /"report\.oneclick"/, 'генерирането влиза в одита');

    // ── 6. Изтекъл запис и счупен лист (проверява се на модула) ─────────────
    const statikIndex = require('../hapi_enterprise/statik-index.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statik-unit-'));
    try {
      let clock = Date.now();
      const index = statikIndex.create({ dir, now: () => clock });
      const id = index.newId();
      index.put(id, Buffer.from('%PDF-1.5 test', 'latin1'));
      index.add({ id, file: 'report.pdf', url: '/statik/' + id + '/report.pdf' });
      assert.ok(index.get(id), 'свежият запис се намира');
      assert.equal(index.list().length, 1);
      // 184 дни по-късно записът е изтекъл: `get` не го дава, а `prune` маха и файла.
      clock += 184 * 24 * 60 * 60 * 1000;
      assert.equal(index.get(id), null, 'изтеклият запис не се сервира');
      assert.equal(index.prune(), 1, 'чистенето маха изтеклия запис');
      assert.equal(fs.existsSync(path.join(dir, id + '.pdf')), false, 'чистенето маха и файла');

      // Счупен лист: четенето е толерантно, а не срив.
      fs.writeFileSync(path.join(dir, 'index.json'), '{ това не е JSON');
      const tolerant = statikIndex.create({ dir });
      assert.deepEqual(tolerant.list(), [], 'счупен лист дава празен списък, без да хвърля');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    console.log('PASS statik-links: линк без токен · attachment + noindex · 404 за чужд/изтекъл · 304 и HEAD · толерантен лист');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
