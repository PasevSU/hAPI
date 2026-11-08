'use strict';
// DEF-38: всяко поле в панела има ИМЕ за екранен четец.
//
// Проблемът: панелите рисуват `<div class="field"><label>Тема</label><input …></div>`.
// Визуално е наред, но `<label>` не е свързан с полето (няма `for`/`id` и няма обвиващ
// `<label>`), тоест екранният четец обявява „поле за въвеждане“ без име. Дебъгинг
// инструментът го показва като нарушен закон `named`.
//
// Проверява се ТРИ неща, защото „има for“ само по себе си не значи „свързано“:
//   1. помощникът `ui/field-labels.js` слага `for`/`id` и те сочат съществуващо поле;
//   2. `id`-тата са уникални в документа (иначе вторият етикет сочи първото поле);
//   3. полетата от самите панели (реален HTML от `files-manager.js`) минават същата
//      проверка — включително деветте, които дефектът изброява по име.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./lib/dom-stub.cjs');

const root = path.join(__dirname, '..');
const MODULE = path.join(root, 'hapi_enterprise', 'ui', 'field-labels.js');
const UI = path.join(root, 'hapi_enterprise', 'ui');

/** Зарежда помощника в изолиран контекст (както в браузъра — през `window`). */
function loadLabels() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(MODULE, 'utf8'), sandbox, { filename: 'field-labels.js' });
  assert.ok(sandbox.window.HapiFieldLabels, 'модулът трябва да се обяви на window.HapiFieldLabels');
  return sandbox.window.HapiFieldLabels;
}

/** Всички полета в документа, които имат етикет до себе си, но не са свързани с него. */
function unboundIn(doc) {
  const bad = [];
  for (const control of doc.body.querySelectorAll('.field input, .field select, .field textarea')) {
    const named = control.getAttribute('aria-label') || control.getAttribute('aria-labelledby') || control.getAttribute('title');
    if (named) continue;
    const wrap = control.closest('.field');
    const label = wrap && wrap.querySelector('label');
    if (!label) continue;
    const id = control.id;
    const labelFor = label.getAttribute('for');
    if (!id || labelFor !== id) {
      bad.push((control.getAttribute('name') || id || '(без име)') + ' → for=' + String(labelFor));
      continue;
    }
    // `for` трябва да сочи ТОЧНО това поле, а не друго със същото id.
    const target = doc.getElementById(id);
    if (!target || target !== control) bad.push((control.getAttribute('name') || id) + ' → for сочи друго поле');
  }
  return bad;
}

const labels = loadLabels();

// ── 1. Помощникът свързва етикетите и пази уникалност ────────────────────────
{
  const doc = createDocument({ lang: 'bg' });
  doc.body.innerHTML = [
    '<div class="field"><label>Тема</label><input name="title" /></div>',
    '<div class="field"><label>Slug</label><input name="slug" /></div>',
    '<div class="field"><label>Описание</label><textarea name="description"></textarea></div>',
    '<div class="field"><label>Категория</label><select name="category"><option>a</option></select></div>',
  ].join('');
  const before = unboundIn(doc);
  assert.equal(before.length, 4, 'преди свързването всичките четири полета са без име: ' + before.join(', '));
  const out = labels.bind(doc.body);
  assert.equal(out.bound, 4, 'свързани трябва да са 4 полета (получено: ' + out.bound + ')');
  assert.deepEqual(unboundIn(doc), [], 'след свързването няма поле без име');
  const ids = [...doc.querySelectorAll('.field input, .field select, .field textarea')].map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'id-тата трябва да са уникални: ' + ids.join(', '));
  // Втори пуск не бива да сменя id-тата (иначе фокусът и тестовете се чупят).
  const again = labels.bind(doc.body);
  assert.equal(again.bound, 0, 'вторият пуск не намира нови полета');
  assert.deepEqual([...doc.querySelectorAll('.field input, .field select, .field textarea')].map((c) => c.id), ids, 'id-тата остават същите');
}

