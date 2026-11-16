'use strict';
// РАЗМЕРЪТ НА ДОКУМЕНТА Е НОРМА, НЕ ВКУС (D-05 от `DOCS_AND_OPTIONS_STRUCTURE.md` §6).
//
// Защо има тест: „компактно“ се разбира различно от всеки, а дългият документ не се чете — точно
// затова `SYSTEM_STATE` и `KNOWN_DEFECTS` растяха с всяко издание. Нормата е живият документ да е
// ≤ 200 реда, а нормативният ≤ 400. Днес 10 документа са над нея; те не се разкъсват наведнъж
// (риск за препратките), а влизат в РАТЧЕТ: таванът е ТЕКУЩИЯТ им размер и само пада.
//
// Таванът пази две неща:
//   1. нов документ над нормата пада веднага;
//   2. документ, който е бил голям, не може да порасне — само да се свие.
// Затова отпускането на таван е забранено: единственият начин редът да изчезне е документът да
// слезе под нормата (тогава записът се маха в СЪЩИЯ комит).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'documentation');
const { documents, classOf } = require(path.join(ROOT, 'scripts', 'docs-class.cjs'));

const LIMIT = { жив: 200, нормативен: 400 };

// Дългът днес (измерен на 0.69.227). Всяко число тук е ОПРАВДАНИЕ да не се пипа сега, не право
// да расте. Маха се, когато документът слезе под нормата.
const CEILING = {
  '01_AS_IS_ARCHITECTURE/SOURCE_INVENTORY.md': 272, // генериран: един ред на файл (+1 за `ui/qr-studio.js`) · `routes/portal-links.js`
  '01_AS_IS_ARCHITECTURE/SYSTEM_STATE.md': 216, // живият отчет за състоянието
  '02_TO_BE_ARCHITECTURE/API_ARCHITECTURE_SPEC.md': 866, // нормативен, чака разделяне по договор
  '02_TO_BE_ARCHITECTURE/API_ENDPOINT_REFERENCE.md': 453, // генериран: един ред на операция (+3 за връзките на QR студиото) // генериран: един ред на операция
  '02_TO_BE_ARCHITECTURE/INTEGRATION_CONTRACTS.md': 402, // нормативен, на ръба
  '08_USER_GUIDES/install-hacs.md': 223,
  '08_USER_GUIDES/installation-layout.md': 236,
  '08_USER_GUIDES/pgp-keys-setup.md': 277,
  '08_USER_GUIDES/portals-contacts-cases.md': 388,
  '08_USER_GUIDES/public-gateway-setup.md': 372,
};

const linesOf = (rel) => {
  const text = fs.readFileSync(path.join(DOCS, rel), 'utf8');
  // Броят се РЕДОВЕТЕ на файла, а не сегментите от `split('\n')`: файл, който завършва с нов ред,
  // дава един сегмент повече и таванът би паднал на реален документ, който не е пораснал.
  const parts = text.split('\n');
  return text.endsWith('\n') ? parts.length - 1 : parts.length;
};

const problems = [];
for (const rel of documents()) {
  const klass = classOf(rel);
  const limit = LIMIT[klass];
  if (!limit) continue; // историческите не се мерят — те не се пипат
  const lines = linesOf(rel);
  const ceiling = CEILING[rel] ?? limit;
  if (lines > ceiling) {
    problems.push(`${rel} · ${klass} · ${lines} реда (таван ${ceiling}, норма ${limit})`);
  }
}

assert.deepEqual(problems, [], 'документ над нормата или над тавана си — свий го, не вдигай тавана');

// Таванът не бива да стои за документ, който вече е под нормата: иначе „дългът“ се превръща в
// разрешение да расте обратно.
const stale = Object.entries(CEILING)
  .filter(([rel, ceiling]) => {
    if (!fs.existsSync(path.join(DOCS, rel))) return true; // преместен/изтрит → редът лъже
    const klass = classOf(rel);
    return !LIMIT[klass] || linesOf(rel) <= LIMIT[klass] || ceiling <= LIMIT[klass];
  })
  .map(([rel]) => rel);
assert.deepEqual(stale, [], 'ред в тавана, който вече не е нужен (документът е под нормата или липсва) — махни го');

console.log(
  `PASS docs-size: ${documents().length} документа · жив ≤ ${LIMIT['жив']} · нормативен ≤ ${LIMIT['нормативен']} · ` +
    `${Object.keys(CEILING).length} в ратчет (таванът само пада)`,
);
