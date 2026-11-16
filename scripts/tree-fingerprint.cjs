'use strict';
// ОТПЕЧАТЪК НА ДЪРВОТО — за да не може остаряла матрица да мине за зелена (0.69.224).
//
// Защо съществува: `release-status` броеше само `passed + skipped == брой тестове`. Отчет от
// преди поправка (напр. 422/426) минаваше за „зелен“, ако броят съвпадна; обратното също —
// отчет от преди промяна в кода изглеждаше актуален. Точно този клас даде DEF-58 и DEF-65,
// но за най-важния артефакт — изхода от матрицата.
//
// Какво влиза в отпечатъка: СЪДЪРЖАНИЕТО на всеки `.js`/`.mjs`/`.cjs`/`.json` файл в
// `hapi_enterprise/`, `tests/` и `scripts/` (без `server_module/` и `core_module/` — те влизат
// по име), плюс `package.json` и `eslint.config.mjs`. Изключени са `reports/`, `dist/`,
// `release/`, `node_modules/`, `.git/` — те се МЕНЯТ от самите гейтове и биха правили
// отпечатъка различен при всеки пуск. `test-matrix.json` също не влиза (той е резултатът).
//
// Защо хеш на СЪДЪРЖАНИЕТО, а не на времена: `mtime` се променя при `git checkout`, при
// копиране и при форматер, без файлът да е променен по смисъл. Съдържанието е това, което
// решава дали миналата серия е валидна.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TREES = ['hapi_enterprise', 'tests', 'scripts'];
const EXTRA = ['package.json', 'eslint.config.mjs', 'hapi_enterprise/Dockerfile'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'reports', 'dist', 'release', 'archive', 'coverage']);
const EXT = /\.(js|mjs|cjs|json|ya?ml)$/;
// `integrity-manifest.json` е ПРОИЗВОДЕН: съдържа `generatedAt` (час) и хешове на другите
// файлове. Ако влезе в отпечатъка, всяко пускане на генератора сменя хеша и матрицата
// изглежда остаряла, без нито един ред код да е променен (измерено на 0.69.225).
const SKIP_FILES = new Set(['integrity-manifest.json']);

function walk(dir, root, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, root, out);
    else if (entry.isFile() && (EXT.test(entry.name) || entry.name === 'Dockerfile')) out.push(full);
  }
  return out;
}

/**
 * Отпечатък на кода, който матрицата е проверила.
 * @param {string} root коренът на хранилището
 * @returns {{hash: string, files: number}}
 */
function fingerprint(root = path.join(__dirname, '..')) {
  const files = [];
  for (const tree of TREES) walk(path.join(root, tree), root, files);
  for (const extra of EXTRA) {
    const full = path.join(root, extra);
    if (fs.existsSync(full)) files.push(full);
  }
  const unique = [...new Set(files)].sort();
  const hash = crypto.createHash('sha256');
  for (const file of unique) {
    // Пътят влиза в хеша: преименуван файл също е промяна по смисъл.
    hash.update(path.relative(root, file).split(path.sep).join('/'));
    hash.update('\u0000');
    hash.update(fs.readFileSync(file));
    hash.update('\u0000');
  }
  return { hash: hash.digest('hex'), files: unique.length };
}

module.exports = { fingerprint, EXTRA, TREES };
