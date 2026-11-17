'use strict';
// R2/R4: ДЕЙСТВИЯТА СА В ДЕСНИЯ КРАЙ, РАЗДЕЛИТЕ НА ДИАЛОГ СА РАВНИ.
//
// Защо има тест: на екран се виждаше как разделите на QR студиото се подреждат по дължината
// на текста си (прилепени вляво), а изборът „Ниво“ стоеше в десния край. Всяко от двете е
// разумно, но щом не е закон, следващият прозорец пак ще изглежда другояче. Правилата са в
// `docs/plan/24-ui-positioning-rules.md`.
//
// Защо НЕ мери пиксели: DOM заместникът в тестовете (`tests/lib/dom-stub.cjs`) няма
// оформление — `getBoundingClientRect()` връща нули. Затова равенството се пази там, където
// е ГАРАНТИРАНО: `display:grid` + `grid-auto-columns:1fr` прави колоните равни по определение,
// а тестът проверява точно това + `min-width:0` (за да не чупи дълга дума мрежата).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = (name) => fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', name), 'utf8');
const css = ui('components.css');
const qr = ui('qr-studio.js');

/** Тялото на първото правило за селектор (същият помощник като в `tests/ui-spacing.cjs`). */
const block = (selector) => {
  const at = css.indexOf('\n' + selector + ' {');
  assert.ok(at >= 0, 'липсва правилото ' + selector + ' в components.css');
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
};

// ── 1. R4: разделите на ДИАЛОГ са равни ────────────────────────────────────
for (const selector of ['.qs-tabs', '.tabs.tabs-equal']) {
  const body = block(selector);
  assert.match(body, /display:\s*grid;/, selector + ' трябва да е мрежа, не flex: ' + body.trim());
  assert.match(body, /grid-auto-flow:\s*column;/, selector + ' трябва да подрежда по колони');
  assert.match(body, /grid-auto-columns:\s*1fr;/, selector + ' трябва да дава равни колони (1fr)');
  assert.equal(/display:\s*flex/.test(body), false, selector + ' не бива да е flex — разделите ще са с различна ширина');
  assert.equal(/flex-wrap:\s*wrap/.test(body), false, selector + ' не бива да пренася раздели на нов ред');
}

// Бутоните на разделите пазят текста вътре: без това дълга дума разпъва колоната.
for (const selector of ['.qs-tab', '.tabs.tabs-equal button']) {
  const body = block(selector);
  for (const rule of [/min-width:\s*0;/, /overflow:\s*hidden;/, /text-overflow:\s*ellipsis;/, /white-space:\s*nowrap;/]) {
    assert.match(body, rule, selector + ' трябва да съдържа ' + rule);
  }
  assert.match(body, /text-align:\s*center;/, selector + ' подравнява текста в средата на равната колона');
}

// R4 НЕ се разлива върху лентата с филтри (`.tabs` в Report Studio): там иконите са много.
assert.equal(
  /grid-auto-columns/.test(block('.tabs')),
  false,
  '.tabs (лента с филтри) не бива да става мрежа — равенството е само за `tabs-equal`/`qs-tabs`',
);

// ── 2. R2: действията са в десния край ─────────────────────────────────────
const actions = block('.actions-right');
assert.match(actions, /justify-content:\s*flex-end;/, '.actions-right подравнява групата вдясно');
assert.match(actions, /flex:\s*0 0 auto;/, '.actions-right не се свива при дълго име');
// Дясното прилепване е на РОДИТЕЛЯ: името расте и избутва действията до ръба. Без `margin` —
// така не се вдига ратчето за отстояния (`tests/ui-spacing.cjs`).
assert.match(block('.line-name'), /flex:\s*1 1 auto;/, '.line-name расте и избутва действията вдясно');
assert.match(block('.line'), /gap:\s*var\(--sp-\d+\);/, '.line ползва скалата за междината');

// Името `.row-actions` вече значи ДРУГО (мрежа от бутони за отчет). Новото правило не бива да
// го преизползва — урокът от DEF-81: едно име, едно значение. Старото значение остава живо.
assert.match(block('.row-actions'), /grid-template-columns:/, '.row-actions остава мрежата от бутони, не се преизползва');

// ── 3. R6: числата в ред са вдясно и с таблични цифри ──────────────────────
const num = block('.row-num');
assert.match(num, /text-align:\s*end;/, '.row-num подравнява числата вдясно');
assert.match(num, /font-variant-numeric:\s*tabular-nums;/, '.row-num ползва таблични цифри');

// ── 4. Новите правила не заобикалят другите закони ────────────────────────
for (const selector of ['.qs-tabs', '.qs-tab', '.tabs.tabs-equal', '.actions-right', '.line', '.line-name', '.row-num']) {
  const body = block(selector);
  assert.equal(/!important/.test(body), false, selector + ' не ползва !important');
  assert.equal(/position:\s*absolute/.test(body), false, selector + ' не позиционира абсолютно');
  assert.equal(/\bfloat:/.test(body), false, selector + ' не ползва float');
  // Скалата за отстояния е закон (`tests/ui-spacing.cjs`): тук не влиза нито един px литерал.
  assert.equal(
    /(?:padding|margin|gap)(?:-[a-z-]+)?\s*:[^;]*\d+px/.test(body),
    false,
    selector + ' ползва px литерал вместо var(--sp-*)',
  );
}

// ── 5. Маркъпът на QR студиото пази договора ───────────────────────────────
assert.match(qr, /class="qs-tabs" role="tablist"/, 'разделите на QR студиото са tablist');
assert.match(qr, /role="tab"/, 'всеки раздел е role="tab"');
assert.match(qr, /aria-selected/, 'избраният раздел се обявява с aria-selected');
assert.match(qr, /class="qs-head-right"/, 'изборът на ниво е в дясната част на главата');
assert.ok(
  qr.indexOf('qs-head-right') < qr.indexOf('class="qs-tabs"'),
  'опциите на прозореца (избор на ниво) стоят в главата НАД разделите — R2/R3',
);

// Броят на разделите е в границите на правилото (2–5): повече значат „раздели прозореца“.
const tabsSource = qr.slice(qr.indexOf('const TABS = ['), qr.indexOf('];', qr.indexOf('const TABS = [')));
const tabCount = (tabsSource.match(/^\s*\['/gm) || []).length;
assert.ok(tabCount >= 2 && tabCount <= 5, 'QR студиото трябва да има 2–5 раздела, а има ' + tabCount);

console.log(
  'PASS ui-layout-rules: разделите на диалог са равни (grid 1fr) · действията са в десния край · ' +
    'числата са вдясно с таблични цифри · без float/absolute/!important/px литерали · QR студиото пази tablist',
);
