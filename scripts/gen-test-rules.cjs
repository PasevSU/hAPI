'use strict';
// ГЕНЕРАТОР НА КАТАЛОГА С ПРАВИЛАТА (0.69.158).
//
// Защо: дотук картата на сценариите (`tests/scenario-matrix.cjs`) познаваше 62 „области“, а
// останалите ~290 тестови файла се допускаха „ако съдържат assert“. Тоест по-голямата част от
// проверките нямаха нито име, нито дом — нов тест можеше да влезе без никой да го регистрира.
// Сега ВСЕКИ тестов файл е правило с идентификатор; този скрипт произвежда каталога, а
// `scenario-matrix.cjs` пази, че каталогът и папката съвпадат в двете посоки.
//
//   node scripts/gen-test-rules.cjs           # презаписва tests/test-rules.cjs
//   node scripts/gen-test-rules.cjs --check   # само проверява дали е в синхрон (exit 1 ако не е)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TESTS = path.join(ROOT, 'tests');
// Каталогът живее в tests/lib/, а НЕ до тестовете: матрицата пуска всеки `tests/*.cjs`
// като тест и един каталог там би се броял за още един „минал тест“.
const TARGET = path.join(TESTS, 'lib', 'test-rules.cjs');
// Файлове, които не са тестове: общ харнес и самият каталог. Без второто генераторът
// брои собствения си изход и `--check` никога не минава (356 → 357 → …).
const NOT_TESTS = new Set(['helpers.cjs', 'test-rules.cjs']);

// Област по префикс на името. Редът има значение — първото съвпадение печели.
const AREA_BY_PREFIX = [
  ['haoss-', 'HACS издание'],
  ['ha-', 'Home Assistant'],
  ['shared-data', 'споделени данни'],
  ['gui-', 'GUI'],
  ['ui-', 'GUI'],
  ['portal-', 'портал'],
  ['pgp-', 'PGP'],
  ['core-', 'ядро'],
  ['report-', 'отчети'],
  ['tsa-', 'TSA'],
  ['storage-', 'съхранение'],
  ['admin-', 'админ API'],
  ['sqlite-', 'SQLite'],
  ['secret-', 'тайни връзки'],
  ['audit-', 'одит'],
  ['rules-', 'правила'],
  ['release-', 'издаване'],
  ['backup-', 'backup'],
  ['oracle-', 'оракул'],
  ['mirror-', 'огледало'],
  ['transfer-', 'трансфер'],
  ['job-', 'jobs'],
  ['live-', 'потоци'],
  ['public-', 'публичен API'],
  ['package-', 'пакети'],
  ['blackbox-', 'сигурност'],
  ['whitebox-', 'сигурност'],
  ['html-', 'HTML'],
  ['doc-', 'документация'],
  ['docs-', 'документация'],
  ['link-', 'връзки'],
  ['lint-', 'lint'],
  ['error-', 'грешки'],
  ['log-', 'логове'],
  ['phone-', 'телефон'],
  ['sensor-', 'сензори'],
  ['visitor-', 'посетители'],
];

function areaOf(file) {
  const stem = file.replace(/\.cjs$/, '');
  for (const [prefix, area] of AREA_BY_PREFIX) {
    if (stem.startsWith(prefix)) return area;
  }
  return 'общо';
}

// „portal-folder-lock“ → „Портал папка заключване“ е безсмислено; затова заглавието е
// самият идентификатор с интервали и главна буква — честно и стабилно, без измислени имена.
function titleOf(file) {
  const stem = file.replace(/\.cjs$/, '').replace(/-/g, ' ');
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

function collect() {
  return fs
    .readdirSync(TESTS, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.cjs') && !NOT_TESTS.has(e.name))
    .map((e) => e.name)
    // Подредбата е по ИДЕНТИФИКАТОР, не по име на файл: `pgp-aead.cjs` < `pgp.cjs`, но
    // `pgp` < `pgp-aead` — при сортиране по файл каталогът изглежда различен при всяко четене.
    // Сравнението е побайтово: `localeCompare` зависи от ICU, а `? -1 : 1` без клон за
    // равенство бележи critical находка `sort-boolean` в logic-audit.
    .sort((a, b) => Buffer.compare(Buffer.from(a.replace(/\.cjs$/, '')), Buffer.from(b.replace(/\.cjs$/, ''))))
    .map((file) => ({
      id: file.replace(/\.cjs$/, ''),
      owner: `tests/${file}`,
      title: titleOf(file),
      area: areaOf(file),
    }));
}

function render(rules) {
  const lines = rules.map(
    (r) => `  { id: ${JSON.stringify(r.id)}, area: ${JSON.stringify(r.area)}, title: ${JSON.stringify(r.title)}, owner: ${JSON.stringify(r.owner)} },`,
  );
  return `'use strict';
// КАТАЛОГ НА ПРАВИЛАТА — ВСЕКИ тестов файл е правило с идентификатор.
//
// Файлът се ПРОИЗВЕЖДА от scripts/gen-test-rules.cjs; не се редактира на ръка.
// Тестът tests/scenario-matrix.cjs пази, че каталогът и папката tests/ съвпадат в двете
// посоки: нов тестов файл без ред тук е грешка, както и ред без файл.
//
//   node scripts/gen-test-rules.cjs          # презапиши
//   node scripts/gen-test-rules.cjs --check  # само проверка (exit 1 при разминаване)
const RULES = [
${lines.join('\n')}
];

module.exports = { RULES };
`;
}

const rules = collect();
const next = render(rules);
const check = process.argv.includes('--check');

const relTarget = path.relative(ROOT, TARGET).replace(/\\/g, '/');

if (check) {
  const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  if (current !== next) {
    console.error(`${relTarget} е извън синхрон — пусни: node scripts/gen-test-rules.cjs`);
    process.exit(1);
  }
  console.log(`OK test-rules: ${rules.length} правила в синхрон с tests/`);
  process.exit(0);
}

fs.writeFileSync(TARGET, next);
console.log(`записан ${relTarget}: ${rules.length} правила`);
