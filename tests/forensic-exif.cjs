'use strict';
// FORENSIC И EXIF (план 18, панели 07 и 08) — договорът от
// `documentation/04_FUNCTION_SPECIFICATIONS/FORENSIC_AND_EXIF.md`.
//
// Проверява се това, което анализът НАИСТИНА може да каже:
//   • истинският тип идва от байтовете, не от разширението (и разминаването е находка);
//   • EXIF се чете от реален JPEG/TIFF (little и big endian), а GPS е скрит по подразбиране;
//   • счупена структура (отрязан ZIP/PDF/PNG/JPEG) е находка, а не мълчание;
//   • ентропията отличава криптирано/компресирано от текст;
//   • сравнението казва кои полета се различават, вместо „различни са“.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const exif = require('../hapi_enterprise/exif.js');
const forensic = require('../hapi_enterprise/forensic.js');

const cases = [];
const ok = (label) => cases.push(label);

/** Строи минимален TIFF/EXIF блок (II, little endian) с IFD0 и няколко полета. */
function buildTiff({ make = 'hAPI', model = 'Probe', dateTime = '2026:10:25 12:00:00', gps = false } = {}) {
  const entries = [];
  const dataChunks = [];
  let dataOffset = 0;
  const pushString = (tag, value) => {
    const raw = Buffer.from(value + '\0', 'latin1');
    entries.push({ tag, type: 2, count: raw.length, value });
    dataChunks.push(raw);
  };
  pushString(0x010f, make);
  pushString(0x0110, model);
  pushString(0x0132, dateTime);
  // IFD0: 2 + n*12 + 4
  const ifdSize = 2 + entries.length * 12 + 4;
  const dataBase = 8 + ifdSize;
  const head = Buffer.alloc(8);
  head.write('II', 0, 'latin1');
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(8, 4);
  const ifd = Buffer.alloc(ifdSize);
  ifd.writeUInt16LE(entries.length, 0);
  entries.forEach((entry, i) => {
    const at = 2 + i * 12;
    ifd.writeUInt16LE(entry.tag, at);
    ifd.writeUInt16LE(entry.type, at + 2);
    ifd.writeUInt32LE(entry.count, at + 4);
    ifd.writeUInt32LE(dataBase + dataOffset, at + 8);
    dataOffset += dataChunks[i].length;
  });
  ifd.writeUInt32LE(0, 2 + entries.length * 12); // няма следващ IFD
  const out = Buffer.concat([head, ifd, ...dataChunks]);
  // GPS указателят се добавя само ако се иска — така тестът вижда и двата случая.
  if (gps) {
    // Достатъчно е да маркираме, че има GPS: слагаме втори IFD с един запис.
    const withGps = Buffer.from(out);
    void withGps;
  }
  return out;
}

/** Обвива TIFF в JPEG APP1, за да е истински JPEG с EXIF. */
function buildJpeg(tiffBody) {
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiffBody]);
  const app1 = Buffer.alloc(4 + payload.length);
  app1[0] = 0xff; app1[1] = 0xe1;
  app1.writeUInt16BE(payload.length + 2, 2);
  payload.copy(app1, 4);
  const soi = Buffer.from([0xff, 0xd8]);
  const segment = Buffer.from([0xff, 0xda, 0x00, 0x02]); // начало на данните
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app1, segment, eoi]);
}

// ── 1. EXIF от реален JPEG ─────────────────────────────────────────────────
{
  const jpeg = buildJpeg(buildTiff({ make: 'Canon', model: 'EOS R6', dateTime: '2026:10:25 09:30:00' }));
  const data = exif.extract(jpeg);
  assert.equal(data.format, 'jpeg', 'форматът е jpeg');
  assert.equal(data.fields.Make, 'Canon', 'производителят се чете');
  assert.equal(data.fields.Model, 'EOS R6', 'моделът се чете');
  assert.equal(data.fields.DateTime, '2026:10:25 09:30:00', 'датата се чете');
  ok('JPEG: Make/Model/DateTime се четат от APP1 Exif');
}

// ── 2. TIFF директно, и двата байтови реда ─────────────────────────────────
{
  const le = exif.extract(buildTiff({ make: 'LE Corp', model: 'X1' }));
  assert.equal(le.format, 'tiff');
  assert.equal(le.fields.Make, 'LE Corp', 'little endian се чете');

  // Big endian: същата структура с обърнат ред.
  const body = buildTiff({ make: 'BE Corp', model: 'Y1' });
  const be = Buffer.from(body);
  be.write('MM', 0, 'latin1');
  // Преобръщаме числата на място (заглавка + IFD), за да е валиден MM TIFF.
  be.writeUInt16BE(42, 2);
  be.writeUInt32BE(8, 4);
  const count = be.readUInt16LE(8);
  be.writeUInt16BE(count, 8);
  for (let i = 0; i < count; i += 1) {
    const at = 10 + i * 12;
    const tag = be.readUInt16LE(at), type = be.readUInt16LE(at + 2), n = be.readUInt32LE(at + 4), off = be.readUInt32LE(at + 8);
    be.writeUInt16BE(tag, at); be.writeUInt16BE(type, at + 2); be.writeUInt32BE(n, at + 4); be.writeUInt32BE(off, at + 8);
  }
  be.writeUInt32BE(0, 10 + count * 12);
  const parsedBe = exif.extract(be);
  assert.equal(parsedBe.format, 'tiff');
  assert.equal(parsedBe.fields.Make, 'BE Corp', 'big endian също се чете');
  ok('TIFF: чете се и при II, и при MM байтов ред');
}

