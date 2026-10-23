'use strict';
// Фаза 11 / RS-03: манифест → PDF (без сървър).
const assert = require('node:assert/strict');
const M = require('../hapi_enterprise/report-manifest.js');
const R = require('../hapi_enterprise/report-render.js');
const example = require('../hapi_enterprise/ui/manifest.example.json');

// 1. Превод на блоковете: START е първи, STOP е последен.
const manifest = M.normalize(example);
const blocks = R.toPdfBlocks(manifest, {});
const headings = blocks.filter((b) => b.type === 'h3').map((b) => b.text);
assert.equal(headings[0], 'RFC 3161 START');
assert.equal(headings.at(-1), 'RFC 3161 STOP');
assert.ok(blocks.some((b) => b.type === 'h1' && b.text.includes('КРИМИНАЛИСТИЧЕН')));

// 1б. RS-07: произходът на манифеста стои В обхвата на отчета (след START, преди STOP),
// така че издаденият PDF сам казва по кой манифест е направен.
const startIndex = blocks.findIndex((b) => b.type === 'h3' && b.text === 'RFC 3161 START');
const stopIndex = blocks.findIndex((b) => b.type === 'h3' && b.text === 'RFC 3161 STOP');
const provenanceIndex = blocks.findIndex(
  (b) => b.type === 'table' && b.rows[0][0] === 'Произход на манифеста',
);
assert.ok(provenanceIndex > startIndex, 'произходът трябва да е след START');
assert.ok(provenanceIndex < stopIndex, 'произходът трябва да е преди STOP');
const provenanceRows = blocks[provenanceIndex].rows;
const shaRow = provenanceRows.find((r) => r[0] === 'Манифест SHA-256');
assert.match(shaRow[1], /^[a-f0-9]{64}$/, 'манифестът се идентифицира с SHA-256');
assert.equal(shaRow[1], M.digest(manifest), 'хешът в отчета трябва да е същият, който връща API-то');
assert.equal(provenanceRows.find((r) => r[0] === 'Блокове')[1], String(manifest.blocks.length));

// 2. Подписът никога не е „издаден“ в рендера.
const signIndex = blocks.findIndex((b) => b.type === 'p' && /Подпис на издателя/.test(b.text || ''));
assert.ok(signIndex > 0, 'signature block rendered');
assert.match(blocks[signIndex].text, /не е издаден/);
assert.doesNotMatch(JSON.stringify(blocks), /tsaToken|MIIB|BEGIN CERTIFICATE/);

// 3. Таблица без данни → заглавен ред + една запълваща колона.
const tableBlock = manifest.blocks.find((b) => b.type === 'table');
const emptyTable = R.toPdfBlocks(manifest, {}).find((b) => b.type === 'table' && b.rows[0][0] === 'name');
assert.deepEqual(emptyTable.rows[0], ['name', 'position', 'email']);
assert.equal(emptyTable.rows.length, 2);
assert.deepEqual(emptyTable.rows[1], ['—', '—', '—']);

// 4. Таблица с данни от източника.
const withData = R.toPdfBlocks(manifest, { data: { 'records:1001': [['Иван Петров', 'Деловодител', 'ivan@example.bg']] } });
const filled = withData.find((b) => b.type === 'table' && b.rows[0][0] === 'name');
assert.deepEqual(filled.rows[1], ['Иван Петров', 'Деловодител', 'ivan@example.bg']);
assert.equal(filled.rows.length, 2);

// 5. Hash таблица: стойностите идват само от подадените реални хешове.
const hashed = R.toPdfBlocks(manifest, { hashes: { SHA256: 'a'.repeat(64) } });
const hashTable = hashed.find((b) => b.type === 'table' && b.rows[0][0] === 'Алгоритъм');
const sha = hashTable.rows.find((r) => r[0] === 'SHA256');
const md5 = hashTable.rows.find((r) => r[0] === 'MD5');
assert.equal(sha[1], 'a'.repeat(64));
assert.equal(md5[1], '—');

