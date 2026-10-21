'use strict';
// Експорт на „точно това, което би влязло в git“ — без robocopy /MIR по цялото дърво.
//
//   node scripts/export-tracked.cjs --to <директория> [--clean]
//
// Защо: огледалното копие на цялата папка качва и файлове, които никога не е трябвало
// да напускат диска (така веднъж изтекоха частни PGP ключове). Тук обхождането спазва
// .gitignore и допълнително отказва подозрителни имена и файлове с тайни.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { TEXT_EXT, blockingReason } = require('./secret-patterns.cjs');

const root = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'release', '__pycache__', '.pytest_cache', '.venv', 'coverage']);

const argv = process.argv.slice(2);
const option = (name) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined };
const target = option('to');
const clean = argv.includes('--clean');
if (!target) {
  console.error('употреба: node scripts/export-tracked.cjs --to <директория> [--clean]');
  process.exit(2);
}
const dest = path.resolve(target);

// .gitignore → регулярни изрази (същият подход като в pre-push-audit).
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
const IGNORED = fs.existsSync(gitignorePath)
  ? fs.readFileSync(gitignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
    .map((line) => globToRegExp(line.replace(/\/+$/, '')))
  : [];
const isIgnored = (relPath) => IGNORED.some((re) => re.test(relPath));

const files = [];
const skipped = [];
const blocked = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const relPath = path.relative(root, abs).split(path.sep).join('/');
    if (isIgnored(relPath)) { skipped.push(relPath); continue }
    if (entry.isDirectory()) { walk(abs); continue }
    if (!entry.isFile()) continue;
    const size = fs.statSync(abs).size;
    let text = null;
    if (TEXT_EXT.test(abs) && size <= 2 * 1024 * 1024) { try { text = fs.readFileSync(abs, 'utf8') } catch { text = null } }
    const reason = blockingReason(relPath, text);
    if (reason) { blocked.push(reason); continue }
    files.push({ abs, relPath });
  }
};
walk(root);

if (blocked.length) {
  console.error('✗ отказвам експорт — намерени са файлове, които не бива да се публикуват:');
  for (const item of blocked) console.error('  · ' + item);
  process.exit(3);
}

(async () => {
  if (clean) {
    // Изтриваме съдържанието, но НЕ .git — клонът се пази.
    for (const entry of await fsp.readdir(dest).catch(() => [])) {
      if (entry === '.git') continue;
      await fsp.rm(path.join(dest, entry), { recursive: true, force: true });
    }
  }
  let bytes = 0;
  for (const { abs, relPath } of files) {
    const out = path.join(dest, relPath);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.copyFile(abs, out);
    bytes += fs.statSync(abs).size;
  }
  console.log(`експортирани файлове: ${files.length} (${(bytes / 1048576).toFixed(1)} MB)`);
  console.log(`пропуснати по .gitignore: ${skipped.length}`);
  console.log(`дестинация: ${dest}`);
})().catch((e) => { console.error(e); process.exit(1) });
