'use strict';
// РЕГИСТЪРЪТ НА НЕИЗПЪЛНЕНОТО НЕ БИВА ДА ЛЪЖЕ (0.69.210).
//
// Защо има тест: `UNFINISHED_TASKS_*.md` е списък с твърдения за СЪСТОЯНИЕТО („това още го
// няма, защото…“). Такъв списък остарява тихо: щом задача бъде затворена, редът започва да
// твърди нещо невярно и никой не разбира. Затова всяко твърдение тук се сверява с кода:
//   • всеки ОТВОРЕН дефект от регистъра е споменат в анализа (нищо не е премълчано);
//   • твърденията, които днес са верни (липсващ превод, прилепен план, частичен WORM,
//     нечетни px, радиуси без токен), се проверяват — и тестът ПАДА, когато престанат да
//     са верни, за да се обнови документът, вместо да лъже;
//   • решенията, които изглеждат като дупки, но са съзнателни (QR към самата страница,
//     демо режим, остарели пътища), са изброени като забранени за „поправка“.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const doc = fs.readFileSync(path.join(root, 'documentation', '07_RELEASE', 'UNFINISHED_TASKS_0.69.211.md'), 'utf8');
const defects = [
  fs.readFileSync(path.join(root, 'documentation', '01_AS_IS_ARCHITECTURE', 'KNOWN_DEFECTS.md'), 'utf8'),
  fs.readFileSync(path.join(root, 'documentation', '01_AS_IS_ARCHITECTURE', 'KNOWN_DEFECTS_ARCHIVE.md'), 'utf8'),
].join('\n');

// ── 1. Нито един отворен дефект не е премълчан ─────────────────────────────
// Клетките се режат по НЕЕКРАНИРАН `|`: в таблицата има код с `\|\|` (напр. условие
// `if (save \|\| gate)`), а наивният `split('|')` местеше колоната на състоянието и редът
// изглеждаше отворен, без да е (точно това скри DEF-65 от този тест).
const CELL = /(?<!\\)\|/;
const open = [];
let total = 0;
for (const line of defects.split('\n')) {
  const cells = line.split(CELL);
  if (cells.length < 6) continue;
  if (!/^\s*DEF-\d+\s*$/.test(cells[1] || '')) continue;
  total += 1;
  const status = (cells[5] || '').trim();
  if (!status.includes('Затворен')) open.push(cells[1].trim());
}
assert.ok(open.length > 0, 'регистърът не бива да е празен');
assert.ok(total >= open.length, 'общият брой дефекти не може да е по-малък от отворените');
for (const id of open) {
  assert.ok(doc.includes(id), `отвореният дефект ${id} липсва в анализа на неизпълненото`);
}

// ── 2. Твърденията, които днес са верни ────────────────────────────────────
// Преводът на интеграцията на немски СЪЩЕСТВУВА от 0.69.243 (затворен ред в анализа).
assert.ok(
  fs.existsSync(path.join(root, 'custom_components', 'hapi_enterprise', 'translations', 'de.json')),
  'translations/de.json липсва — редът в AUDIT_TASKS го обявява за готов',
);
const deDict = JSON.parse(fs.readFileSync(path.join(root, 'custom_components', 'hapi_enterprise', 'translations', 'de.json'), 'utf8'));
assert.ok(deDict.entity && deDict.entity.sensor && Object.keys(deDict.entity.sensor).length > 20, 'de.json изглежда празен');

// Прилепеният план (DEF-01) стои в дървото.
const plan = path.join(root, 'docs', 'plan', '07-security-v4.3.md');
assert.ok(fs.existsSync(plan), 'docs/plan/07-security-v4.3.md вече го няма — DEF-01 е затворен, обнови анализа');
assert.ok(fs.statSync(plan).size > 100000, 'файлът е променен по размер — прегледай реда за DEF-01');

// WORM остава частичен: локалният диск се пази с права на файла, не с Object Lock.
// Object Lock има САМО в `mirror-target.js` (и то само когато второто копие е S3 с `lockDays`).
const worm = fs.readFileSync(path.join(root, 'hapi_enterprise', 'worm.js'), 'utf8');
assert.equal(
  /x-amz-object-lock/i.test(worm),
  false,
  'worm.js вече слага Object Lock — DEF-06 е напреднал, обнови анализа',
);
const mirror = fs.readFileSync(path.join(root, 'hapi_enterprise', 'mirror-target.js'), 'utf8');
assert.match(mirror, /x-amz-object-lock-mode/, 'анализът твърди, че Object Lock има при S3 мишената — вече го няма');

