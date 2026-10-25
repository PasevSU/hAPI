'use strict';
// Инвентар на изходния код — ГЕНЕРИРАН, за да не остарява.
//
// Защо съществува: `SOURCE_INVENTORY.md` беше ръчно поддържан и застина на v0.50.0, докато
// `hapi_enterprise/` порасна до 80+ модула. Ръчно поддържан списък на файловете е трета версия
// на истината — затова тук списъкът се чете от диска, а „предназначението“ идва от първия
// коментар в самия файл. Няма как документът да твърди нещо, което кодът не казва.
//
// Употреба:
//   node scripts/source-inventory.cjs           # записва документа
//   node scripts/source-inventory.cjs --check   # само проверява, че е актуален (exit 1 при разлика)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'documentation', '01_AS_IS_ARCHITECTURE', 'SOURCE_INVENTORY.md');
const MAX_PURPOSE = 110;

function version() {
  const yaml = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'config.yaml'), 'utf8');
  return (yaml.match(/^version: "([^"]+)"/m) || [])[1] || 'неизвестна';
}

/** Първият коментар във файла, изчистен; линия от тирета не е описание.
 *  Разпознава `//`, блок `/* … *\/`, Python/shell `#` и docstring (`"""…"""` / `'''…'''`),
 *  защото иначе интеграцията на HA излизаше „без заглавен коментар“, а тя има docstring. */
function purposeOf(abs) {
  let lines;
  try {
    lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/, 24);
  } catch {
    return '(не се чете)';
  }
  const clean = (text) =>
    text
      .replace(/^\/+\s*/, '')
      .replace(/^#+\s*/, '')
      .replace(/^\*+\s*/, '')
      .replace(/^["']{3}\s*/, '')
      .replace(/["']{3}\s*$/, '')
      .replace(/[\u2500-\u257f=*#-]{4,}/g, '')
      .trim();
  // Търси се ПЪРВИЯТ коментар в началото на файла, а не се спира на първия ред код: част от
  // модулите започват с `'use strict'` и няколко `require`, а заглавието е след тях.
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (inBlock) {
      if (line.startsWith('*/')) {
        inBlock = false;
        continue;
      }
      const text = clean(line);
      if (text.length >= 6) return text.length > MAX_PURPOSE ? text.slice(0, MAX_PURPOSE - 1) + '…' : text;
      continue;
    }
    if (line.startsWith('/*')) {
      inBlock = true;
      const text = clean(line);
      if (text.length >= 6) return text.length > MAX_PURPOSE ? text.slice(0, MAX_PURPOSE - 1) + '…' : text;
      continue;
    }
    const isComment = line.startsWith('//') || line.startsWith('#') || /^["']{3}/.test(line);
    if (!isComment) continue;
    const text = clean(line);
    if (text.length < 6) continue;
    return text.length > MAX_PURPOSE ? text.slice(0, MAX_PURPOSE - 1) + '…' : text;
  }
  return '(без заглавен коментар)';
}

function walk(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // `ui/` се показва отделно; вложените папки на `hapi_enterprise/` (fonts, plugins, rules…) не са код.
      if (entry.name === 'ui') continue;
      out.push(...walk(abs, ext));
    } else if (entry.name.endsWith(ext)) {
      out.push(abs);
    }
  }
  return out;
}

function table(files, label) {
  const rows = files
    .map((abs) => ({ name: path.relative(ROOT, abs).replace(/\\/g, '/'), purpose: purposeOf(abs) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const head = [
    `### ${label} (${rows.length})`,
    '',
    '| Файл | Предназначение (първи ред от самия файл) |',
    '| ---- | ----------------------------------------- |',
    ...rows.map((r) => `| \`${r.name}\` | ${r.purpose.replace(/\|/g, '\\|')} |`),
    '',
  ];
  return { head, count: rows.length };
}

function generate() {
  const backend = walk(path.join(ROOT, 'hapi_enterprise'), '.js').filter((abs) => !abs.includes(path.join('hapi_enterprise', 'routes')));
  const routes = walk(path.join(ROOT, 'hapi_enterprise', 'routes'), '.js');
  const uiDir = path.join(ROOT, 'hapi_enterprise', 'ui');
  const ui = fs.existsSync(uiDir) ? walk(uiDir, '.js') : [];
  const py = walk(path.join(ROOT, 'custom_components'), '.py');
  const scripts = walk(path.join(ROOT, 'scripts'), '.cjs');
  // Помощните файлове не са тестове: `helpers.cjs` и всичко в `tests/lib/`.
  const tests = walk(path.join(ROOT, 'tests'), '.cjs').filter((abs) => {
    const rel = path.relative(path.join(ROOT, 'tests'), abs).replace(/\\/g, '/');
    return !rel.startsWith('lib/') && !rel.startsWith('helpers');
  });

  const sections = [
    table(backend, 'Backend модули (`hapi_enterprise/*.js`)'),
    table(routes, 'HTTP компоненти (`hapi_enterprise/routes/*.js`)'),
    table(ui, 'Интерфейс (`hapi_enterprise/ui/*.js`)'),
    table(py, 'Home Assistant интеграция (`custom_components/**/*.py`)'),
    table(scripts, 'Инструменти (`scripts/*.cjs`)'),
  ];

  const lines = [
    '# Source Inventory — hAPI Enterprise (As-Is)',
    '',
    `> **Генериран документ.** Версия на кода: **${version()}**. Пише се от`,
    '> `node scripts/source-inventory.cjs`, проверява се от `tests/source-inventory.cjs`.',
    '> Ръчните редакции се губят при следващото генериране — затова „предназначението“ идва от',
    '> първия коментар в самия файл: документът не може да твърди нещо, което кодът не казва.',
    '',
    `Общо: **${sections[0].count}** backend модула · **${sections[1].count}** HTTP компонента · ` +
    `**${sections[2].count}** UI модула · **${sections[3].count}** Python модула · ` +
    `**${sections[4].count}** инструмента · **${tests.length}** теста.`,
    '',
    'Архитектурните описания са в [`MODULE_CATALOG.md`](MODULE_CATALOG.md); списъкът на',
    'маршрутите — в [`API_ENDPOINT_REFERENCE.md`](../02_TO_BE_ARCHITECTURE/API_ENDPOINT_REFERENCE.md).',
    '',
  ];
  for (const s of sections) lines.push(...s.head);
  return lines.join('\n');
}

const text = generate();
const check = process.argv.includes('--check');
if (check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.error('source-inventory: документът е остарял — пусни `node scripts/source-inventory.cjs`');
    process.exit(1);
  }
  console.log('source-inventory: актуален (списъкът съвпада с диска)');
} else {
  fs.writeFileSync(OUT, text, 'utf8');
  console.log(`source-inventory: записан ${path.relative(ROOT, OUT)} (${text.split('\n').length} реда)`);
}
