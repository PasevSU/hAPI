'use strict';
// Paptresor — отчетът за прилагане на QR кода (Настройки → Хранилище).
//
// Защо отделен тест: отчетът се строи като HTML низ, който после влиза в `innerHTML`.
// Точно този вид код тихо се разваля — неекраниран текст става таг, „подобрен“ шаблон
// изтегля външен шрифт, а QR картинката изчезва без никой да забележи. Затова:
//   1. съдържанието (марка, портал, адрес, обяснение, рекламки) се проверява по същество;
//   2. текстът от полетата НЕ може да стане таг (екраниране);
//   3. листът е САМОСТОЯТЕЛЕН: без `<script>`, без външни адреси, без `url(...)`,
//      без `@import` — иначе печатът на машина без интернет мълчаливо губи оформление;
//   4. двата листа (плакат и осем етикета) се различават, а етикетите са точно осем.
const assert = require('node:assert/strict');
const path = require('node:path');

const paptresor = require('../hapi_enterprise/ui/paptresor.js');

const PORTAL = {
  id: 'p-2026-001',
  slug: 'dogovor-2026',
  title: 'Договор 2026 — Община Пример',
  visibility: 'public',
  files: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }],
  accessQuery: '?access=abc',
};
const LINK = 'https://example.org/p/p-2026-001?access=abc';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21"/></svg>';

const poster = paptresor.build({
  layout: 'poster',
  portal: Object.assign({}, PORTAL, { link: LINK }),
  qrSvg: SVG,
  brand: 'Paptresor',
  explanation: 'Първи абзац.\n\nВтори абзац.',
  ads: [
    { title: 'Печат', text: 'A4, без интернет' },
    { title: 'Проверка', text: 'сканирай и сравни' },
    { title: 'Втора', text: 'трета рекламка' },
    { title: 'Четвърта', text: 'не се събира' },
  ],
  generatedAt: '22.10.2026 10:30',
});

// ── 1. Плакатът носи всичко, което човек трябва да види на хартия ────────────
assert.match(poster, /^<article class="pt-sheet pt-poster"/, 'плакатът е лист с ясен клас');
assert.ok(poster.includes('Paptresor'), 'марката е на листа');
assert.ok(poster.includes('Договор 2026 — Община Пример'), 'името на портала е на листа');
assert.ok(poster.includes('p-2026-001'), 'идентификаторът на портала е на листа');
assert.ok(poster.includes('dogovor-2026'), 'краткото име е на листа');
assert.ok(poster.includes(LINK), 'адресът, който носи кодът, е изписан');
assert.ok(poster.includes('Публичен'), 'достъпът е преведен, а не суров код');
assert.ok(poster.includes('<strong>3</strong>') || poster.includes('<td>3</td>'), 'броят документи е на листа');
assert.ok(poster.includes('22.10.2026 10:30'), 'датата на издаване е на листа');
assert.ok(poster.includes('Първи абзац.') && poster.includes('Втори абзац.'), 'обяснението е в два абзаца');
assert.ok(poster.includes('Как се прилага'), 'има раздел със стъпките');
assert.ok(poster.includes('Отбелязва се при прилагане'), 'има полета за попълване с ръка');
assert.equal((poster.match(/class="pt-ad"/g) || []).length, 3, 'рекламките са до три — четвъртата не влиза');
assert.equal(poster.includes('не се събира'), false, 'четвъртата рекламка е отрязана');
assert.ok(poster.includes(SVG), 'QR картинката е поставена както е дадена');

// ── 2. Текстът от полетата не може да стане таг ─────────────────────────────
const hostile = paptresor.build({
  portal: { title: '<img src=x onerror=alert(1)>', link: '" onmouseover="alert(1)' },
  brand: '<script>alert(1)</script>',
  explanation: '<b>удебелено</b>',
  ads: [{ title: '<i>курсив</i>', text: '<hr>' }],
  qrSvg: '<svg onload="alert(1)"><script>alert(2)</script></svg>',
  generatedAt: '<x>',
});
assert.equal(/<img|<i>|<b>|<hr>|<x>/.test(hostile), false, 'внесеният HTML е екраниран: ' + hostile.slice(0, 200));
assert.equal(hostile.includes('<script'), false, 'скрипт не влиза в листа дори през QR полето');
assert.ok(hostile.includes('&lt;img'), 'текстът се вижда като текст');
assert.ok(hostile.includes('QR кодът липсва'), 'невалидна QR картинка се заменя с ясно съобщение');

