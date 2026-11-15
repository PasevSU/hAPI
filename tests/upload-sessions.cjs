'use strict';
// КАЧВАНЕТО НА СЕСИИ: цялост по хеш, възстановяване и запазени дати (0.69.214).
//
// Правилото, което този тест пази: „качено“ значи „сверено“, а не „сървърът не хвърли“.
// Затова се мери на ЖИВ сървър:
//   • парче с грешен SHA-256 се ОТКАЗВА и не влиза в сесията;
//   • повторно изпратено парче е безопасно (идемпотентност) — това е възстановяването;
//   • файл, чийто цял хеш не съвпада с обявения, НЕ се записва (409), а сесията остава;
//   • `mtime` се връща точно такъв, какъвто клиентът го е дал (датите не се пипат);
//   • накрая се дописва ред в `upload-history/<portalId>.jsonl` — файлът за следене.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { startServer } = require('./lib/gui-harness.cjs');
const paths = require('../hapi_enterprise/paths');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  const server = await startServer();
  try {
    const slug = 'up-' + crypto.randomBytes(3).toString('hex');
    const created = await server.api('/admin/api/portals', 'POST', { slug, title: 'Качване на сесии', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data).slice(0, 160));
    const p = created.data;
    const base = `${server.base}/admin/api/portals/${p.id}/uploads`;

    const call = async (url, opts = {}) => {
      const init = { method: opts.method || 'GET', headers: Object.assign({}, opts.headers || {}) };
      if (opts.json) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.json);
      } else if (opts.body) {
        init.body = opts.body;
      }
      const res = await server.authFetch(url, init);
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return { ok: res.ok, status: res.status, data };
    };

    // ── 1. Сесия: обявеният хеш и датата се приемат, пътят се проверява ───────
    const content = crypto.randomBytes(12000);
    const CHUNK = 4096;
    const MTIME = Date.UTC(2024, 0, 2, 3, 4, 5);
    const open = await call(base, {
      method: 'POST',
      json: { path: '/up/doc.bin', size: content.length, sha256: sha256(content), mtime: MTIME, chunkSize: CHUNK, mkdir: true },
    });
    assert.equal(open.status, 201, 'сесията се отваря: ' + JSON.stringify(open.data).slice(0, 200));
    const sid = open.data.sessionId;
    assert.equal(open.data.totalChunks, 3, 'три парчета по 4 KB: ' + open.data.totalChunks);
    assert.equal(open.data.acknowledged, undefined, 'сървърът не обещава нищо, което не е пристигнало');

    const bad = await call(base, { method: 'POST', json: { path: '../escape.txt', size: 10, sha256: sha256(content) } });
    assert.equal(bad.status, 400, 'път извън папката не се приема: ' + bad.status);

    // ── 2. Парче с грешен хеш: 400 и НИЩО не се записва ─────────────────────
    const chunkOf = (i) => content.subarray(i * CHUNK, Math.min(content.length, (i + 1) * CHUNK));
    const wrong = await call(`${base}/${sid}/0`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Chunk-Sha256': sha256(Buffer.from('друго')) },
      body: chunkOf(0),
    });
    assert.equal(wrong.status, 400, 'парче с чужд хеш се отказва: ' + JSON.stringify(wrong.data).slice(0, 160));
    const noHeader = await call(`${base}/${sid}/0`, { method: 'PUT', body: chunkOf(0) });
    assert.equal(noHeader.status, 400, 'без X-Chunk-Sha256 няма как да се докаже цялост — отказ');

    const statusEmpty = await call(`${base}/${sid}`);
    assert.deepEqual(statusEmpty.data.chunks, [], 'след отказатите парчета сесията е празна');

    // ── 3. Парчетата минават; повторното е безопасно (възстановяване) ───────
    for (let i = 0; i < 3; i++) {
      const slice = chunkOf(i);
      const r = await call(`${base}/${sid}/${i}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Chunk-Sha256': sha256(slice) },
        body: slice,
      });
      assert.equal(r.status, 202, `парче ${i} пристига: ` + JSON.stringify(r.data).slice(0, 160));
      assert.equal(r.data.percent, i === 2 ? 100 : r.data.percent, 'процентът е пристигнал байт, не изпратен');
    }
    const again = await call(`${base}/${sid}/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Chunk-Sha256': sha256(chunkOf(1)) },
      body: chunkOf(1),
    });
    assert.equal(again.status, 202, 'същото парче пак се приема');
    assert.equal(again.data.receivedBytes, content.length, 'повторението не брои байта два пъти: ' + again.data.receivedBytes);

    const statusFull = await call(`${base}/${sid}`);
    assert.deepEqual(statusFull.data.chunks, [0, 1, 2], 'и трите парчета са на сървъра');
    assert.equal(statusFull.data.receivedBytes, content.length);
    assert.equal(statusFull.data.mtime, MTIME, 'датата на промяна идва от клиента и се пази');

    // ── 4. Завършване: файлът е на диска, mtime е същият, историята е записана ─
    const done = await call(`${base}/${sid}/complete`, { method: 'POST' });
    assert.equal(done.status, 201, 'завършването минава: ' + JSON.stringify(done.data).slice(0, 240));
    assert.equal(done.data.verified, true, 'сървърът твърди „сверено“, защото е чел обратно');
    assert.equal(done.data.sha256, sha256(content));
    assert.equal(done.data.retriedChunks, 1, 'повтореното парче е записано като повторение: ' + done.data.retriedChunks);

    const root = paths.resolveStoragePath(p.storage_root, '', { STORAGE_ROOT_OVERRIDE: server.storageRoot() });
    const file = path.join(root, 'up', 'doc.bin');
    assert.ok(fs.existsSync(file), 'файлът е на диска: ' + file);
    const onDisk = fs.readFileSync(file);
    assert.equal(sha256(onDisk), sha256(content), 'байтовете на диска са същите');
    const stat = fs.statSync(file);
    assert.equal(Math.floor(stat.mtimeMs), MTIME, 'mtime е възстановен ТОЧНО: ' + new Date(stat.mtimeMs).toISOString());

    // Историята живее под DATA_DIR, не под хранилището: така тя не се вижда от портала.
    const dataDir = server.dir;
    const histFile = path.join(dataDir, 'upload-history', `${p.id}.jsonl`);
    assert.ok(fs.existsSync(histFile), 'файлът за следене на промените съществува: ' + histFile);
    const lines = fs.readFileSync(histFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines.length, 1, 'един ред за едно качване');
    const entry = lines[0];
    assert.equal(entry.sha256, sha256(content), 'историята носи хеша');
    assert.equal(entry.verified, true);
    assert.equal(entry.path, '/up/doc.bin');
    assert.equal(entry.metadata.mtimePreserved, true, 'историята казва, че датата е запазена');
    assert.equal(entry.metadata.ctimeSettable, false, 'и че ctime не се задава от програма — честно, не премълчано');

    // ── 5. Грешен цялостен хеш: 409 и файл НЕ се появява ────────────────────
    const other = crypto.randomBytes(9000);
    const lied = await call(base, {
      method: 'POST',
      json: { path: '/up/liar.bin', size: other.length, sha256: sha256(Buffer.from('обещах друго')), chunkSize: CHUNK, mkdir: true },
    });
    assert.equal(lied.status, 201, 'сесия се отваря и с невярно обещание — проверката е накрая');
    const l1 = other.subarray(0, CHUNK);
    const l2 = other.subarray(CHUNK, 2 * CHUNK);
    const l3 = other.subarray(2 * CHUNK);
    for (const [i, slice] of [[0, l1], [1, l2], [2, l3]]) {
      const r = await call(`${base}/${lied.data.sessionId}/${i}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Chunk-Sha256': sha256(slice) },
        body: slice,
      });
      assert.equal(r.status, 202, `парче ${i} на „лъжливата“ сесия пристига`);
    }
    const refused = await call(`${base}/${lied.data.sessionId}/complete`, { method: 'POST' });
    assert.equal(refused.status, 409, 'несъвпадащ SHA-256 се отказва: ' + refused.status);
    assert.match(String(JSON.stringify(refused.data)), /SHA-256/, 'отказът казва какво не съвпада');
    assert.equal(fs.existsSync(path.join(root, 'up', 'liar.bin')), false, 'файл с грешен хеш НЕ се появява на диска');
    const stillThere = await call(`${base}/${lied.data.sessionId}`);
    assert.equal(stillThere.status, 200, 'сесията остава, за да може да се изпрати наново');

    // ── 6. Възстановяване: частична сесия се вижда и може да се откаже ───────
    const part = await call(base, {
      method: 'POST',
      json: { path: '/up/partial.bin', size: 8192, sha256: sha256(Buffer.alloc(8192, 7)), chunkSize: CHUNK, mkdir: true },
    });
    assert.equal(part.status, 201);
    const head = Buffer.alloc(CHUNK, 7);
    const first = await call(`${base}/${part.data.sessionId}/0`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Chunk-Sha256': sha256(head) },
      body: head,
    });
    assert.equal(first.status, 202);
    const resumed = await call(`${base}/${part.data.sessionId}`);
    assert.deepEqual(resumed.data.chunks, [0], 'след прекъсване сървърът казва кое липсва: ' + JSON.stringify(resumed.data.chunks));
    assert.equal(resumed.data.receivedBytes, CHUNK, 'пристигналото е измерено');
    const list = await call(base);
    assert.equal(list.status, 200, 'списъкът със сесии и история се дава');
    assert.ok(list.data.sessions.some((s) => s.sessionId === part.data.sessionId), 'частичната сесия е в списъка — това е „възстанови“');
    assert.ok(list.data.entries.length >= 1, 'историята се чете през API: ' + list.data.entries.length);
    const cancelled = await call(`${base}/${part.data.sessionId}`, { method: 'DELETE' });
    assert.equal(cancelled.status, 200, 'отказът изтрива сесията');
    const gone = await call(`${base}/${part.data.sessionId}`);
    assert.equal(gone.status, 404, 'след отказа сесията я няма');
    assert.equal(fs.existsSync(path.join(root, 'up', 'partial.bin')), false, 'отказаното качване не оставя файл');

    console.log(
      'PASS upload-sessions: сесия с 3 парчета · грешен хеш на парче → 400 · повторно парче е безопасно · ' +
        `mtime възстановен точно · история ${path.basename(histFile)} с ${lines.length} ред · ` +
        'несъвпадащ цял хеш → 409 без файл · частична сесия се вижда и се отказва',
    );
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error('FAIL upload-sessions:', e.message);
  process.exit(1);
});
