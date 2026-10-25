'use strict';
// КАТАЛОГ НА ОДИТНИТЕ СЪБИТИЯ — ГЕНЕРИРАН ОТ КОДА.
//
// Защо: одитът е доказателството „кой какво е правил“. Досега списъкът на събитията
// съществуваше само в главите на хората и в grep — тоест при проверка се разчиташе на спомен,
// а разминаване в името (`file.delete` срещу `file.delete.refused`) не се хващаше от нищо.
//
// Тук събитията се четат от самите извиквания на `audit(...)`:
//   • `audit('име', …)` — низов аргумент;
//   • `audit(условие ? 'а' : 'б', …)` — двете имена на тернарен израз.
// Записва се къде се излъчва всяко име и се отбелязват имената, които НЕ спазват
// конвенцията „малки букви с точки“ — те са наследство и се виждат, вместо да се премълчат.
//
// Употреба:
//   node scripts/audit-events.cjs               # записва документа
//   node scripts/audit-events.cjs --check       # само проверява (код 1 при разлика)
//   node scripts/audit-events.cjs --out=<път>   # друг файл (за тестове)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'documentation', '04_FUNCTION_SPECIFICATIONS', 'AUDIT_EVENTS.md');
// Конвенцията: `област.действие[.подробност]` с малки букви, цифри и долна черта.
const CONVENTION = /^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$/;
const SKIP_DIRS = new Set(['node_modules', 'ui', 'assets', 'fonts', 'rules', 'plugins', 'translations']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (entry.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

/** Имената на събитията във файла, подредени по първо срещане. */
function eventsOf(abs) {
  const src = fs.readFileSync(abs, 'utf8');
  const names = [];
  // `audit('име'`
  for (const m of src.matchAll(/\baudit\(\s*'([A-Za-z0-9_.-]+)'/g)) names.push(m[1]);
  // `audit(условие ? 'а' : 'б'` — и двете имена са събития, ако приличат на име на събитие
  for (const m of src.matchAll(/\baudit\(\s*[^,?]*\?\s*'([A-Za-z0-9_.-]+)'\s*:\s*'([A-Za-z0-9_.-]+)'/g)) {
    for (const name of [m[1], m[2]]) if (name.includes('.')) names.push(name);
  }
  // `auditChain.append('име'` — директно записване, заобикалящо `audit()`
  for (const m of src.matchAll(/auditChain\.append\(\s*'([A-Za-z0-9_.-]+)'/g)) names.push(m[1]);
  return [...new Set(names)];
}

function collect() {
  const map = new Map(); // име → Set(файлове)
  for (const abs of walk(path.join(ROOT, 'hapi_enterprise'))) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    for (const name of eventsOf(abs)) {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name).add(rel);
    }
  }
  return map;
}

function generate() {
  const map = collect();
  const names = [...map.keys()].sort((a, b) => a.localeCompare(b));
  const legacy = names.filter((n) => !CONVENTION.test(n));
  const configYaml = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'config.yaml'), 'utf8');
  const version = (configYaml.match(/^version: "([^"]+)"/m) || [])[1] || 'неизвестна';

  const lines = [
    '# Одитни събития — каталог',
    '',
    `> **Генериран документ.** Версия на кода: **${version}**. Пише се от`,
    '> `node scripts/audit-events.cjs`, проверява се от `tests/audit-events.cjs`.',
    '> Списъкът се чете от самите извиквания на `audit(...)` в `hapi_enterprise/` — ръчна',
    '> редакция се губи при следващото генериране.',
    '',
    `Общо: **${names.length}** събития, излъчвани от **${new Set([...map.values()].flatMap((s) => [...s])).size}** файла.`,
    `От тях **${legacy.length}** не спазват конвенцията „малки букви с точки“ (наследство — виж §3).`,
    '',
    '## 1. Събития по име',
    '',
    '| Събитие | Къде се излъчва |',
    '| ------- | --------------- |',
    ...names.map((name) => `| \`${name}\` | ${[...map.get(name)].sort().map((f) => '`' + f + '`').join(' · ')} |`),
    '',
    '## 2. Защо това е договор, а не списък',
    '',
    'Одитната верига е hash-chained: всеки ред носи `prevHash` на предишния, така че подмяна',
    'или изтриване се вижда без доверена трета страна. Името на събитието е ключът, по който',
    'проверяващият търси „кой е натиснал Изтрий“, затова то не бива да се сменя тихо — смяна на',
    'име е промяна в договора и се записва в CHANGELOG.',
    '',
    '## 3. Имена извън конвенцията (наследство)',
    '',
    legacy.length
      ? [
          'Тези имена са от по-ранни версии и остават, за да не се чупят съществуващи вериги.',
          'Нови събития се добавят само във формата `област.действие`.',
          '',
          '| Събитие | Къде се излъчва |',
          '| ------- | --------------- |',
          ...legacy.map((name) => `| \`${name}\` | ${[...map.get(name)].sort().map((f) => '`' + f + '`').join(' · ')} |`),
        ].join('\n')
      : 'Няма — всички имена спазват конвенцията.',
    '',
  ];
  return lines.join('\n');
}

const text = generate();
const check = process.argv.includes('--check');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const target = outArg ? path.resolve(outArg.slice('--out='.length)) : OUT;
if (check) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (current !== text) {
    console.error('audit-events: документът е остарял — пусни `node scripts/audit-events.cjs`');
    process.exit(1);
  }
  console.log('audit-events: актуален (списъкът съвпада с кода)');
} else {
  fs.writeFileSync(target, text, 'utf8');
  console.log(`audit-events: записан ${path.relative(ROOT, target)} (${text.split('\n').length} реда)`);
}
