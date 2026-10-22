'use strict';
// Проверка на самия тестов DOM (`tests/dom-stub.cjs`).
//
// Причината: всички нови GUI тестове стъпват на него. Ако той парсва грешно или връща
// null за селектор, тестовете „минават“, без да са натиснали нищо. Затова тук се
// проверява поведението, което панелите реално ползват.
const assert = require('node:assert/strict');
const { createDocument, parseSelector } = require('./lib/dom-stub.cjs');

const doc = createDocument();

// ── 1. innerHTML се парсва и се търси по него ───────────────────────────────────
const host = doc.createElement('div');
doc.body.appendChild(host);
host.innerHTML = '<h1 id="title">Отчет &amp; тест</h1><button data-action="save">Запази</button><input id="q" value="">';
assert.equal(host.querySelector('#title').textContent, 'Отчет & тест', 'ентите се декодират');
assert.equal(host.querySelectorAll('[data-action]').length, 1, 'намира по data-атрибут');
assert.equal(host.querySelector('button').getAttribute('data-action'), 'save');
assert.equal(host.querySelector('#nope'), null, 'липсващият елемент е null, не изключение');

// ── 2. Потомък, клас, name и списък със запетая ─────────────────────────────────
host.innerHTML =
  '<nav id="nav"><button class="nav-item" data-panel="report">Отчети</button></nav>' +
  '<div class="langs"><button data-lang="bg">BG</button><button data-lang="de">DE</button></div>' +
  '<input name="contactId" value="c1">';
assert.equal(host.querySelector('#nav .nav-item[data-panel="report"]').getAttribute('data-panel'), 'report', 'потомък + клас + атрибут');
assert.equal(host.querySelector('.langs button[data-lang="bg"]').getAttribute('data-lang'), 'bg', 'верига от два елемента');
assert.equal(host.querySelectorAll('.langs button').length, 2, 'всички деца по таг');
assert.equal(host.querySelector('input[name="contactId"]').getAttribute('value'), 'c1', 'атрибут със стойност');
assert.equal(host.querySelector('.pf-form, #nav'), host.querySelector('#nav'), 'списък със запетая връща първия срещнат');

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
assert.equal(doc.getElementById('nav'), host.querySelector('#nav'), 'getElementById работи по цялото дърво');

console.log('PASS dom-stub: innerHTML се парсва · селектори (#id/.class/[data-x]/потомък/запетая) · click() · dataset/classList · непознат селектор гърми');
