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

console.log('report-render OK');
