'use strict';
// РЕДАКТОРЪТ НА КОЛОНИ в Report Studio — през ИСТИНСКИЯ DOM, не чрез четене на код.
//
// Защо съществува: бутоните за колони (`↑`/`↓`/`✕`/`Добави`) съществуваха в панела, но
// НИТО ЕДИН тест не ги натискаше. При проверката се оказа реален дефект: „изтрий“ беше
// активно и когато е останала една колона, тоест редакторът можеше да доведе манифеста до
// състояние, което собственият му `validate()` после отказва (`INVALID_TABLE_COLUMNS`).
//
// Проверява се:
//   • „Добави“ добавя колона и манифестът остава валиден;
//   • празно поле не добавя нищо (колона без име не минава валидация);
//   • ↑/↓ разменят съседни колони;
//   • ✕ трие, но НЕ последната — и то в КОДА, не само с `disabled` (DOM събитие може да
//     дойде и от извикване, а `disabled` не спира `dispatch`);
//   • на тавана от `MAX_COLUMNS` добавянето е отказано с видимо съобщение;
//   • след всяка операция `validate()` е чист — редакторът не бива да създава невалиден отчет.
//
// Бележка за `disabled`: тестовият DOM (`tests/lib/dom-stub.cjs`) пази само атрибути с
// `name="value"`, тоест булев атрибут `disabled` не се запазва. Затова тук се проверява
// ПОВЕДЕНИЕТО (бутонът не прави нищо), а самият атрибут — с текстова проверка на кода, за да
// не остане „изключен“ само на думи.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, mountUi } = require('./lib/gui-harness.cjs');

const MODULES = ['data.js', 'icons.js', 'report-objects.js', 'report-studio.js'];
const cases = [];
const ok = (label) => cases.push(label);

(async () => {
  const server = await startServer();
  try {
    const ui = mountUi(server, { modules: MODULES });
    const M = ui.window.HapiReportManifest;
    const studio = ui.window.ReportStudio;
    assert.ok(M && studio, 'ядрото и панелът са заредени');

    const manifest = M.normalize({
      schemaVersion: 1,
      profile: 'default',
      page: { format: 'A4', orientation: 'portrait', marginsMm: [15, 15, 15, 15] },
      blocks: [
        { id: 'start', type: 'rfc3161-start', locked: true },
        { id: 'tbl', type: 'table', source: 'records:1000', columns: ['име', 'стойност'] },
        { id: 'stop', type: 'rfc3161-stop', locked: true },
      ],
    });
    // Манифестът се слага ПРЕДИ монтирането: иначе панелът би взел примерния от `data.js`.
    studio.state.manifest = manifest;
    const host = ui.container();
    studio.mount(host);
    studio.state.selectedId = 'tbl';
    studio.refresh();

    const table = () => studio.state.manifest.blocks.find((b) => b.id === 'tbl');
    const cols = () => [...table().columns];
    const valid = () => M.validate(studio.state.manifest);
    assert.deepEqual(cols(), ['име', 'стойност']);

    // ── 1. „Добави“ добавя и манифестът остава валиден ──────────────────────
    const input = host.querySelector('#p-newcol');
    const addBtn = host.querySelector('#p-addcol');
    assert.ok(input && addBtn, 'полето и бутонът „Добави“ съществуват');
    input.value = 'дата';
    addBtn.click();
    assert.deepEqual(cols(), ['име', 'стойност', 'дата'], 'колоната е добавена');
    assert.equal(valid().ok, true, 'след добавяне манифестът е валиден: ' + JSON.stringify(valid().errors));
    assert.equal(host.querySelector('#p-newcol').value, '', 'полето се изчиства след добавяне');
    ok('„Добави“ добавя колона и манифестът остава валиден');

    // ── 2. Празно поле не добавя нищо ───────────────────────────────────────
    host.querySelector('#p-newcol').value = '   ';
    host.querySelector('#p-addcol').click();
    assert.deepEqual(cols(), ['име', 'стойност', 'дата'], 'празно поле не създава колона без име');
    ok('празно поле не добавя колона');

    // ── 3. ↑ / ↓ разменят съседни колони ────────────────────────────────────
    host.querySelector('[data-col="down"][data-i="0"]').click();
    assert.deepEqual(cols(), ['стойност', 'име', 'дата'], '„надолу“ разменя първите две');
    host.querySelector('[data-col="up"][data-i="1"]').click();
    assert.deepEqual(cols(), ['име', 'стойност', 'дата'], '„нагоре“ връща реда');
    host.querySelector('[data-col="up"][data-i="0"]').click();
    assert.deepEqual(cols(), ['име', 'стойност', 'дата'], 'първата не мърда нагоре');
    host.querySelector('[data-col="down"][data-i="2"]').click();
    assert.deepEqual(cols(), ['име', 'стойност', 'дата'], 'последната не мърда надолу');
    assert.equal(valid().ok, true, 'подредбата не чупи манифеста');
    ok('↑/↓ разменят съседни колони, а крайните не мърдат');

    // ── 4. ✕ трие, но не последната ─────────────────────────────────────────
    host.querySelector('[data-col="del"][data-i="2"]').click();
    assert.deepEqual(cols(), ['име', 'стойност'], 'колоната е изтрита');
    host.querySelector('[data-col="del"][data-i="1"]').click();
    assert.deepEqual(cols(), ['име'], 'остава една колона');
    host.querySelector('[data-col="del"][data-i="0"]').click();
    assert.deepEqual(cols(), ['име'], 'последната колона НЕ се трие (иначе манифестът става невалиден)');
    assert.equal(valid().ok, true, 'таблица с една колона е валидна: ' + JSON.stringify(valid().errors));
    // Атрибутът `disabled` е договорът към потребителя; DOM-ът на теста не го пази, затова
    // се проверява в кода — иначе „изключен“ щеше да е само твърдение.
    const source = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', 'report-studio.js'), 'utf8');
    assert.match(
      source,
      /data-col="del"[^>]*\$\{columns\.length === 1 \? 'disabled' : ''\}/,
      'бутонът „изтрий“ е изключен, когато колоната е последна',
    );
    ok('✕ трие, но не последната колона (и бутонът е изключен в HTML-а)');

    // ── 5. Таванът от MAX_COLUMNS се отказва с дума ─────────────────────────
    const limit = M.MAX_COLUMNS;
    table().columns = Array.from({ length: limit }, (_, i) => 'к' + i);
    studio.refresh();
    ui.clearToasts();
    host.querySelector('#p-newcol').value = 'още';
    host.querySelector('#p-addcol').click();
    assert.equal(table().columns.length, limit, 'над тавана не се добавя');
    const toast = ui.lastToast();
    assert.ok(toast, 'има съобщение, а не тихо нищо');
    assert.match(String(toast.message), new RegExp(String(limit)), 'съобщението казва тавана, получено: ' + toast.message);
    ok('над MAX_COLUMNS (' + limit + ') добавянето е отказано с видимо съобщение');

    console.log('PASS report-studio-columns: ' + cases.length + ' проверки — ' + cases.join('; '));
  } finally {
    await server.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
