'use strict';
// Helpers for the file-placement audit: which files exist, what the code requires,
// what the server serves and which files nothing points at.
const fs = require('node:fs');
const path = require('node:path');

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

/**
 * Всички относителни `require('./x')` в един файл.
 *
 * Отчита се САМО истинско извикване: тестовете, които проверяват изходния код, съдържат
 * `require('./x')` като ТЕКСТ в низ или в коментар (напр. „сървърът не бива да съдържа
 * require('../…')“). Затова ред, който е коментар, или извикване, което е вътре в низ, се
 * пропуска — иначе тестът за разположение щеше да съобщава за „липсващ файл“, който никой
 * не зарежда.
 */
function requires(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    for (const m of line.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const before = line.slice(0, m.index);
      const quotes = (before.match(/['"`]/g) || []).length;
      if (quotes % 2 === 1) continue; // вътре в низ: това е текст за проверка, не зареждане
      out.push(m[1]);
    }
  }
  return out;
}

/** Can `spec` be resolved from `fromFile`? Returns the resolved path or null. */
function resolveJs(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, base + '.js', base + '.cjs', base + '.json', path.join(base, 'index.js')]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* следващият кандидат */
    }
  }
  return null;
}

// Всички .js файлове под дадена папка.
const jsFiles = (dir) => walk(dir).filter((f) => f.endsWith('.js'));

module.exports = { walk, rel, requires, resolveJs, jsFiles };
