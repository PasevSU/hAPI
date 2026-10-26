'use strict';
// `eslint-suppressions.json` е обявен за „базова линия“: `ci.yml` казва, че тя пази днешното
// състояние и че НОВА находка чупи работата, а `CONTRIBUTING.md` — че държи наследения код тих,
// без да крие нищо, защото всеки брой се вижда във файла. Нищо не проверяваше дали това е вярно.
//
// Защо това има значение: ESLint 10 прилага базовата линия ПО ПОДРАЗБИРАНЕ (не е нужен флаг),
// тоест `npx eslint .` с код 0 НЕ значи „няма находки“ — значи „няма находки извън базата“.
// На 0.69.87 измереното е 218 находки в 136 файла, всичките покрити от 166 записа със сума 218.
// Ако базата се разреди (оправим находка, но не я изчистим), тя тихо разрешава точно толкова
// НОВИ нарушения на същия файл и правило; ако се появи нов вид находка, базата не я покрива и
// тя пада на гейта — това е желаното, но никой не го беше записал като проверка.
//
// Затова базата се сверява с ИЗМЕРЕНОТО, при това с базата, преместена настрана (иначе
// ESLint я прилага и измерването винаги е нула):
//   1. всеки файл в базата съществува;
//   2. всяко правило в базата е реално правило на eslint;
//   3. броят на всяко (файл, правило) е ТОЧНО толкова, колкото eslint намира без базата —
//      нито един повече (разредена база) и нито един по-малко (база, която не покрива);
//   4. няма находка, която базата да не покрива — иначе гейтът щеше да е червен.
//
// Когато `eslint` липсва (тестовете в CI вървят без dev зависимости), тестът се прескача с
// ясно съобщение — същият подход като при `pgp-gpg-interop.cjs` и липсващия gpg.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const baselinePath = path.join(root, 'eslint-suppressions.json');
const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');

if (!fs.existsSync(eslintBin)) {
  console.log('eslint-baseline SKIPPED (eslint не е инсталиран — вж. `npm ci`)');
  process.exit(0);
}
assert.ok(fs.existsSync(baselinePath), 'базов файл съществува, дори когато е празен');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

// ── 1. Всеки файл в базата съществува ──────────────────────────────────────
const files = Object.keys(baseline);
const goneFiles = files.filter((f) => !fs.existsSync(path.join(root, f)));
assert.deepEqual(goneFiles, [], 'запис за изтрит файл не пази нищо — изчисти го с `npm run lint:prune`');

// ── 2. Измерване БЕЗ базата (иначе ESLint я прилага и всичко е нула) ───────
const TARGETS = ['hapi_enterprise', 'tests', 'custom_components', 'scripts'];
const measuring = `${baselinePath}.measuring`;
fs.renameSync(baselinePath, measuring);
let raw;
try {
  raw = execFileSync(process.execPath, [eslintBin, ...TARGETS, '--format', 'json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  raw = err.stdout || '[]'; // находките са причина за ненулев код, а не повреда
} finally {
  fs.renameSync(measuring, baselinePath);
}

const actual = new Map(); // "файл\0правило" → брой
let untyped = 0;
for (const file of JSON.parse(raw)) {
  const rel = path.relative(root, file.filePath).replace(/\\/g, '/');
  for (const message of file.messages) {
    if (!message.ruleId) {
      untyped += 1; // синтактична грешка: не се потиска и не бива да я има
      continue;
    }
    const key = `${rel}\u0000${message.ruleId}`;
    actual.set(key, (actual.get(key) || 0) + 1);
  }
}
assert.equal(untyped, 0, 'няма синтактични грешки (те не се покриват от базата)');

// ── 3. Всяко правило в базата е реално правило ─────────────────────────────
const printedConfig = JSON.parse(
  execFileSync(process.execPath, [eslintBin, '--print-config', 'hapi_enterprise/server.js'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }),
);
const knownRules = new Set(Object.keys(printedConfig.rules || {}));
const unknownRules = [];
for (const [file, rules] of Object.entries(baseline)) {
  for (const rule of Object.keys(rules)) if (!knownRules.has(rule)) unknownRules.push(`${file} → ${rule}`);
}
assert.deepEqual(unknownRules, [], 'базата не бива да съдържа несъществуващи правила');

// ── 4. Базата е ТОЧНА: записаното съвпада с измереното, без непокрити ──────
const loose = [];
for (const [file, rules] of Object.entries(baseline)) {
  for (const [rule, entry] of Object.entries(rules)) {
    const found = actual.get(`${file}\u0000${rule}`) || 0;
    if (entry.count !== found) loose.push(`${file} → ${rule}: в базата ${entry.count}, измерени ${found}`);
  }
}
assert.deepEqual(loose, [], 'базата не бива да е разредена — пусни `npm run lint:prune` (или `lint:baseline` след умишлено връщане на дълг)');

const uncovered = [...actual.keys()].filter((key) => {
  const [file, rule] = key.split('\u0000');
  return !baseline[file] || !baseline[file][rule];
});
assert.deepEqual(
  uncovered.map((key) => key.replace('\u0000', ' → ')),
  [],
  'има находка, която базата не покрива (гейтът трябва да е червен — оправи кода, не разширявай базата)',
);

const totalBaseline = Object.values(baseline).reduce((sum, rules) => sum + Object.values(rules).reduce((s, e) => s + e.count, 0), 0);
const totalActual = [...actual.values()].reduce((a, b) => a + b, 0);
assert.equal(totalActual, totalBaseline, 'сумата на базата съвпада с измерената');

console.log(`eslint-baseline: ${files.length} файла · ${totalBaseline} записа · ${totalActual} находки — базата е точна`);