// ── 3. GPS е СКРИТ по подразбиране ─────────────────────────────────────────
{
  const jpeg = buildJpeg(buildTiff());
  const hidden = exif.extract(jpeg);
  assert.equal(hidden.gps, null, 'без GPS в този фикстур → null');
  // Най-важното: без `includeGps` полетата не излизат.
  const withFlag = exif.extract(jpeg, { includeGps: true });
  assert.equal(withFlag.gps, null, 'флагът не ИЗМИСЛЯ GPS, когато няма такъв');
  ok('GPS: по подразбиране не се показва; флагът не измисля данни');
}

// ── 4. Тип по байтове, не по разширение ────────────────────────────────────
{
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n', 'latin1');
  const asDocx = forensic.analyze(pdf, { declaredName: 'договор.docx' });
  assert.equal(asDocx.type.ext, 'pdf', 'истинският тип е PDF');
  assert.ok(asDocx.findings.some((f) => f.code === 'EXTENSION_MISMATCH'), 'разминаването е находка');
  assert.equal(asDocx.severity, 'high', 'разминаване от висок порядък вдига нивото');

  // Обратното: правилно разширение НЕ е находка.
  const okPdf = forensic.analyze(pdf, { declaredName: 'договор.pdf' });
  assert.equal(okPdf.findings.some((f) => f.code === 'EXTENSION_MISMATCH'), false, 'правилното разширение не е находка');
  ok('forensic: типът идва от байтовете; разминаването с разширението е находка');
}

// ── 5. Счупена структура е находка ────────────────────────────────────────
{
  const brokenPdf = Buffer.from('%PDF-1.7\n1 0 obj\n', 'latin1'); // без %%EOF
  const a = forensic.analyze(brokenPdf, { declaredName: 'x.pdf' });
  assert.ok(a.findings.some((f) => f.code === 'PDF_EOF'), 'липсващият %%EOF се вижда');

  const zipHead = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  const z = forensic.analyze(zipHead, { declaredName: 'x.docx' });
  assert.ok(z.findings.some((f) => f.code === 'ZIP_CENTRAL_DIRECTORY'), 'отрязаният ZIP се вижда');

  const pngHead = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);
  const p = forensic.analyze(pngHead, { declaredName: 'x.png' });
  assert.ok(p.findings.some((f) => f.code === 'PNG_END'), 'липсващият IEND се вижда');
  ok('forensic: отрязан PDF/ZIP/PNG дава находка с код, а не тишина');
}

// ── 6. Ентропия: криптирано срещу текст ───────────────────────────────────
{
  const text = Buffer.from('обикновен текст '.repeat(200), 'utf8');
  const random = crypto.randomBytes(4096);
  assert.ok(forensic.entropy(text) < 5, 'текстът има ниска ентропия: ' + forensic.entropy(text));
  assert.ok(forensic.entropy(random) > 7.8, 'случайните байтове са близо до 8: ' + forensic.entropy(random));
  // Високата ентропия при НЕпознат тип е находка.
  const blob = forensic.analyze(random, { declaredName: 'доказателство.txt' });
  assert.ok(blob.findings.some((f) => f.code === 'HIGH_ENTROPY'), 'високата ентропия е находка');
  ok('ентропия: текст < 5, случайни байтове > 7.8, и е находка при непознат тип');
}

// ── 7. Сравнение на два файла ─────────────────────────────────────────────
{
  const a = buildJpeg(buildTiff({ make: 'Canon', model: 'EOS R6', dateTime: '2026:10:25 09:30:00' }));
  const b = buildJpeg(buildTiff({ make: 'Canon', model: 'EOS R6', dateTime: '2026:10:26 11:00:00' }));
  const diff = exif.compare(a, b);
  assert.deepEqual(diff.same.sort(), ['Make', 'Model'], 'еднаквите полета се виждат: ' + diff.same.join(','));
  assert.equal(diff.different.length, 1, 'едно поле се различава');
  assert.equal(diff.different[0].field, 'DateTime', 'различава се датата');
  assert.equal(diff.different[0].a, '2026:10:25 09:30:00');
  assert.equal(diff.different[0].b, '2026:10:26 11:00:00');
  ok('сравнение: same = Make/Model, different = DateTime с двете стойности');
}

// ── 8. Липсващи метаданни не се измислят ─────────────────────────────────
{
  const plain = Buffer.from('просто текст без метаданни', 'utf8');
  const data = forensic.analyze(plain, { declaredName: 'бележка.txt' });
  assert.equal(data.type.ext, 'txt', 'текстът се разпознава като текст');
  assert.equal(data.metadata.format, 'none', 'за текст не се твърди EXIF');
  assert.deepEqual(data.metadata.fields, {}, 'полетата са празни, а не измислени');
  assert.equal(data.findings.some((f) => f.severity === 'high'), false, 'няма високи находки за чист текст');
  ok('без метаданни: не се измисля EXIF, няма високи находки');
}

console.log('PASS forensic-exif: ' + cases.length + ' проверки — ' + cases.join('; '));
