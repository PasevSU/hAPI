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
//   2. „главите“ на блоковете (където подредбата се засича) нямат нито един px литерал;
//   3. броят на литералните стойности НЕ РАСТЕ (ratchet): днес е 257 отстояния и 49 радиуса,
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

const LIMIT_SPACING = 257;
const LIMIT_UNIQUE = 83;
const LIMIT_RADII = 49;
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
const tokenised = declarations.length - literal.length;
assert.ok(
  tokenised >= 43,
  `през променлива минават само ${tokenised} отстояния — договорът иска поне 43`,
);

console.log(
  'PASS ui-spacing: скала --sp-1…--sp-10 · главите на блоковете без px литерал · ' +
  `${tokenised}/${declarations.length} отстояния през променлива · ` +
  `${literal.length} литерални (таван ${LIMIT_SPACING}) · ${uniqueLiteral} уникални (таван ${LIMIT_UNIQUE}) · ` +
  `радиуси ${literalRadii} литерални (таван ${LIMIT_RADII}) · mm само в печатната част`,
);
