'use strict';
// ОТСТОЯНИЯТА СА ЦЕНТРАЛИЗИРАН ДОГОВОР, НЕ ЛОКАЛНО ЗАДАНИЕ.
//
// Докладван проблем (0.69.189): интерфейсът нямаше скала за отстояния — 300 декларации
// за padding/margin/gap в `components.css` ползваха 97 различни стойности, а само 23 идваха
// от променлива. Шрифтовете отдавна са централизирани (`--fs-*`), отстоянията — не; оттам
// идват и разминатите „глави“ на блоковете (12px 14px · 8px 12px · 6px) и стойности извън
// 2px решетката (1/3/5/7/9px).
//
// Тестът пази три неща:
//   1. скалата `--sp-*` и радиусите съществуват с ТОЧНИ стойности (те са договорът);
//   1б. СЕМАНТИЧНИТЕ токени (`--gap-panels`, `--pad-card`, …) съществуват и компонентите
//      питат тях, а не „някое“ число от скалата (0.69.205);
//   2. „главите“ на блоковете (където подредбата се засича) нямат нито един px литерал;
//   3. броят на литералните стойности НЕ РАСТЕ (ratchet): днес е 204 отстояния и 43 радиуса,
//      всяко ново локално задание чупи теста и трябва да мине през `var(--sp-*)`.
//      Числата се намаляват, когато се оправят, никога не се вдигат.
//
// Печатните единици (`mm`) са ОТДЕЛЕН договор: хартията се мери в милиметри, екранът — в
// пиксели. Затова тестът иска `mm` да не се появи преди първия `@media print`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = (name) => fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', name), 'utf8');
const tokens = ui('tokens.css');
const css = ui('components.css');

// ── 1. Скалата за отстояния: една решетка на 2px, име = стойност ──────────────
const SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [`--sp-${n}`, `${n * 2}px`]);
for (const [name, value] of SCALE) {
  assert.match(tokens, new RegExp(`${name}: ${value};`), `липсва ${name} = ${value} в tokens.css`);
}
// Радиусите са три нива, не произволно закръгляне.
for (const [name, value] of [['--radius-sm', '6px'], ['--radius-md', '8px'], ['--radius', '10px']]) {
  assert.match(tokens, new RegExp(`${name}: ${value};`), `липсва ${name} = ${value} в tokens.css`);
}