// 6. PDF-ът е валиден контейнер.
const pdf = R.renderPdf(manifest, {});
assert.ok(Buffer.isBuffer(pdf));
assert.equal(pdf.subarray(0, 8).toString('latin1'), '%PDF-1.5');
assert.match(pdf.subarray(-16).toString('latin1'), /%%EOF/);
const pages = Number((pdf.toString('latin1').match(/\/Count (\d+)/) || [])[1]);
assert.ok(pages >= 1, 'at least one page');

// 7. Дълъг отчет → повече от една страница.
const long = M.template('long');
long.blocks.splice(
  1,
  0,
  ...Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, type: 'text', label: `Секция ${i + 1}`, value: 'Ред '.repeat(120) })),
);
const longPdf = R.renderPdf(long, {});
const longPages = Number((longPdf.toString('latin1').match(/\/Count (\d+)/) || [])[1]);
assert.ok(longPages > pages, `expected multi-page, got ${longPages}`);

// 8. Невалиден манифест се отхвърля преди рендер.
assert.throws(() => R.renderPdf({ ...M.template(), blocks: [] }), (e) => e.status === 400);

// 9. Фалшив TSA токен никога не влиза в PDF.
const fake = M.template('fake');
fake.blocks[1].tsaToken = 'MIIB-fake';
assert.throws(() => R.renderPdf(fake), (e) => e.code === 'FORBIDDEN_FIELD');

// 10. Неподдържани формат/ориентация се казват явно.
const a5 = M.template('a5');
a5.page.format = 'A5';
assert.throws(() => R.renderPdf(a5), (e) => e.code === 'UNSUPPORTED_PAGE_FORMAT');
const land = M.template('land');
land.page.orientation = 'landscape';
assert.throws(() => R.renderPdf(land), (e) => e.code === 'UNSUPPORTED_ORIENTATION');

// 10. Подзаглавие, нова страница и правна декларация (0.69.35).
const extra = M.template();
extra.blocks.splice(
  1,
  0,
  { id: 'sub1', type: 'subtitle', value: 'Раздел втори' },
  { id: 'legal1', type: 'legal' },
  { id: 'pb1', type: 'pagebreak' },
);
const extraBlocks = R.toPdfBlocks(extra, {});
assert.ok(
  extraBlocks.some((b) => b.type === 'h2' && b.text === 'Раздел втори'),
  'подзаглавието е истинско h2, не уголемен параграф',
);
const pbIndex = extraBlocks.findIndex((b) => b.type === 'pagebreak');
assert.ok(pbIndex > 0, 'новата страница е отделен блок');
const legalText = extraBlocks
  .filter((b) => b.type === 'p')
  .map((b) => b.text)
  .find((t) => /hAPI Enterprise/.test(t));
assert.ok(legalText && legalText.length > 80, 'декларацията има текст по подразбиране, а не празен блок');
// Собствен текст заменя стандартния; празният блок не се губи от манифеста.
const customLegal = M.template();
customLegal.blocks.splice(1, 0, { id: 'legal2', type: 'legal', value: 'Самостоятелна декларация.' });
assert.ok(
  R.toPdfBlocks(customLegal, {}).some((b) => b.type === 'p' && b.text === 'Самостоятелна декларация.'),
  'собственият текст на декларацията се печата',
);
const extraPdf = R.renderPdf(extra, {});
assert.ok(Buffer.isBuffer(extraPdf), 'новите блокове дават валиден PDF');
// Броят страници се мери СРЕЩУ същия манифест без прекъсването: базовият шаблон вече
// може да е на два листа, затова „повече от едно“ не доказва нищо.
const noBreak = M.template();
noBreak.blocks.splice(1, 0,
  { id: 'sub1', type: 'subtitle', value: 'Раздел втори' },
  { id: 'legal1', type: 'legal' },
);
const pageCount = (buf) => Number((buf.toString('latin1').match(/\/Count (\d+)/) || [])[1]);
assert.equal(
  pageCount(extraPdf),
  pageCount(R.renderPdf(noBreak, {})) + 1,
  'прекъсването на страница добавя точно един лист',
);

console.log('report-render OK');
