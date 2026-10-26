'use strict';
// `npm run format` пуска prettier върху `**/*.{js,cjs,mjs,json,css,yml,yaml}`. Дървото НЕ е
// prettier-форматирано (вж. `CONTRIBUTING.md`), тоест командата се пуска само върху файловете,
// които пипаш — но глобът ѝ стига и до ЧУЖДИ пакети и до историята. На 0.69.87 измереното:
// `hapi_enterprise/evidence-portal/` (5 файла) и `hapi_enterprise/generator/` (6 файла) щяха да
// бъдат преформатирани, а пакетът на Evidence View е сверен файл по файл с източника си с
// еднакъв SHA-256 (`documentation/02_TO_BE_ARCHITECTURE/EVIDENCE_PORTAL_V1.2_REVIEW.md`).
// Едно `npm run format` щеше да изтрие тази сверка, без да подобри нищо.
//
// Затова тук се проверява ОБХВАТЪТ на форматирането:
//   1. prettier не пипа чуждите пакети (`evidence-portal`, `generator`) и историята (`archive`);
//   2. prettier не пипа генерираното (`dist`, `release`, `documentation`, `docs`);
//   3. първоначалният код СЕ проверява — `hapi_enterprise/server.js` не е игнориран, иначе
//      „нула различни файла“ би се получавало от игнориране на всичко.
//
// Без инсталиран prettier тестът се прескача с ясно съобщение (в CI тестовете вървят без
// dev зависимости — същият подход като при `eslint-baseline.cjs`).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const prettier = path.join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
if (!fs.existsSync(prettier)) {
  console.log('format-scope SKIPPED (prettier не е инсталиран — вж. `npm ci`)');
  process.exit(0);
}

// `--list-different` печата само файловете, които би променил; игнорираните не се появяват.
const wouldRewrite = (target) => {
  try {
    const out = execFileSync(process.execPath, [prettier, '--list-different', target], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.split(/\r?\n/).filter(Boolean);
  } catch (err) {
    // Код 2 = различни файлове; stdout пак носи списъка.
    return String(err.stdout || '')
      .split(/\r?\n/)
      .filter(Boolean);
  }
};

const countFiles = (dir) => {
  let count = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else count += 1;
    }
  };
  walk(path.join(root, dir));
  return count;
};

const protectedTrees = ['hapi_enterprise/evidence-portal', 'hapi_enterprise/generator', 'archive', 'dist', 'documentation', 'docs'];
const problems = [];
for (const dir of protectedTrees) {
  if (!fs.existsSync(path.join(root, dir))) continue;
  const files = countFiles(dir);
  assert.ok(files > 0, `дървото ${dir} не е празно — иначе проверката е безсмислена`);
  const touched = wouldRewrite(dir);
  if (touched.length) problems.push(`${dir}: prettier би преформатирал ${touched.length} файла → ${touched.slice(0, 3).join(', ')}`);
}
assert.deepEqual(problems, [], 'чужди пакети, история и генерирано съдържание не бива да се форматират');

// Контрола: първоначалният код НЕ е игнориран — значи „нула“ горе идва от игнорирането на тези
// дървета, а не от игнориране на всичко.
const control = 'hapi_enterprise/server.js';
assert.deepEqual(
  wouldRewrite(control),
  [control],
  `първоначалният код трябва да е в обхвата на prettier (за ${control} се очаква разлика, защото дървото не е форматирано)`,
);

console.log(`format-scope: ${protectedTrees.length} защитени дървета · ${control} в обхвата — наред`);
