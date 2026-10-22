'use strict';
// Word (.docx) → PDF с ТАБЛИЦИ и КАРТИНКИ (BUG-03 от плана).
//
// Преди: `docxBlocks` вадеше само абзаци — таблицата се разпадаше на отделни редове, а
// картинките липсваха. Сега `docxRich` пази реда на документа и дава таблици и картинки,
// а `pdf-writer` вгражда и PNG (Word пази картинките си така), не само JPEG.
//
// Тестът строи ИСТИНСКИ .docx в паметта (zip + document.xml + rels + media), за да не
// зависи от външен файл, и после гледа готовия PDF: има ли XObject за картинката, има ли
// текста от клетките на таблицата, и дали грешките са ясни.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const ooxml = require('../hapi_enterprise/ooxml.js');
const pdf = require('../hapi_enterprise/pdf-writer.js');

// ── Минимален PNG (RGB, 8 бита) — 2×2 пиксела, без алфа ─────────────────────────
function tinyPng() {
  const width = 2, height = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    raw[p] = 0; // филтър „none“ за реда
    p += 1;
    for (let x = 0; x < width; x += 1) {
      raw[p] = 0x20 * (x + 1);
      raw[p + 1] = 0x40 * (y + 1) % 256;
      raw[p + 2] = 0x80;
      p += 3;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crcTable = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const out = Buffer.alloc(4);
    out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
    return Buffer.concat([len, body, out]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Истински .docx: заглавие, абзац, таблица, картинка ─────────────────────────
function buildDocx() {
  const png = tinyPng();
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
 <w:body>
  <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Отчет за дело 2026</w:t></w:r></w:p>
  <w:p><w:r><w:t>Обикновен абзац преди таблицата.</w:t></w:r></w:p>
  <w:tbl>
   <w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Позиция</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Стойност</w:t></w:r></w:p></w:tc></w:tr>
   <w:tr><w:tc><w:p><w:r><w:t>Файлове</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>12</w:t></w:r></w:p></w:tc></w:tr>
   <w:tr><w:tc><w:p><w:r><w:t>Хеш</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>sha256</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl>
  <w:p><w:r><w:drawing><a:blip r:embed="rId9"/></w:drawing></w:r></w:p>
  <w:p><w:r><w:t>Текст след картинката.</w:t></w:r></w:p>
 </w:body>
</w:document>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
 <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;
  return ooxml.zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/_rels/document.xml.rels', data: rels },
    { name: 'word/media/image1.png', data: png },
  ]);
}

// ── 1. Извличането пази реда и структурата ───────────────────────────────────────
const docx = buildDocx();
const rich = ooxml.docxRich(docx);
const kinds = rich.blocks.map((b) => b.type);
assert.equal(kinds[0], 'h1', 'заглавието е първо');
assert.ok(kinds.includes('table'), 'таблицата е блок, не разпилени абзаци');
assert.ok(kinds.includes('image'), 'картинката е блок');
assert.ok(kinds.indexOf('table') < kinds.indexOf('image'), 'редът е като в документа');
assert.equal(kinds[kinds.length - 1], 'p', 'последният абзац е след картинката');

const table = rich.blocks.find((b) => b.type === 'table');
assert.equal(table.rows.length, 3, 'три реда');
assert.deepEqual(table.rows[0], ['Позиция', 'Стойност'], 'първият ред пази клетките');
assert.deepEqual(table.rows[1], ['Файлове', '12'], 'клетките не се сливат');
assert.equal(table.header, true, 'първият ред е заглавен (има bold/tblHeader)');

const image = rich.blocks.find((b) => b.type === 'image');
assert.ok(Buffer.isBuffer(image.data), 'картинката е с данни');
assert.equal(image.name, 'image1.png', 'името идва от пакета');
assert.equal(image.data.subarray(0, 4).toString('hex'), '89504e47', 'данните са истински PNG');
assert.ok(rich.media.has('word/media/image1.png'), 'media картата сочи файла в пакета');

// Старото извличане остава за съвместимост (само абзаци).
assert.ok(Array.isArray(ooxml.docxBlocks(docx)), 'docxBlocks продължава да работи');

// ── 2. PDF-ът съдържа картинката и таблицата ────────────────────────────────────
const out = pdf.render(rich.blocks, { title: 'Отчет за дело 2026' });
assert.ok(Buffer.isBuffer(out) && out.length > 1000, 'PDF-ът е генериран');
const text = out.toString('latin1');
assert.match(text, /\/Subtype \/Image/, 'PDF-ът има XObject за картинката');
assert.match(text, /\/DecodeParms \[?<< \/Predictor 15 \/Colors 3/, 'PNG-то е вградено с PNG предиктор (без прекодиране)');
assert.match(text, /\/Width 2 \/Height 2/, 'размерите са от IHDR');
assert.ok(text.endsWith('%%EOF\n') || text.endsWith('%%EOF'), 'PDF-ът завършва коректно');

// Текстът от клетките е в PDF-а. Шрифтовете и CMap-ът са с FlateDecode, затова се
// разархивират потоците, преди да се търси — иначе се гледа компресиран боклук.
function inflateStreams(buf) {
  const parts = [];
  const S = Buffer.from('stream'), E = Buffer.from('endstream');
  let i = 0;
  while ((i = buf.indexOf(S, i)) !== -1) {
    let start = i + S.length;
    if (buf[start] === 0x0d) start += 1;
    if (buf[start] === 0x0a) start += 1;
    const end = buf.indexOf(E, start);
    if (end === -1) break;
    const slice = buf.subarray(start, end);
    try {
      parts.push(zlib.inflateSync(slice).toString('latin1'));
    } catch {
      parts.push(slice.toString('latin1'));
    }
    i = end + E.length;
  }
  return parts.join('\n');
}
const streams = inflateStreams(out);
assert.match(streams, /beginbfchar/, 'PDF-ът носи ToUnicode карта за текста');
const hexes = new Set([...streams.matchAll(/<([0-9a-f]{4})> <([0-9a-f]{4,8})>/g)].map((m) => parseInt(m[2], 16)));
const hasText = (word) => [...word].every((ch) => hexes.has(ch.codePointAt(0)));
assert.ok(hasText('Файлове'), 'текстът от таблицата е в PDF-а');
assert.ok(hasText('sha256'), 'и втората колона е там');

// ── 3. Ясни грешки вместо тихо празно място ─────────────────────────────────────
const alphaPng = (() => {
  const png = tinyPng();
  const copy = Buffer.from(png);
  copy[25] = 6; // color type RGBA — не се поддържа без маска
  return copy;
})();
assert.throws(() => pdf.render([{ type: 'image', data: alphaPng }]), /color type 6/, 'PNG с алфа дава ясна грешка');
assert.throws(() => pdf.render([{ type: 'image', data: Buffer.from('GIF89a') }]), /Only JPEG and PNG/, 'друг формат дава ясна грешка');
assert.throws(() => ooxml.docxRich(Buffer.from('not a zip')), /ZIP|OOXML/, 'не-docx файл се отказва');

// ── 4. Кабинетът и прегледът ползват новото извличане ───────────────────────────
const cabinetSrc = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'hapi_enterprise', 'cabinet.js'), 'utf8');
const previewSrc = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'hapi_enterprise', 'preview.js'), 'utf8');
assert.ok(cabinetSrc.includes('ooxml.docxRich(buf).blocks'), 'конвертирането в кабинета ползва богатото извличане');
assert.ok(previewSrc.includes('ooxml.docxRich(buffer).blocks'), 'прегледът също');
assert.match(previewSrc, /type==='table'/, 'прегледът показва таблица като таблица');

console.log('PASS docx-pdf: таблици и картинки от .docx · PNG в PDF без прекодиране · ясни грешки');
