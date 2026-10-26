'use strict';
// `package.json` е договорът с разработчика и с CI: командите в него се пускат на ръка и в
// `.github/workflows/ci.yml`. Нищо не проверяваше този договор, тоест преименуван файл
// (да речем `scripts/export-release.cjs`) чупеше `npm run release:export` тихо — скриптът
// просто спираше да работи, а документацията продължаваше да го препоръчва. Затова тук
// договорът се проверява в ДВЕТЕ посоки:
//   1. всяко `npm run <име>`, споменато в документацията или в CI, съществува;
//   2. всеки скрипт сочи към съществуващ файл (`node x.cjs`, `pwsh -File x.ps1`);
//   3. пътищата, които `lint`-скриптовете обхождат, съществуват — иначе lint тихо
//      проверява по-малко;
//   4. `test`, `lint`, `release`, `release:verify`, `release:haoss`, `changelog:addon`,
//      `status` съществуват и не са празни, защото CI и рънбукът разчитат на тях;
//   5. `node scripts/…`, написано направо в документ, също сочи съществуващ файл.
//
// `CHANGELOG*.md` е ИЗКЛЮЧЕН от проверката за цитати: това е история, а историята има право
// да назовава премахнати команди („тази команда не съществува“ е полезно изречение — и
// тестът го хвана веднага, щом белегът за точно този случай влезе в CHANGELOG-а). Инструкции
// обаче не се изключват: всичко останало се проверява.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};

// ── 1. Документацията и CI цитират само съществуващи команди ────────────────
// `reports/` е генериран: `RELEASE-STATUS.md` цитира дословно CHANGELOG-а, а CHANGELOG-ът
// (изключен по-долу) има право да назовава премахнати команди. Инструкции се търсят там,
// където ги има — в документацията и в CI.
const SKIP_DIR = /[\\/](node_modules|dist|release|build|archive|reports|\.git|coverage)[\\/]/;
const docs = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (SKIP_DIR.test(full)) continue;
    if (entry.isDirectory()) walk(full);
    else if (/\.md$/i.test(entry.name) && !/^CHANGELOG\.md$/i.test(entry.name)) docs.push(full);
  }
};
walk(root);
const workflows = path.join(root, '.github', 'workflows');
if (fs.existsSync(workflows)) {
  for (const f of fs.readdirSync(workflows)) if (/\.ya?ml$/.test(f)) docs.push(path.join(workflows, f));
}
assert.ok(docs.length >= 100, `обходът на документацията намери само ${docs.length} файла — счупен обход`);

const CITE = /\bnpm run ([a-z][a-z0-9]*(?::[a-z0-9]+)*)/g;
const cited = new Map(); // име → [файлове]
const addCited = (name, where) => {
  if (!cited.has(name)) cited.set(name, []);
  if (!cited.get(name).includes(where)) cited.get(name).push(where);
};
for (const doc of docs) {
  const text = fs.readFileSync(doc, 'utf8');
  for (const m of text.matchAll(CITE)) addCited(m[1], path.relative(root, doc).replace(/\\/g, '/'));
}
// Скриптовете също могат да викат други скриптове (`npm run x` вътре в команда).
for (const [name, cmd] of Object.entries(scripts)) {
  for (const m of String(cmd).matchAll(CITE)) addCited(m[1], `package.json:${name}`);
}
assert.ok(cited.size >= 5, `намерени са само ${cited.size} цитата на npm команди — счупен обход`);
const missing = [...cited.keys()].filter((name) => !(name in scripts));
assert.deepEqual(
  missing.map((name) => `${name} ← ${cited.get(name).join(', ')}`),
  [],
  'документацията и CI не бива да викат несъществуващи npm команди',
);

// ── 2. Всеки скрипт сочи към съществуващ файл ───────────────────────────────
const broken = [];
for (const [name, cmd] of Object.entries(scripts)) {
  const text = String(cmd);
  const targets = [];
  for (const m of text.matchAll(/\bnode\s+([\w./-]+\.(?:cjs|js|mjs))/g)) targets.push(m[1]);
  for (const m of text.matchAll(/-File\s+([\w./-]+\.ps1)/g)) targets.push(m[1]);
  for (const target of targets) {
    if (!fs.existsSync(path.join(root, target))) broken.push(`${name} → ${target}`);
  }
}
assert.deepEqual(broken, [], 'скрипт не бива да сочи към липсващ файл');

// ── 3. Lint-скриптовете обхождат съществуващи пътища ────────────────────────
const lintBroken = [];
for (const [name, cmd] of Object.entries(scripts)) {
  if (!/^lint/.test(name)) continue;
  const tokens = String(cmd).split(/\s+/).slice(1); // първият е `eslint`
  for (const token of tokens) {
    if (token.startsWith('-')) continue;
    if (!/^[\w./-]+$/.test(token)) continue;
    const target = path.join(root, token);
    if (!fs.existsSync(target)) lintBroken.push(`${name} → ${token}`);
  }
}
assert.deepEqual(lintBroken, [], 'lint не бива да обхожда липсващ път');

// ── 4. Командите, на които CI и рънбукът разчитат ───────────────────────────
const REQUIRED = ['test', 'lint', 'release', 'release:verify', 'release:haoss', 'changelog:addon', 'status'];
const absent = REQUIRED.filter((name) => typeof scripts[name] !== 'string' || !scripts[name].trim());
assert.deepEqual(absent, [], 'липсват команди, на които CI/рънбукът разчита');

// `lint` е това, което CI пуска — трябва да проверява и кода, и тестовете, и скриптовете.
const lintDirs = String(scripts.lint)
  .split(/\s+/)
  .filter((t) => fs.existsSync(path.join(root, t)) && fs.statSync(path.join(root, t)).isDirectory());
for (const dir of ['hapi_enterprise', 'tests', 'scripts']) {
  assert.ok(lintDirs.includes(dir), `lint трябва да обхожда и ${dir}/`);
}

// ── 5. Документацията не цитира и липсващ скрипт направо по път ─────────────
// `npm run` не е единственият начин да се обяви команда: рънбукът и ръководствата пишат и
// `node scripts/…` направо. Такъв ред се копира в терминала и трябва да работи.
const directMissing = [];
for (const doc of docs) {
  const text = fs.readFileSync(doc, 'utf8');
  for (const m of text.matchAll(/\bnode\s+(scripts[\\/][\w.-]+\.(?:cjs|js))/g)) {
    const target = m[1].replace(/\\/g, '/');
    if (!fs.existsSync(path.join(root, target))) {
      directMissing.push(`${target} ← ${path.relative(root, doc).replace(/\\/g, '/')}`);
    }
  }
}
assert.deepEqual([...new Set(directMissing)], [], 'документацията не бива да цитира липсващ скрипт');

console.log(`package-scripts: ${Object.keys(scripts).length} команди, ${cited.size} цитирани, ${docs.length} документа — наред`);
