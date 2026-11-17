'use strict';
// ОБЩИЯТ ИНДИКАТОР ЗА РАБОТА СЕ ДЪРЖИ ЕДНАКВО В ЦЕЛИЯ ПАНЕЛ.
//
// Защо има тест: `HapiProgress` е входът, който всеки панел ще ползва, за да покаже „чакам“.
// Ако началото не обявява `role="status"`, ако „готово“ оставя индикатора на екрана или ако
// `set()` не отрязва стойността, чакането пак ще изглежда различно на всяко място.
// Тестът проверява договора без браузър: DOM заместникът е достатъчен, защото тук няма стил,
// а само атрибути и класове (движението е в `components.css`, пази го `tests/ui-motion.cjs`).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDocument } = require('./lib/dom-stub.cjs');

const doc = createDocument({ lang: 'bg' });
const progressModule = require('../hapi_enterprise/ui/upload-progress.js');
const host = doc.createElement('div');
doc.body.appendChild(host);

const begin = (opts) => progressModule.progress({ ...opts, document: doc, host });

// ── 1. Начало: обявено състояние и правилен индикатор ──────────────────────
const wait = begin({ label: 'Изпращане' });
assert.ok(wait.el.classList.contains('pg'), 'индикаторът носи класа .pg');
assert.equal(wait.el.getAttribute('role'), 'status', 'екранният четец знае, че има състояние');
assert.equal(wait.el.getAttribute('aria-live'), 'polite', 'съобщението се обявява учтиво');
assert.equal(wait.el.getAttribute('aria-busy'), 'true', 'контейнерът е „заето“');
assert.ok(wait.el.querySelector('.bar i'), 'без известен край има лента .bar');
assert.equal(wait.el.querySelector('.pg-text').textContent, 'Изпращане', 'надписът идва от викащия');

const think = begin({ mode: 'thinking' });
assert.equal(think.el.querySelectorAll('.think i').length, 3, '„мислене“ е три точки');
assert.ok(!think.el.querySelector('.bar'), '„мислене“ не е лента');

// ── 2. Определен напредък: нативен <progress>, със отрязване ───────────────
const meter = begin({ mode: 'determinate', max: 10 });
const bar = meter.el.querySelector('.pg-meter');
assert.ok(bar, 'определеният напредък ползва <progress> (CSP: без style="width")');
assert.equal(Number(bar.max), 10, 'таванът е зададеният');
meter.set(4);
assert.equal(Number(bar.value), 4, 'стойността стига до мярката');
meter.set(999);
assert.equal(Number(bar.value), 10, 'над тавана се отрязва');
meter.set(-3);
assert.equal(Number(bar.value), 0, 'под нулата се отрязва');
meter.text('Остава малко');
assert.equal(meter.el.querySelector('.pg-text').textContent, 'Остава малко', 'надписът се сменя');

const inside = (el) => host.childNodes.indexOf(el) >= 0;

// ── 3. Край: „готово“ маха индикатора, „провал“ го оставя с обяснение ──────
wait.done();
assert.equal(inside(wait.el), false, 'след „готово“ индикаторът не остава на екрана');

const bad = begin({ label: 'Качване' });
bad.fail('няма връзка');
assert.equal(bad.el.getAttribute('aria-busy'), 'false', 'при провал вече не е „заето“');
assert.ok(bad.el.querySelector('.pg-text').classList.contains('pg-err'), 'провалът се вижда като грешка');
assert.equal(bad.el.querySelector('.pg-text').textContent, 'няма връзка', 'причината остава на екрана');
bad.close();
assert.equal(inside(bad.el), false, 'затварянето маха и проваления индикатор');

// ── 4. „Заето“ върху бутон: спинерът идва от атрибута ──────────────────────
const button = doc.createElement('button');
const release = progressModule.attachBusy(button);
assert.equal(button.getAttribute('aria-busy'), 'true', 'бутонът обявява работа');
assert.equal(button.disabled, true, 'докато работи, не се натиска втори път');
release();
assert.equal(button.getAttribute('aria-busy'), 'false', 'след отмяна състоянието се връща');
assert.equal(button.disabled, false, 'бутонът пак е натискаем');

// ── 5. Договорът не заобикаля другите закони ──────────────────────────────
const source = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', 'upload-progress.js'), 'utf8');
// Коментарите се махат: те ОБЯСНЯВАТ забранения `style="…"`, но не го ползват.
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
assert.equal(/style="/.test(code), false, 'никакъв вграден стил');
assert.equal(/setAttribute\(\s*['"]style/.test(code), false, 'никакъв стил през атрибут');
assert.equal(/window\.open/.test(code), false, 'панелът живее в iframe — без window.open');

console.log(
  'PASS ui-progress: role=status и aria-busy · лента/точки/<progress> по режим · стойността се отрязва · готово маха, провал остава · бутонът обявява работа',
);