// ── 2. Полетата с `aria-label` не се пипат (те вече имат име) ───────────────
{
  const doc = createDocument({ lang: 'bg' });
  doc.body.innerHTML = '<div class="field"><label>Скрит</label><input name="hidden" aria-label="Скрит файл" /></div>';
  const out = labels.bind(doc.body);
  assert.equal(out.bound, 0, 'поле с aria-label не бива да получава втори етикет');
  assert.equal(unboundIn(doc).length, 0);
}

// ── 3. Реалните панели: всяко поле има етикет до себе си, значи помощникът го свързва ──
// Марката се чете от кода на панелите (не е измислен HTML). Шаблонните изрази `${…}` не се
// парсват като DOM, затова проверката тук е статична: `.field` блок ЗАДЪЛЖИТЕЛНО съдържа
// `<label>` — иначе `bind()` няма какво да свърже и полето остава безименно.
{
  const panelFiles = fs.readdirSync(UI).filter((f) => f.endsWith('.js') && f !== 'field-labels.js');
  const withField = [];
  const withoutLabel = [];
  let blocks = 0;
  for (const file of panelFiles) {
    const code = fs.readFileSync(path.join(UI, file), 'utf8');
    const matches = code.match(/<div class="field">[\s\S]{0,900}?<\/div>/g) || [];
    const raw = (code.match(/<div class="field">/g) || []).length;
    assert.equal(matches.length, raw, file + ': блоковете .field не се разпознават (' + matches.length + ' от ' + raw + ')');
    if (!matches.length) continue;
    blocks += matches.length;
    withField.push(file + '=' + matches.length);
    for (const block of matches) if (!/<label[\s>]/.test(block)) withoutLabel.push(file + ': ' + block.slice(0, 80));
  }
  assert.deepEqual(withoutLabel, [], 'полета без етикет до себе си (помощникът не може да ги свърже):\n  ' + withoutLabel.join('\n  '));
  assert.ok(withField.length >= 9, 'панелите с полета са необичайно малко: ' + withField.join(', '));
  assert.ok(blocks >= 109, 'намерени .field блокове: ' + blocks + ' — очакват се поне 109 (толкова са измерени при затварянето на DEF-38)');
}

// ── 3б. Полетата, които дефектът изброява по име, са в портала ─────────────
{
  const files = fs.readdirSync(UI).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(UI, f), 'utf8')).join('\n');
  const named = [
    '<label>slug</label>',
    '<label>Заглавие</label>',
    '<label>Относно</label>',
    '<label>Категория</label>',
    '<label>Организация</label>',
    '<label>Номер на делото (задължителен)</label>',
    '<label>Заглавие на делото</label>',
    '<label>Имейл (задължителен)</label>',
    '<label>Бележка към файла (до 2000 знака)</label>',
  ];
  for (const label of named) {
    assert.ok(files.includes(label), 'липсва етикет ' + label + ' — дефектът изброява точно тези полета');
  }
  assert.match(files, /name="storage_root"/, 'полето за storage_root трябва да е на място');
}

// ── 4. Панелът наистина зарежда помощника и го вика след рендер ─────────────
{
  const html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');
  const order = (name) => html.indexOf('<script src="' + name + '"></script>');
  assert.ok(order('field-labels.js') > 0, 'index.html не зарежда field-labels.js');
  assert.ok(order('field-labels.js') < order('app.js'), 'field-labels.js трябва да е ПРЕДИ app.js');
  const app = fs.readFileSync(path.join(UI, 'app.js'), 'utf8');
  assert.match(app, /HapiFieldLabels\.bind\(/, 'app.js трябва да вика HapiFieldLabels.bind');
  assert.match(app, /new MutationObserver\(/, 'app.js трябва да свързва етикетите и при рисуване след монтиране');
}

console.log('PASS ui-field-labels: помощникът свързва етикетите (`for`/`id`, уникални, идемпотентни) · aria-label се пази · полетата на панелите минават проверката · index.html го зарежда преди app.js');
