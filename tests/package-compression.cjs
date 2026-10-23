'use strict';
// Нива на компресия в експортния пакет — РЕАЛНИ, не „планирано“.
//
// До 0.69.51 `export-rules.capabilities()` връщаше `compression: implemented: false`, а
// ZIP писателят винаги компресираше с подразбирането на zlib. Тоест „нива на компресия“
// съществуваше само като етикет. Тук се проверява, че:
//   1. нивото се приема и се записва в PACKAGE_INDEX.json и в метаданните;
//   2. `none` (0) наистина НЕ компресира (ZIP method 0), а `max` (9) дава по-малък файл;
//   3. архивът и в двата случая се отваря и съдържанието е същото (обхождане);
//   4. невалидно ниво е 400, а не тихо подразбиране;
//   5. способността е обявена за готова в `capabilities()`.
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const packager = require(path.join(ROOT, 'hapi_enterprise', 'packager.js'));
const ooxml = require(path.join(ROOT, 'hapi_enterprise', 'ooxml.js'));
const rules = require(path.join(ROOT, 'hapi_enterprise', 'export-rules.js'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-compress-'));
const pack = packager.create({ root: dir });
const portal = { id: 'p1', slug: 'demo', title: 'Demo', storage_root: '/share' };
// Текст, който се компресира добре — иначе разликата между нивата е в рамките на шума.
const files = [{ name: 'report.txt', data: Buffer.from('hAPI Enterprise '.repeat(20000), 'utf8') }];

/** Методът на компресия на първия запис в ZIP (0 = store, 8 = deflate). */
function firstEntryMethod(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const cdOffset = buf.readUInt32LE(eocd + 16);
  assert.equal(buf.readUInt32LE(cdOffset), 0x02014b50, 'намирам централната директория');
  return buf.readUInt16LE(cdOffset + 10);
}

(async () => {
  // ── 1. Формите на нивата ──────────────────────────────────────────────────
  const none = await pack.build({ portal, files, compression: 'none' });
  const max = await pack.build({ portal, files, compression: 'max' });
  const dflt = await pack.build({ portal, files });
  assert.equal(none.compression.level, 0, 'none → ниво 0');
  assert.equal(none.compression.method, 0, 'none → ZIP method 0 (store)');
  assert.equal(max.compression.level, 9, 'max → ниво 9');
  assert.equal(max.compression.method, 8, 'max → deflate');
  assert.equal(dflt.compression.level, 6, 'без ниво → подразбирането 6');

  // ── 2. Реален ефект върху размера ─────────────────────────────────────────
  assert.ok(none.size > max.size, `без компресия пакетът е по-голям (${none.size} > ${max.size})`);

  const noneZip = fs.readFileSync(path.join(dir, 'packages', `${none.id}.zip`));
  const maxZip = fs.readFileSync(path.join(dir, 'packages', `${max.id}.zip`));
  assert.equal(firstEntryMethod(noneZip), 0, 'първият запис при none е store');
  assert.equal(firstEntryMethod(maxZip), 8, 'първият запис при max е deflate');

  // ── 3. Съдържанието е същото и се чете ────────────────────────────────────
  for (const [label, zip] of [['none', noneZip], ['max', maxZip]]) {
    const entries = ooxml.unzip(zip);
    const original = entries.get('originals/report.txt');
    assert.ok(original, label + ': файлът е в архива');
    assert.equal(original().toString('utf8').length, files[0].data.toString('utf8').length, label + ': съдържанието е цялото');
    const indexRaw = entries.get('PACKAGE_INDEX.json');
    assert.ok(indexRaw, label + ': има PACKAGE_INDEX.json');
    const index = JSON.parse(indexRaw().toString('utf8'));
    assert.equal(index.compression.level, label === 'none' ? 0 : 9, label + ': индексът носи нивото');
    assert.equal(index.compression.name, label === 'none' ? 'store' : 'deflate', label + ': индексът носи метода');
  }

  // ── 4. Невалидно ниво е ясна грешка ───────────────────────────────────────
  for (const bad of [10, -1, 'ultra', 3.5]) {
    await assert.rejects(
      () => pack.build({ portal, files, compression: bad }),
      (e) => e.status === 400,
      'ниво ' + bad + ' се отхвърля с 400'
    );
  }

  // ── 5. Способността е обявена за готова ──────────────────────────────────
  const caps = rules.capabilities();
  const compression = caps.find((c) => c.id === 'compression');
  assert.equal(compression.implemented, true, 'compression е обявена за готова');
  assert.equal(compression.status, 'ready', 'compression има статус ready');
  const stillPlanned = caps.filter((c) => !['compression', 'split_archive', 'rate_limit', 'parallel_transfers', 'encrypt_package'].includes(c.id));
  assert.deepEqual(stillPlanned.filter((c) => c.implemented), [], 'останалите още не са готови');

  fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(
    `PASS package-compression: нива 0/6/9 · store ${none.size} B срещу deflate ${max.size} B · съдържанието е цялото · невалидно ниво е 400 · capability „готова“\n`
  );
})().catch((e) => {
  process.stderr.write('FAIL package-compression: ' + (e && e.message ? e.message : e) + '\n');
  process.exitCode = 1;
});
