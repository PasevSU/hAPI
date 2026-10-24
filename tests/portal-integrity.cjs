'use strict';
// 0.69.79 — целостта на физическите архиви (правило `ARCHIVE_NOT_TAMPERED`).
//
// Проверява се НАЙ-ВАЖНОТО за доказателството: че подмяна на байтове се вижда без човешка
// сверка. Три нива:
//   • модулът — всеки вид повреда има СВОЙ код (`file_missing`, `archive_hash_mismatch`,
//     `manifest_missing`, `file_hash_mismatch`), а не едно общо „счупено“;
//   • сървърът — `POST …/qr/verify` пише резултата в метаданните и в одитната верига;
//   • сензорите — `qr.integrity.failures` стига до Home Assistant (`integrity_failed`).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const integrity = require('../hapi_enterprise/portal-integrity');
const ooxml = require('../hapi_enterprise/ooxml');

const shareRoot = path.resolve('/share');
const cleaned = [];

/** ZIP с манифест, който твърди какво има вътре (за да могат да се правят „повреди“). */
function buildZip({ manifest, files }) {
  const entries = [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest), 'utf8') }];
  for (const [name, data] of Object.entries(files)) entries.push({ name: 'files/' + name, data });
  return ooxml.zip(entries);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-integrity-'));
  try {
    // ── 1. Модулът: всеки вид повреда има собствен код ───────────────────────
    console.log('· модулът различава липсващ файл, сменени байтове и счупен манифест');
    {
      const dir = path.join(tmp, 'unit');
      fs.mkdirSync(dir, { recursive: true });
      const good = Buffer.from('документ');
      const sha = integrity.sha256(good);
      const manifest = { files: [{ path: 'a.txt', sha256: sha, size_bytes: good.length }] };

      // 1а. Файлът на диска липсва.
      const missing = await integrity.verifyArchive({ archive: { id: 'AR-001', qrId: 'QR-001', file: 'none.zip' }, dir, revision: null });
      assert.equal(missing.ok, false);
      assert.equal(missing.reason, 'file_missing', 'липсващ архив → file_missing');

      // 1б. Байтовете са сменени след записа (най-важната повреда: подмяна).
      const zip = buildZip({ manifest, files: { 'a.txt': good } });
      fs.writeFileSync(path.join(dir, 'tampered.zip'), Buffer.concat([zip, Buffer.from('x')]));
      const tampered = await integrity.verifyArchive({
        archive: { id: 'AR-002', qrId: 'QR-001', file: 'tampered.zip', sha256: integrity.sha256(zip) }, dir, revision: null,
      });
      assert.equal(tampered.reason, 'archive_hash_mismatch', 'добавен байт → archive_hash_mismatch');
      assert.equal(tampered.expected, integrity.sha256(zip));
      assert.notEqual(tampered.actual, tampered.expected, 'разликата е показана с два хеша');

      // 1в. ZIP без манифест — файлът е „валиден“, но не доказва нищо.
      const noManifest = ooxml.zip([{ name: 'files/a.txt', data: good }]);
      fs.writeFileSync(path.join(dir, 'nomanifest.zip'), noManifest);
      const bare = await integrity.verifyArchive({ archive: { id: 'AR-003', qrId: 'QR-001', file: 'nomanifest.zip' }, dir, revision: null });
      assert.equal(bare.reason, 'manifest_missing', 'без manifest.json → manifest_missing');

      // 1г. Манифестът твърди друг хеш на файла вътре → файлът е сменен В архива.
      const wrong = { files: [{ path: 'a.txt', sha256: 'f'.repeat(64), size_bytes: good.length }] };
      fs.writeFileSync(path.join(dir, 'wrongfile.zip'), buildZip({ manifest: wrong, files: { 'a.txt': good } }));
      const inner = await integrity.verifyArchive({ archive: { id: 'AR-004', qrId: 'QR-001', file: 'wrongfile.zip' }, dir, revision: null });
      assert.equal(inner.reason, 'file_hash_mismatch', 'сменен файл в архива → file_hash_mismatch');
      assert.equal(inner.detail, 'a.txt', 'посочва КОЙ файл не съвпада');

      // 1д. Здрав архив минава.
      const zipped = buildZip({ manifest, files: { 'a.txt': good } });
      fs.writeFileSync(path.join(dir, 'ok.zip'), zipped);
      const ok = await integrity.verifyArchive({
        archive: { id: 'AR-005', qrId: 'QR-001', file: 'ok.zip', sha256: integrity.sha256(zipped) }, dir, revision: null,
      });
      assert.equal(ok.ok, true, 'здравият архив минава');
      assert.equal(ok.files, 1);

      // 1е. Интервалът: по подразбиране 6 часа, `0` изключва, боклук пада към 6 часа.
      assert.equal(integrity.intervalMs({}), 6 * 60 * 60 * 1000, 'по подразбиране 6 часа');
      assert.equal(integrity.intervalMs({ HAPI_INTEGRITY_INTERVAL_MS: '0' }), 0, 'нула изключва');
      assert.equal(integrity.intervalMs({ HAPI_INTEGRITY_INTERVAL_MS: 'abc' }), 6 * 60 * 60 * 1000, 'боклук → 6 часа');
      assert.equal(integrity.schedule(() => { }, 0), null, 'при 0 няма таймер');
      assert.equal(integrity.stats({}).failures, 0);
      assert.equal(integrity.read({}, 'x').checkedAt, null, 'непознат портал няма проверка');
    }

    // ── 2. Сървърът: проверка по заявка, запис и одит ────────────────────────
    const server = await startServer();
    try {
      const api = (p, method = 'GET', body) => server.authFetch(server.base + p, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const jsonOf = async (p, method, body) => {
        const res = await api(p, method, body);
        const text = await res.text();
        let data;
        try { data = text ? JSON.parse(text) : null } catch { data = text }
        return { status: res.status, data };
      };

      const slug = 'integrity-' + Date.now().toString(36);
      const portal = (await jsonOf('/admin/api/portals', 'POST', { slug, title: 'Целост', visibility: 'public' })).data;
      cleaned.push(portal.slug);
      const folder = path.join(shareRoot, slug);
      fs.mkdirSync(path.join(folder, 'тема'), { recursive: true });
      fs.writeFileSync(path.join(folder, 'договор.txt'), 'първи документ');
      fs.writeFileSync(path.join(folder, 'тема', 'фактура.txt'), 'втори документ');

      const made = await jsonOf(`/admin/api/portals/${portal.id}/qr/archive`, 'POST', { note: 'първи печат' });
      assert.equal(made.status, 201, 'архивът се създава');
      const archive = made.data.archive;
      const archiveFile = path.join(server.dir, 'archives', portal.id, archive.file);
      assert.ok(fs.existsSync(archiveFile), 'архивът е РЕАЛЕН файл на диска');

      console.log('· GET /qr носи последната проверка (преди първата: null)');
      {
        const state = await jsonOf(`/admin/api/portals/${portal.id}/qr`);
        assert.equal(state.data.integrity.ok, null, 'още няма проверка');
        assert.equal(state.data.integrity.checkedAt, null);
      }

      console.log('· POST /qr/verify проверява байтовете, манифеста и файловете вътре');
      {
        const first = await jsonOf(`/admin/api/portals/${portal.id}/qr/verify`, 'POST');
        assert.equal(first.status, 200, 'проверката минава');
        assert.equal(first.data.ok, true, 'здравият архив е ok');
        assert.equal(first.data.archives, 1);
        assert.equal(first.data.verified, 1);
        assert.deepEqual(first.data.failed, []);
        assert.ok(first.data.checkedAt, 'има време на проверката');

        const state = await jsonOf(`/admin/api/portals/${portal.id}/qr`);
        assert.equal(state.data.integrity.ok, true, 'резултатът е записан в метаданните');
        assert.ok(state.data.integrity.checkedAt, 'и времето е записано');
      }

      console.log('· сензорите виждат проверката (qr.integrity + integrity_failed)');
      {
        const sensors = (await jsonOf('/admin/api/sensors')).data;
        assert.ok(sensors.qr.integrity, 'сензорите носят блок `integrity`');
        assert.equal(sensors.qr.integrity.failures, 0);
        assert.equal(sensors.qr.integrity.checked, 1, 'един портал е проверен');
        assert.equal(sensors.qr.integrity.code, 'ARCHIVE_NOT_TAMPERED', 'правилото е названо');
        assert.equal(sensors.qr.integrity.intervalMs, 21600000, 'фоновата проверка е на 6 часа');
        assert.equal(sensors.qr.archives, 1, 'старият блок `qr` не е счупен');
      }

      console.log('· подменен байт в архива се хваща и стига до сензора');
      {
        const bytes = fs.readFileSync(archiveFile);
        fs.writeFileSync(archiveFile, Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from('!')]));
        const broken = await jsonOf(`/admin/api/portals/${portal.id}/qr/verify`, 'POST');
        assert.equal(broken.data.ok, false, 'подмяната НЕ минава');
        assert.equal(broken.data.failed.length, 1);
        assert.equal(broken.data.failed[0].reason, 'archive_hash_mismatch', 'кодът е точен');
        assert.equal(broken.data.failed[0].id, archive.id, 'посочва КОЙ архив');
        const sensors = (await jsonOf('/admin/api/sensors')).data;
        assert.equal(sensors.qr.integrity.failures, 1, 'сензорът вижда провала');
        assert.equal(sensors.qr.integrity.portalsFailed, 1);
      }

      console.log('· изтрит архивен файл също се вижда (file_missing)');
      {
        fs.rmSync(archiveFile, { force: true });
        const gone = await jsonOf(`/admin/api/portals/${portal.id}/qr/verify`, 'POST');
        assert.equal(gone.data.ok, false);
        assert.equal(gone.data.failed[0].reason, 'file_missing', 'липсващият файл е отделен код');
        // Събитието остава в одитната верига — иначе провалът се вижда само на екрана.
        const auditRes = await api('/admin/api/audit?limit=200');
        const text = await auditRes.text();
        assert.match(text, /integrity\.failed/, 'одитът пази `integrity.failed`');
      }

      console.log('PASS portal-integrity: байтове · манифест · файлове вътре · запис · одит · сензор');
    } finally {
      await server.stop().catch(() => { });
    }
  } finally {
    for (const name of cleaned) {
      try { fs.rmSync(path.join(shareRoot, name), { recursive: true, force: true }) } catch { /* Linux */ }
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* Windows */ }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
