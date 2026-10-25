'use strict';
// ШИРИНИ ПО КОЛОНА (v2) — от манифеста до PDF-а, а не само поле в редактора.
//
// Защо точно тези проверки:
//   • `columnWidths` е математиката, която решава колко широка е всяка колона. Ако сборът не
//     е равен на наличната ширина, таблицата излиза извън полетата на страницата — затова се
//     проверява сборът, не само пропорцията.
//   • Невалидни тегла (грешен брой, нула, отрицателно) НЕ бива да чупят отчета: таблицата
//     става равна. Тихо подминаване би дало таблица с невидима колона.
//   • Манифестът отказва ширини, които не съвпадат с колоните (`INVALID_TABLE_WIDTHS`) —
//     иначе PDF-ът получава тегло за колона, която не съществува.
//   • Редакторът държи ширините ЗАЕДНО с колоните: преместиш ли колона, теглото ѝ върви с нея.
const assert = require('node:assert/strict');
const M = require('../hapi_enterprise/report-manifest.js');
const R = require('../hapi_enterprise/report-render.js');
const W = require('../hapi_enterprise/pdf-writer.js');
const { startServer, mountUi } = require('./lib/gui-harness.cjs');

const cases = [];
const ok = (label) => cases.push(label);

const base = (extra) => ({
  schemaVersion: 1,
  profile: 'default',
  page: { format: 'A4', orientation: 'portrait', marginsMm: [15, 15, 15, 15] },
  blocks: [
    { id: 'start', type: 'rfc3161-start', locked: true },
    Object.assign({ id: 'tbl', type: 'table', source: 'records:1000', columns: ['име', 'стойност', 'дата'] }, extra),
    { id: 'stop', type: 'rfc3161-stop', locked: true },
  ],
});

