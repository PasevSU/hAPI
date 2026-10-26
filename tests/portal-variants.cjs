'use strict';
// Публичната страница на портала съществува в ДВЕ копия: в add-on-а (`hapi_enterprise/portal/`)
// и в интеграцията за Home Assistant (`custom_components/hapi_enterprise/`). Второто е
// съзнателно разклонение — заявките му минават през fail-closed моста на интеграцията, а
// ключът се носи във фрагмента, не в адреса. Разклонението обаче значи, че поправка в едното
// копие може да не влезе в другото, затова тук се пазят ИНВАРИАНТИТЕ, а не байтовете:
//
//   1. данни никога не влизат в `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write` —
//      единственото `innerHTML` е фиксиран SVG път от константна карта (без `${}`);
//   2. динамиката минава през `textContent` (и двете страници го ползват наистина);
//   3. няма `eval`/`new Function` и няма външни ресурси (страницата се отваря и без интернет);
//   4. договорите остават РАЗЛИЧНИ: add-on-ът вика `/api/v1/p/`, интеграцията —
//      `/api/hapi_enterprise/v1/p/` и праща ключа като `X-Portal-Key` (не в адреса).
//
// Ако някой ден копията се слеят, тестът ще го покаже; ако едното изостане по сигурност,
// също.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const plain = (file) => fs.readFileSync(file, 'utf8');

const COPIES = [
  {
    name: 'add-on',
    js: path.join(root, 'hapi_enterprise', 'portal', 'portal.js'),
    html: path.join(root, 'hapi_enterprise', 'portal', 'portal.html'),
    apiPrefix: '/api/v1/p/',
    mustNotContain: ['/api/hapi_enterprise/'],
  },
  {
    name: 'интеграция',
    js: path.join(root, 'custom_components', 'hapi_enterprise', 'portal.js'),
    html: path.join(root, 'custom_components', 'hapi_enterprise', 'portal.html'),
    apiPrefix: '/api/hapi_enterprise/v1/p/',
    mustNotContain: ['/api/v1/p/'],
  },
];

const DANGEROUS = [/\.outerHTML\s*=/, /insertAdjacentHTML\s*\(/, /document\.write\s*\(/, /\beval\s*\(/, /new Function\s*\(/];
const facts = [];

for (const copy of COPIES) {
  const src = plain(copy.js);

  // ── 1. Опасните sink-ове ги няма ─────────────────────────────────────────
  for (const re of DANGEROUS) {
    assert.doesNotMatch(src, re, `${copy.name}: забранен sink ${re} в portal.js`);
  }

  // ── 2. `innerHTML` само за фиксиран SVG път ─────────────────────────────
  // Всяко присвояване трябва да е `svg.innerHTML = paths[...]` и дясната страна да НЕ е
  // шаблон (без `${}`), защото шаблонът е точно мястото, където данните влизат.
  const assignments = [...src.matchAll(/([\w.$]+)\.innerHTML\s*=\s*([^;]+);/g)];
  assert.ok(assignments.length >= 1, `${copy.name}: очаква се поне един innerHTML за иконата`);
  for (const [, target, rhs] of assignments) {
    assert.match(target, /^svg$/, `${copy.name}: innerHTML се пише само в svg, намерено в „${target}“`);
    assert.match(rhs, /^paths\[/, `${copy.name}: дясната страна трябва да е paths[…], намерено: ${rhs.trim().slice(0, 60)}`);
    assert.equal(rhs.includes('${'), false, `${copy.name}: innerHTML не бива да получава шаблон с данни`);
  }

  // ── 3. Динамиката минава през textContent ────────────────────────────────
  const textContent = (src.match(/textContent/g) || []).length;
  assert.ok(textContent >= 10, `${copy.name}: страницата вмъква стойности с textContent (намерени ${textContent})`);

  // ── 4. Никакви външни ресурси (страницата работи и без интернет) ─────────
  // Изключение: XML namespace-ът на SVG (`http://www.w3.org/2000/svg`) е ИДЕНТИФИКАТОР,
  // никога не се тегли — затова е позволен; всичко друго трябва да е локално.
  const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|www\.w3\.org)\b/;
  for (const url of src.match(/https?:\/\/[^\s"'`)]+/g) || []) {
    assert.ok(LOCAL.test(url), `${copy.name}: външен ресурс в portal.js: ${url}`);
  }
  const html = plain(copy.html);
  for (const url of html.match(/https?:\/\/[^\s"'`)]+/g) || []) {
    assert.ok(LOCAL.test(url), `${copy.name}: външен ресурс в portal.html: ${url}`);
  }
  // Скриптовете се зареждат от собствения произход, не от CDN.
  for (const tag of html.match(/<script[^>]*>/g) || []) {
    assert.doesNotMatch(tag, /src\s*=\s*["']https?:/i, `${copy.name}: външен <script src> в portal.html`);
  }

  // ── 5. Договорът на всяко копие е свой и не се разменя ──────────────────
  assert.ok(src.includes(copy.apiPrefix), `${copy.name}: заявките минават през ${copy.apiPrefix}`);
  for (const forbidden of copy.mustNotContain) {
    assert.equal(src.includes(forbidden), false, `${copy.name}: не бива да вика ${forbidden}`);
  }

  const inner = assignments.length;
  facts.push(`${copy.name}: ${inner} innerHTML (само SVG) · ${textContent} textContent · ${copy.apiPrefix}`);
}

// ── 6. Ключът на интеграцията не влиза в адреса ─────────────────────────────
// Това е причината разклонението да съществува: HA логва адресите, затова ключът се държи
// във фрагмента и се праща със заглавка.
const ha = plain(COPIES[1].js);
assert.match(ha, /X-Portal-Key/, 'интеграцията праща ключа като X-Portal-Key');
assert.match(ha, /location\.hash|#token=/, 'ключът идва от фрагмента на адреса');
assert.doesNotMatch(ha, /[?&]token=/, 'ключът не бива да е в query низа (влиза в логовете)');

console.log('PASS portal-variants: ' + facts.join(' · ') + ' · ключът на интеграцията е във фрагмента, не в адреса');
