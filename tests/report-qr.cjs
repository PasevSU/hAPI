'use strict';
// Фаза 11 / RS-06: QR кодът в отчета е ИСТИНСКИ векторен код, не ред текст.
//
// Проверява се на три нива:
//   1. матрицата е валиден QR (размер 4n+1, три finder мостри, timing ред, детерминизъм);
//   2. рендерът дава `qr` блок със съдържанието и текст, който се чете без скенер;
//   3. в готовия PDF всеки тъмен отрязък от матрицата е нарисуван като запълнен правоъгълник
//      (броят на `re f` операциите съвпада с броя на хоризонталните отрязъци).
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const M = require('../hapi_enterprise/report-manifest.js');
const R = require('../hapi_enterprise/report-render.js');
const P = require('../hapi_enterprise/pdf-writer.js');

const TARGET = 'https://example.org/verify/abc';

// ── 1. Матрицата ────────────────────────────────────────────────────────────
const matrix = P.qrMatrix(TARGET, 'M');
const count = matrix.length;
assert.equal(count % 4, 1, `размерът на QR е 4n+1 (получено ${count})`);
assert.ok(matrix.every((row) => row.length === count), 'матрицата е квадратна');

const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
const block = (rowStart, colStart) => {
  const rows = [];
  for (let r = 0; r < 7; r += 1) rows.push(matrix[rowStart + r].slice(colStart, colStart + 7));
  return rows;
};
assert.deepEqual(block(0, 0), finder, 'горен ляв finder');
assert.deepEqual(block(0, count - 7), finder, 'горен десен finder');
assert.deepEqual(block(count - 7, 0), finder, 'долен ляв finder');

const timing = matrix[6].slice(8, count - 8);
assert.ok(
  timing.split('').every((ch, i) => ch === (i % 2 === 0 ? '1' : '0')),
  `timing редът редува тъмно/светло (получено ${timing})`,
);

assert.deepEqual(P.qrMatrix(TARGET, 'M'), matrix, 'еднакъв текст → еднакъв код');
assert.notDeepEqual(P.qrMatrix(TARGET + 'x', 'M'), matrix, 'различен текст → различен код');

const runs = (rows) => rows.reduce((sum, row) => sum + (row.match(/1+/g) || []).length, 0);
const expectedRuns = runs(matrix);

// ── 2. Рендерът ─────────────────────────────────────────────────────────────
const manifest = {
  profile: 'qr-test',
  blocks: [
    { id: 'start', type: M.START, locked: true },
    { id: 'title', type: 'title', value: 'Отчет с QR' },
    { id: 'qr1', type: 'qr', label: 'Проверка', value: TARGET },
    { id: 'stop', type: M.STOP, locked: true },
  ],
};
const blocks = R.toPdfBlocks(M.normalize(manifest), {});
const qrBlock = blocks.find((b) => b.type === 'qr');
assert.ok(qrBlock, 'има qr блок');
assert.equal(qrBlock.text, TARGET);
assert.ok(
  blocks.some((b) => b.type === 'p' && b.text.includes(TARGET)),
  'съдържанието на кода се чете и като текст',
);
const qrIndex = blocks.indexOf(qrBlock);
assert.ok(qrIndex > blocks.findIndex((b) => b.type === 'h3' && b.text === 'RFC 3161 START'));
assert.ok(qrIndex < blocks.findIndex((b) => b.type === 'h3' && b.text === 'RFC 3161 STOP'));

// ── 3. PDF-ът ───────────────────────────────────────────────────────────────
const pdf = R.renderPdf(M.normalize(manifest), {});
assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');

const inflated = [];
const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
let match;
while ((match = streamRe.exec(pdf.toString('latin1')))) {
  try {
    inflated.push(zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
  } catch {
    /* не всеки поток е deflate — пропуска се */
  }
}
const content = inflated.join('\n');
const drawnRuns = (content.match(/^0 g [\d.]+ [\d.]+ [\d.]+ [\d.]+ re f$/gm) || []).length;
assert.ok(drawnRuns > 0, 'в PDF има запълнени модули');
assert.equal(drawnRuns, expectedRuns, 'всеки тъмен отрязък от матрицата е нарисуван');
assert.ok(
  !content.includes('не може да се кодира'),
  'валиден текст не бива да води до „не може да се кодира“',
);

// ── 4. Неуспешно кодиране не рисува фалшив QR ───────────────────────────────
const tooLong = R.toPdfBlocks(
  M.normalize({
    profile: 'qr-test',
    blocks: [
      { id: 'start', type: M.START, locked: true },
      { id: 'qr2', type: 'qr', label: 'Прекалено дълго', value: 'x'.repeat(9000) },
      { id: 'stop', type: M.STOP, locked: true },
    ],
  }),
  {},
);
const brokenPdf = R.renderPdf(
  M.normalize({
    profile: 'qr-test',
    blocks: [
      { id: 'start', type: M.START, locked: true },
      { id: 'qr2', type: 'qr', label: 'Прекалено дълго', value: 'x'.repeat(9000) },
      { id: 'stop', type: M.STOP, locked: true },
    ],
  }),
  {},
);
assert.ok(tooLong.some((b) => b.type === 'qr'));
assert.equal(brokenPdf.subarray(0, 5).toString('latin1'), '%PDF-', 'отчетът се издава и без QR');
const brokenInflated = [];
const brokenRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
let brokenMatch;
while ((brokenMatch = brokenRe.exec(brokenPdf.toString('latin1')))) {
  try {
    brokenInflated.push(zlib.inflateSync(Buffer.from(brokenMatch[1], 'latin1')).toString('latin1'));
  } catch {
    /* пропуска се */
  }
}
const brokenContent = brokenInflated.join('\n');
assert.equal(
  (brokenContent.match(/^0 g [\d.]+ [\d.]+ [\d.]+ [\d.]+ re f$/gm) || []).length,
  0,
  'при невъзможно кодиране няма нарисувани модули (никакъв фалшив QR)',
);

console.log('report-qr OK: истински векторен QR в отчета');