// ── 2. „Главите“ на блоковете са изцяло на скалата ───────────────────────────
/** Изважда тялото на първото правило за селектор. */
const block = (selector) => {
  const at = css.indexOf('\n' + selector + ' {');
  assert.ok(at >= 0, 'липсва правилото ' + selector);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
};
for (const selector of ['.panel-head', '.fm-modal-head', '.pf-block-head']) {
  const body = block(selector);
  const spacing = [...body.matchAll(/(?:^|;)\s*(padding|margin|gap)(?:-[a-z-]+)?\s*:\s*([^;]+)/g)].map((m) => m[2].trim());
  assert.ok(spacing.length >= 2, selector + ' трябва да задава и междина, и отстъп: ' + spacing.join(' · '));
  for (const value of spacing) {
    assert.equal(
      /\d+px/.test(value),
      false,
      selector + ' ползва литерал „' + value + '“ — главните блокове минават само през var(--sp-*)',
    );
  }
  assert.match(body, /var\(--sp-/, selector + ' не ползва скалата за отстояния');
}

// ── 3. Картата на файл: същите мерки за избор, име и икони ───────────────────
assert.match(block('.fm-file'), /gap: var\(--sp-3\);/);
assert.match(block('.fm-file'), /padding: var\(--sp-4\) 1\.2%;/);
assert.match(block('.fm-file-head'), /gap: var\(--sp-3\) var\(--sp-4\);/);
assert.match(block('.fm-file-icons'), /gap: var\(--sp-1\);/);
assert.match(block('.fm-publish'), /gap: var\(--sp-2\);/);
assert.match(block('.fm-file-ico'), /border-radius: var\(--radius-sm\);/);
assert.match(block('.btn'), /padding: var\(--sp-4\) var\(--sp-6\);/);
assert.match(block('.btn'), /border-radius: var\(--radius-md\);/);

// ── 3б. СЕМАНТИЧНИ отстояния: скалата е суровината, договорът е ИМЕТО ────────
// Докладван проблем (0.69.205): скалата съществуваше, но всеки компонент пак избираше
// „някое“ число от нея — затова между панели, карти, бутони и табелки имаше четири
// различни междини. Сега компонентите питат ЗА КАКВО е отстоянието, не „колко“.
const SEMANTIC = [
  ['--gap-panels', /var\(--sp-6\)/],
  ['--gap-cards', /var\(--grid-gap\)/],
  ['--gap-buttons', /var\(--sp-3\)/],
  ['--gap-text', /var\(--sp-2\)/],
  ['--gap-badges', /var\(--sp-2\)/],
  ['--pad-panel', /var\(--sp-7\)/],
  ['--pad-card', /var\(--sp-5\) var\(--sp-6\)/],
];
for (const [name, value] of SEMANTIC) {
  assert.match(tokens, new RegExp(`${name}: ${value.source};`), `липсва семантичен токен ${name}`);
}
// Панел до панел: една междина за всички страници, не margin по всеки панел.
assert.match(block('.panel+.panel'), /margin-top: var\(--gap-panels\);/);
// Картите в таблото: и междина, и отстъп идват от семантиката. Проверяват се САМО
// отстоянията — 1px рамка е линия, не междина.
const spacingOf = (selector) => [...block(selector).matchAll(/(?:^|;)\s*(padding|margin|gap)(?:-[a-z-]+)?\s*:\s*([^;]+)/g)].map(
  (m) => m[2].trim(),
);
for (const selector of ['.dash-grid', '.dash-card']) {
  const spacing = spacingOf(selector);
  assert.ok(spacing.length > 0, selector + ' не задава отстояние');
  for (const value of spacing) {
    assert.equal(/\d+px/.test(value), false, selector + ' ползва литерал „' + value + '“ вместо семантичен токен');
  }
}
assert.match(block('.dash-grid'), /gap: var\(--gap-cards\);/);
assert.match(block('.dash-card'), /gap: var\(--gap-text\);/);
assert.match(block('.dash-card'), /padding: var\(--pad-card\);/);
// Табелките: еднаква междина между две съседни, без ляво/дясно по ръка.
assert.match(block('.state-chip'), /padding: var\(--sp-1\) var\(--sp-4\);/);

// ── 3в. БУТОНИТЕ СА РАВНИ ПО ШИРИНА ────────────────────────────────────────
// „Бутоните не са процентно разпределени по реда“ (0.69.205): всеки бутон беше колкото
// текста си. Група от бутони вече е мрежа с равни дялове (1fr), а самите бутони я пълнят.
for (const selector of ['.quick-grid', '.row-actions']) {
  const body = block(selector);
  assert.match(
    body,
    /grid-template-columns: repeat\(auto-fit, minmax\(\d+em, 1fr\)\);/,
    selector + ' трябва да дели реда на равни дялове (1fr), а не по ширината на текста',
  );
  assert.match(body, /gap: var\(--gap-buttons\);/, selector + ' ползва семантичната междина за бутони');
  assert.equal(/\d+px/.test(body), false, selector + ' ползва px литерал');
  assert.match(block(selector + ' .btn'), /width: 100%;/, selector + ' .btn не пълни своя дял');
}

// ── 4. Печатните единици са само в печатната част ────────────────────────────
const printAt = css.indexOf('@media print');
assert.ok(printAt > 0, 'липсва печатна секция');
const paperBefore = css.slice(0, printAt).match(/\d(?:\.\d+)?mm/g) || [];
assert.deepEqual(paperBefore, [], 'mm преди печатната секция: ' + paperBefore.join(', '));

// ── 5. Ratchet: литералните стойности не растат ──────────────────────────────
const declarations = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) => [
  ...m[2].matchAll(/(?:^|;)\s*(padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?\s*:\s*([^;]+)/g),
].map((d) => d[2].trim()));
const literal = declarations.filter((v) => !/var\(--/.test(v));
const uniqueLiteral = new Set(literal).size;
const radii = [...css.matchAll(/border-radius\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
const literalRadii = radii.filter((v) => !/var\(--/.test(v)).length;

const LIMIT_SPACING = 204;
const LIMIT_UNIQUE = 76;
const LIMIT_RADII = 43;
assert.ok(
  literal.length <= LIMIT_SPACING,
  `литералните отстояния са ${literal.length}, а таванът е ${LIMIT_SPACING}. Ново локално задание → var(--sp-*)`,
);
assert.ok(
  uniqueLiteral <= LIMIT_UNIQUE,
  `уникалните литерални стойности са ${uniqueLiteral}, а таванът е ${LIMIT_UNIQUE}`,
);
assert.ok(
  literalRadii <= LIMIT_RADII,
  `литералните радиуси са ${literalRadii}, а таванът е ${LIMIT_RADII} → var(--radius-sm|md|--radius)`,
);
// Поне една трета от отстоянията минават през променлива — долна граница, за да не
// „печели“ тестът, ако някой върне старите стойности и намали литералите по друг начин.
// 0.69.206: 105 от 309 (беше 56) — преводът на 49 литерала в скалата вдигна дела на 34 %.
const tokenised = declarations.length - literal.length;
assert.ok(
  tokenised >= 105,
  `през променлива минават само ${tokenised} отстояния — договорът иска поне 105`,
);

console.log(
  'PASS ui-spacing: скала --sp-1…--sp-10 · седем семантични токена · равни дялове за бутоните · ' +
  'главите на блоковете без px литерал · ' +
  `${tokenised}/${declarations.length} отстояния през променлива · ` +
  `${literal.length} литерални (таван ${LIMIT_SPACING}) · ${uniqueLiteral} уникални (таван ${LIMIT_UNIQUE}) · ` +
  `радиуси ${literalRadii} литерални (таван ${LIMIT_RADII}) · mm само в печатната част`,
);
