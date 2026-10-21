'use strict';
// Одит преди качване в GitHub: какво влиза в хранилището и няма ли тайни/едри файлове.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '__pycache__', '.pytest_cache']);
const { TEXT_EXT: TEXT, SECRETS, WEIRD_NAME: WEIRD } = require('./secret-patterns.cjs');

// Одитът проверява какво реално би влязло в хранилището, затова спазва .gitignore.
// Иначе локални артефакти (.venv, *.7z архиви) дават фалшиви сигнали при всеки push.
const globToRegExp = (pattern) => {
  let body = pattern.replace(/^\//, '');
  const anchored = body.includes('/');
  body = body
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${anchored ? body : `(?:.*/)?${body}`}(?:/.*)?$`);
};
const gitignorePath = path.join(root, '.gitignore');
// Отрицанията се уважават (release/* + !release/*.ps1) — иначе одитът и експортът
// виждат различен набор от файлове от този, който git реално следи.
const IGNORED = fs.existsSync(gitignorePath)
  ? fs
    .readFileSync(gitignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const negated = line.startsWith('!');
      const pattern = (negated ? line.slice(1) : line).replace(/\/+$/, '');
      return { re: globToRegExp(pattern), negated };
    })
  : [];
const isIgnored = (relPath) => {
  let ignored = false;
  for (const rule of IGNORED) if (rule.re.test(relPath)) ignored = !rule.negated;
  return ignored;
};

const files = [];
const skipped = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const relPath = path.relative(root, abs).split(path.sep).join('/');
    if (isIgnored(relPath)) {
      skipped.push(relPath);
      continue;
    }
    if (entry.isDirectory()) walk(abs);
    else if (entry.isFile()) files.push(abs);
  }
};
walk(root);

const rel = (f) => path.relative(root, f).split(path.sep).join('/');
const big = files.filter((f) => fs.statSync(f).size > 5 * 1024 * 1024).map((f) => `${rel(f)} ${(fs.statSync(f).size / 1048576).toFixed(1)} MB`);
const weird = files.filter((f) => WEIRD.some((re) => re.test(path.basename(f)))).map(rel);
const secrets = [];
for (const file of files) {
  if (!TEXT.test(file) || fs.statSync(file).size > 2 * 1024 * 1024) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const [re, label] of SECRETS) if (re.test(text)) secrets.push(`${rel(file)} → ${label}`);
}

// Големи файлове по вид (за информация).
const byExt = new Map();
for (const file of files) {
  const ext = path.extname(file).toLowerCase() || '(без)';
  byExt.set(ext, (byExt.get(ext) || 0) + 1);
}
const top = [...byExt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

console.log('файлове (без .git/node_modules/dist и .gitignore-изключените):', files.length);
console.log('изключени от .gitignore:', skipped.length);
console.log('най-голям:', files.map((f) => [rel(f), fs.statSync(f).size]).sort((a, b) => b[1] - a[1])[0].join(' '));
console.log('по разширение:', top.map(([e, n]) => `${e}:${n}`).join(' '));
console.log('файлове > 5 MB:', big.length ? big.join(', ') : 'няма');
console.log('подозрителни имена:', weird.length ? weird.join(', ') : 'няма');
console.log('намерени тайни:', secrets.length ? secrets.join(', ') : 'няма');
process.exitCode = big.length || weird.length || secrets.length ? 1 : 0;