// Броят на нечетните пиксели и на радиусите без токен не е нула.
const cssFiles = ['tokens.css', 'layout.css', 'components.css', 'themes.css']
  .map((f) => path.join(root, 'hapi_enterprise', 'ui', f));
const css = cssFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const oddPx = (css.match(/(?<![\d.])(1|3|5|7|9)px/g) || []).length;
assert.ok(oddPx > 0, 'нечетните px са изчистени — махни реда от анализа (§4)');
assert.match(doc, /Нечетни `1\/3\/5\/7\/9px`/, 'анализът трябва да изброява нечетните px');
const radiusLiterals = (css.match(/border-radius:\s*\d+px/g) || []).length;
assert.ok(radiusLiterals > 0, 'радиусите са минали на токени — махни реда от анализа (§4)');

// ── 3. Съзнателните „дупки“ са записани като забранени за поправка ─────────
for (const rule of ['DEF-34', 'Демо режим', 'Остарели пътища', 'armv7']) {
  assert.ok(doc.includes(rule), 'анализът трябва да пази съзнателните решения: ' + rule);
}

// ── 4. Анализът не се разминава с броя на отворените дефекти ─────────────
// Кирилицата не е `\w` за `\b`, затова тук се сравнява с `includes`, а не с регулярен израз.
// Общият брой идва от РЕГИСТЪРА (броени редове `DEF-…`), не от литерал: иначе всеки нов
// дефект изисква да се пипа и тестът, и документът, а пропуснатият ред лъже тихо (така
// DEF-61 остана невидим за този тест, докато не се брои).
assert.ok(doc.includes(open.length + ' отворени'), 'броят на отворените дефекти в анализа е друг');
assert.ok(doc.includes(total + ' дефекта'), 'общият брой дефекти в анализа е друг: днес регистърът има ' + total);

// ── 5. Числата за езиковия дълг идват от мерителя, не от памет ─────────────
// Причина: първата версия на §2 цитираше „35 723 знака“, докато ратчето мереше 35 656 —
// преписан номер остарява тихо. Затова анализът НЕ носи жив брой: той цитира тавана и
// сочи теста, който мери. Тук се сверява и двете: таванът е същият като `TOTAL_CEILING`
// в ратчето (сваля ли се там, документът трябва да го последва в същия комит), а броят
// на модулите в таблицата е същият, който анализът обявява.
const ratchet = fs.readFileSync(path.join(root, 'tests', 'ui-i18n-ratchet.cjs'), 'utf8');
const totalCeiling = Number((ratchet.match(/const TOTAL_CEILING = (\d+);/) || [])[1]);
assert.ok(Number.isFinite(totalCeiling) && totalCeiling > 0, 'ратчето трябва да обявява TOTAL_CEILING');
const ceilingTable = (ratchet.match(/const CEILING = \{([\s\S]*?)\n\};/) || [])[1] || '';
const ceilingRows = (ceilingTable.match(/^\s*'[^']+':/gm) || []).length;
assert.ok(ceilingRows >= 20, 'таблицата с тавани в ратчето изглежда празна');
const spaced = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
assert.ok(
  doc.includes(spaced(totalCeiling)),
  'анализът трябва да цитира тавана на езиковия дълг „' + spaced(totalCeiling) + '“ (TOTAL_CEILING в ратчето)',
);
assert.ok(
  doc.includes('**' + ceilingRows + '** модула'),
  'анализът трябва да обявява ' + ceilingRows + ' модула — толкова реда има таблицата на ратчето',
);
assert.ok(
  doc.includes('tests/ui-i18n-ratchet.cjs'),
  'анализът трябва да сочи мерителя на езиковия дълг (tests/ui-i18n-ratchet.cjs), а не да преписва число',
);

console.log(
  `PASS unfinished-register: ${open.length} отворени дефекта (${open.join(', ')}) · de.json наличен · DEF-01 план 120 KB · WORM без Object Lock · ${oddPx} нечетни px · ${radiusLiterals} радиуси без токен · езиков дълг цитира таван ${spaced(totalCeiling)} от ратчето (${ceilingRows} модула)`,
);
