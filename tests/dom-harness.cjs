'use strict';
// Проверка на самия тестов DOM (`tests/dom-stub.cjs`).
//
// Причината: всички нови GUI тестове стъпват на него. Ако той парсва грешно или връща
// null за селектор, тестовете „минават“, без да са натиснали нищо. Затова тук се
// проверява поведението, което панелите реално ползват.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDocument, parseSelector } = require('./lib/dom-stub.cjs');

const doc = createDocument();

// ── 1. innerHTML се парсва и се търси по него ───────────────────────────────────
const host = doc.createElement('div');
doc.body.appendChild(host);
host.innerHTML = '<h1 id="title">Отчет &amp; тест</h1><button data-action="save">Запази</button><input id="q" value="">';
assert.equal(host.querySelector('#title').textContent, 'Отчет & тест', 'ентите се декодират');
assert.equal(host.querySelectorAll('[data-action]').length, 1, 'намира по data-атрибут');
assert.equal(host.querySelector('button').getAttribute('data-action'), 'save');
assert.ok(host.querySelector('#nope') === null, 'липсващият елемент е null, не изключение');

// ── 2. Потомък, клас, name и списък със запетая ─────────────────────────────────
host.innerHTML =
  '<nav id="nav"><button class="nav-item" data-panel="report">Отчети</button></nav>' +
  '<div class="langs"><button data-lang="bg">BG</button><button data-lang="de">DE</button></div>' +
  '<input name="contactId" value="c1">';
assert.equal(host.querySelector('#nav .nav-item[data-panel="report"]').getAttribute('data-panel'), 'report', 'потомък + клас + атрибут');
assert.equal(host.querySelector('.langs button[data-lang="bg"]').getAttribute('data-lang'), 'bg', 'верига от два елемента');
assert.equal(host.querySelectorAll('.langs button').length, 2, 'всички деца по таг');
assert.equal(host.querySelector('input[name="contactId"]').getAttribute('value'), 'c1', 'атрибут със стойност');
assert.ok(host.querySelector('.pf-form, #nav') === host.querySelector('#nav'), 'списък със запетая връща първия срещнат');

// ── 3. Клик минава през слушателите, както в браузър ───────────────────────────
let clicked = 0;
const btn = host.querySelector('[data-lang="bg"]');
btn.addEventListener('click', () => { clicked += 1 });
btn.click();
assert.equal(clicked, 1, 'click() вика слушателя');

// ── 4. dataset, classList, value/checked и добавяне на възел ────────────────────
const el = doc.createElement('div');
el.dataset.fileAct = 'rename';
assert.equal(el.getAttribute('data-file-act'), 'rename', 'dataset пише в data-атрибут');
assert.equal(el.dataset.fileAct, 'rename', 'dataset чете обратно');
el.classList.add('a', 'b');
assert.equal(el.classList.contains('b'), true);
el.classList.toggle('a');
assert.equal(el.classList.contains('a'), false, 'toggle маха');
el.value = 'x';
assert.equal(el.value, 'x');
const child = doc.createElement('span');
child.textContent = 'вътре';
el.appendChild(child);
assert.equal(el.querySelector('span').textContent, 'вътре', 'добавен възел се намира');
assert.equal(el.innerHTML.includes('<span>вътре</span>'), true, 'innerHTML се сериализира обратно');

// ── 5. Неподдържан селектор гърми СВЕТКАВИЦА, не тихо null ─────────────────────
assert.throws(() => parseSelector('div > span'), /неподдържан селектор/, 'непознат синтаксис се съобщава');
assert.ok(doc.getElementById('nav') === host.querySelector('#nav'), 'getElementById работи по цялото дърво');

// ── 6. Твърдение НИКОГА не получава DOM възел (DEF-92) ─────────────────────────
// Причината е измерена: `assert.equal(app.$('[data-folder-qr]'), null)` в J53 падна, Node
// построи diff (`myersDiff`) от инспекцията на ЦЕЛИЯ възел — 42 KB срещу `null` е
// квадратично сравнение — и сценарият умря след 144 s с „Array buffer allocation failed“.
// Забележка: `util.inspect.custom` НЕ помага — `assert` инспектира с изключена собствена
// инспекция (проверено с брояч). Затова единствената защита е твърдението да получава
// СТОЙНОСТ: `assert.ok(!възел)` / `assert.ok(възел === друг)`, а за съдържание —
// `.textContent` / `.getAttribute`.
const NODE_IN_ASSERT = /assert\.(?:equal|strictEqual|notEqual|deepEqual)\(\s*(?:[A-Za-z_$][\w$]*\.)*(?:\$|\$\$|querySelector|querySelectorAll|getElementById)\([^()]*\)\s*[,)]/;
const offenders = [];
for (const name of fs.readdirSync(__dirname).filter((f) => f.endsWith('.cjs'))) {
  const src = fs.readFileSync(path.join(__dirname, name), 'utf8');
  src.split('\n').forEach((line, index) => {
    // Коментар, който ПОКАЗВА правилото, не е нарушение — затова се пропуска.
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (NODE_IN_ASSERT.test(line)) offenders.push(name + ':' + (index + 1) + ': ' + trimmed.slice(0, 90));
  });
}
assert.deepEqual(offenders, [], 'твърдение сравнява DOM възел — при провал строи diff от целия възел:\n  ' + offenders.join('\n  '));

// Кратката инспекция пази всичко останало (console.log, съобщения), затова се мери.
const big = doc.createElement('div');
big.setAttribute('class', 'fm-file');
for (let i = 0; i < 300; i += 1) {
  const row = doc.createElement('div');
  row.setAttribute('class', 'fm-row');
  row.innerHTML = '<span class="nm">ред ' + i + '</span><button data-x="' + i + '">к</button>';
  big.appendChild(row);
}
const inspectStarted = Date.now();
const printed = require('node:util').inspect(big);
const inspectSpent = Date.now() - inspectStarted;
assert.ok(inspectSpent < 100, 'инспекцията на възел с 300 деца е бърза, а взе ' + inspectSpent + ' ms');
assert.ok(printed.length < 200, 'инспекцията е един ред, а е ' + printed.length + ' знака');
assert.match(printed, /<div\.fm-file> · 300 деца/, 'инспекцията казва какво е възелът: ' + printed);

// ── 7. `isConnected`: в документа или не (DEF-92, втората половина) ─────────────
// Без него `ensureModal()` в QR студиото строи ВТОРИ прозорец при всяко отваряне (в браузър
// преизползва същия) и тестът чете стария — тъкмо това скри, че „QR за тази папка“ показва
// адреса на портала. Проверява се и двата отговора, за да не е винаги „true“.
const attached = doc.createElement('div');
attached.setAttribute('id', 'attached');
doc.body.appendChild(attached);
assert.equal(attached.isConnected, true, 'добавен в body възел е свързан');
const detached = doc.createElement('div');
assert.equal(detached.isConnected, false, 'невграден възел не е свързан');
assert.equal(doc.body.isConnected, true, 'body е свързан през documentElement');
const nested = doc.createElement('span');
attached.appendChild(nested);
assert.equal(nested.isConnected, true, 'вгнезден възел наследява свързаността');

console.log('PASS dom-stub: innerHTML се парсва · селектори (#id/.class/[data-x]/потомък/запетая) · click() · dataset/classList · непознат селектор гърми · твърденията не получават възел (DEF-92) · инспекцията е един ред · isConnected');