(async () => {
  // ── 1. Математиката: равни по подразбиране, пропорционални с тегла ────────
  const maxW = 500;
  assert.deepEqual(W.columnWidths(maxW, 4), [125, 125, 125, 125], 'без тегла — равни');
  assert.deepEqual(W.columnWidths(maxW, 3, [2, 1, 1]), [250, 125, 125], 'теглата работят пропорционално');
  const sum = W.columnWidths(maxW, 3, [3, 1, 1]).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - maxW) < 1e-9, 'сборът е точно наличната ширина, получено: ' + sum);
  ok('`columnWidths`: равни без тегла, пропорционални с тегла, сборът е точно maxW');

  // ── 2. Невалидни тегла не чупят таблицата ────────────────────────────────
  assert.deepEqual(W.columnWidths(maxW, 3, [1, 1]), [maxW / 3, maxW / 3, maxW / 3], 'грешен брой → равни');
  assert.deepEqual(W.columnWidths(maxW, 2, [1, 0]), [maxW / 2, maxW / 2], 'нула → равни');
  assert.deepEqual(W.columnWidths(maxW, 2, [1, -2]), [maxW / 2, maxW / 2], 'отрицателно → равни');
  assert.deepEqual(W.columnWidths(maxW, 2, [1, 'x']), [maxW / 2, maxW / 2], 'не-число → равни');
  assert.deepEqual(W.columnWidths(maxW, 1, []), [maxW], 'празен списък → равни');
  ok('невалидни тегла (брой, нула, минус, текст) дават равни колони, а не счупена таблица');

  // ── 3. Манифестът отказва ширини, които не пасват на колоните ────────────
  assert.equal(M.validate(M.normalize(base({ widths: [2, 1, 1] }))).ok, true, 'валидните ширини минават');
  const wrongCount = M.validate(M.normalize(base({ widths: [2, 1] })));
  assert.equal(wrongCount.ok, false);
  assert.ok(wrongCount.errors.some((e) => e.code === 'INVALID_TABLE_WIDTHS'), 'грешен брой → INVALID_TABLE_WIDTHS');
  const zero = M.validate(M.normalize(base({ widths: [2, 0, 1] })));
  assert.ok(zero.errors.some((e) => e.code === 'INVALID_TABLE_WIDTHS'), 'нула → INVALID_TABLE_WIDTHS');
  const huge = M.validate(M.normalize(base({ widths: [2, 1, 5000] })));
  assert.ok(huge.errors.some((e) => e.code === 'INVALID_TABLE_WIDTHS'), 'над 1000 → INVALID_TABLE_WIDTHS');
  const noWidths = M.validate(M.normalize(base({})));
  assert.equal(noWidths.ok, true, 'без ширини отчетът е валиден (по подразбиране равни)');
  ok('манифестът: валидни ширини минават, грешен брой/нула/огромно → INVALID_TABLE_WIDTHS');

  // ── 4. Рендер моделът носи ширините до PDF-а ─────────────────────────────
  const withWidths = M.normalize(base({ widths: [2, 1, 1] }));
  const items = R.toPdfBlocks(withWidths, {});
  const table = items.find((b) => b.type === 'table' && Array.isArray(b.rows) && b.rows[0][0] === 'име');
  assert.ok(table, 'таблицата е в рендер модела');
  assert.deepEqual(table.widths, [2, 1, 1], 'ширините стигат до PDF слоя');
  const withoutWidths = R.toPdfBlocks(M.normalize(base({})), {});
  const plain = withoutWidths.find((b) => b.type === 'table' && Array.isArray(b.rows) && b.rows[0][0] === 'име');
  assert.equal(plain.widths, undefined, 'без ширини ключът липсва (равни по подразбиране)');
  const pdf = R.renderPdf(withWidths, { title: 'Ширини' });
  assert.equal(Buffer.from(pdf).subarray(0, 4).toString(), '%PDF', 'PDF-ът с тегла се построява');
  ok('рендер моделът носи ширините, а PDF-ът с тегла се построява');

  // ── 5. Редакторът: поле за ширини, което не чупи манифеста ───────────────
  const server = await startServer();
  try {
    const ui = mountUi(server, { modules: ['data.js', 'icons.js', 'report-objects.js', 'report-studio.js'] });
    const studio = ui.window.ReportStudio;
    studio.state.manifest = M.normalize(base({}));
    const host = ui.container();
    studio.mount(host);
    studio.state.selectedId = 'tbl';
    studio.refresh();

    const field = () => host.querySelector('#p-widths');
    const block = () => studio.state.manifest.blocks.find((b) => b.id === 'tbl');
    assert.ok(field(), 'полето за ширини съществува');

    field().value = '2, 1, 1';
    field().dispatch('change');
    assert.deepEqual([...block().widths], [2, 1, 1], 'ширините се записват в манифеста');
    assert.equal(M.validate(studio.state.manifest).ok, true, 'и манифестът остава валиден');

    // Грешен брой числа се отказва с видимо съобщение, а старите ширини остават.
    ui.clearToasts();
    field().value = '2, 1';
    field().dispatch('change');
    assert.deepEqual([...block().widths], [2, 1, 1], 'грешен брой не променя нищо');
    assert.ok(ui.lastToast(), 'има съобщение за грешка');
    ok('полето за ширини записва валидни тегла и отказва грешен брой с видимо съобщение');

    // ── 6. Ширините вървят заедно с колоните ───────────────────────────────
    host.querySelector('[data-col="up"][data-i="1"]').click();
    assert.deepEqual([...block().columns], ['стойност', 'име', 'дата'], 'колоните са разменени');
    assert.deepEqual([...block().widths], [1, 2, 1], 'теглото е мръднало с колоната');
    host.querySelector('[data-col="del"][data-i="2"]').click();
    assert.deepEqual([...block().columns], ['стойност', 'име'], 'колона е изтрита');
    assert.deepEqual([...block().widths], [1, 2], 'и нейното тегло е изтрито');
    host.querySelector('#p-newcol').value = 'нова';
    host.querySelector('#p-addcol').click();
    assert.equal(block().widths.length, 3, 'новата колона получава тегло');
    assert.equal(M.validate(studio.state.manifest).ok, true, 'манифестът е валиден след трите операции: ' + JSON.stringify(M.validate(studio.state.manifest).errors));
    ok('преместване, триене и добавяне държат ширините в крак с колоните');
  } finally {
    await server.stop();
  }

  console.log('PASS report-table-widths: ' + cases.length + ' проверки — ' + cases.join('; '));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