// ── 3. Листът е самостоятелен: нищо не се тегли при печат ──────────────────
for (const [name, html] of [['плакат', poster], ['етикети', paptresor.build({ layout: 'labels', portal: Object.assign({}, PORTAL, { link: LINK }), qrSvg: SVG })]]) {
  assert.equal(/<script/i.test(html), false, name + ': без скриптове');
  assert.equal(/<link\b/i.test(html), false, name + ': без външни стилове');
  // Единственият адрес в листа е адресът на портала; `http://www.w3.org/2000/svg` е
  // именованието на SVG (не се тегли), затова е изключено.
  const external = [...html.matchAll(/https?:\/\/[^\s"'<]+/g)]
    .map((m) => m[0])
    .filter((u) => !u.startsWith(LINK) && !u.startsWith('http://www.w3.org/'));
  assert.deepEqual(external, [], name + ': няма външни адреси освен адреса на портала');
  assert.equal(/\b(src|href)=/i.test(html), false, name + ': нищо не се зарежда отвън');
  assert.equal(/url\(|@import|@font-face/i.test(html), false, name + ': без вградени ресурси');
  assert.equal(/style="/i.test(html), false, name + ': оформлението е в components.css, не в реда');
  assert.equal((html.match(/<article\b/g) || []).length, (html.match(/<\/article>/g) || []).length, name + ': таговете са балансирани');
  assert.equal((html.match(/<section\b/g) || []).length, (html.match(/<\/section>/g) || []).length, name + ': секциите са затворени');
}

// ── 4. Листът с етикети: осем еднакви етикета и обяснение отдолу ────────────
const labels = paptresor.build({
  layout: 'labels',
  portal: Object.assign({}, PORTAL, { link: LINK }),
  qrSvg: SVG,
  explanation: 'Режи по пунктира.',
  ads: [{ title: 'Paptresor', text: 'етикети на A4' }],
  generatedAt: '22.10.2026 10:30',
});
assert.match(labels, /^<article class="pt-sheet pt-labels"/, 'листът с етикети е с ясен клас');
assert.equal((labels.match(/class="pt-label"/g) || []).length, paptresor.LABELS_PER_SHEET, 'точно осем етикета');
assert.equal((labels.match(/class="pt-label"/g) || []).length, 8, 'осем е константата на договора');
for (let n = 1; n <= 8; n += 1) assert.ok(labels.includes('№ ' + n + ' ·'), 'етикет ' + n + ' има ред за номер');
assert.ok(labels.includes('Режи по пунктира.'), 'обяснението остава и на листа с етикети');
assert.ok(labels.includes('етикети на A4'), 'рекламната рекламка стига до листа с етикети');
assert.ok(labels.includes(LINK), 'адресът е на всеки етикет');

// ── 5. Без портал отчетът пак е валиден лист (не гърми и не лъже) ──────────
const bare = paptresor.build({ layout: 'poster' });
assert.ok(bare.includes('Портал без име'), 'липсващият портал е казано с думи');
assert.ok(bare.includes('QR кодът липсва'), 'без картинка се казва, че липсва');
assert.ok(bare.length > 500, 'листът не е празен');

// ── 6. Стойностите по подразбиране съществуват и се ползват ────────────────
assert.equal(paptresor.BRAND, 'Paptresor', 'марката по подразбиране е Paptresor');
assert.equal(paptresor.LAYOUTS.join(','), 'poster,labels', 'двата вида лист са обявени');
assert.ok(paptresor.DEFAULTS.explanation.length > 80, 'обяснението по подразбиране е смислено дълго');
assert.equal(paptresor.DEFAULTS.ads.length, 3, 'три рекламки по подразбиране');
assert.equal(paptresor.DEFAULTS.steps.length, 3, 'три стъпки по подразбиране');
assert.ok(paptresor.build({}).includes(paptresor.DEFAULTS.title), 'заглавието по подразбиране влиза в листа');

// ── 7. Панелът ползва точно този модул и печата само листа ─────────────────
const fs = require('node:fs');
const root = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(root, 'hapi_enterprise', 'ui', 'settings-panel.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'hapi_enterprise', 'ui', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'hapi_enterprise', 'ui', 'components.css'), 'utf8');
assert.ok(panel.includes('window.HapiPaptresor'), 'панелът вика модула, а не собствено копие');
assert.ok(panel.includes("data-action=\"paptresorPreview\"") && panel.includes("data-action=\"paptresorPrint\""), 'двата бутона са в секция „Хранилище“');
assert.ok(/paptresorPrint[\s\S]{0,600}classList\.add\('printing-paptresor'\)/.test(panel), 'печатът слага класа, който скрива останалото');
assert.ok(/finally[\s\S]{0,200}classList\.remove\('printing-paptresor'\)/.test(panel), 'класът се маха и при отказ — иначе следващият печат е празен');
assert.ok(indexHtml.indexOf('paptresor.js') > -1 && indexHtml.indexOf('paptresor.js') < indexHtml.indexOf('settings-panel.js'), 'модулът се зарежда преди панела');
assert.ok(css.includes('body.printing-paptresor #set-section-body > *:not(#set-paptresor-print)'), 'при печат остава само отчетът');
assert.ok(css.includes('@page'), 'има правила за страницата (A4)');

console.log('PASS paptresor: плакат + ' + paptresor.LABELS_PER_SHEET + ' етикета · екраниране · самостоятелен лист · печат само на отчета');
