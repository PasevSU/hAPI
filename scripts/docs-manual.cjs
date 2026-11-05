'use strict';
// ГЕНЕРАТОР НА ПРИЛОЖЕНИЯТА КЪМ ПЪЛНОТО РЪКОВОДСТВО (0.69.161).
//
// Защо генератор, а не ръчно написани таблици: списъкът с 43 опции и списъкът с админ
// маршрути се менят с всяко издание. Ръкописна таблица остарява тихо и започва да лъже;
// тези две приложения се строят от КОДА и се проверяват с `--check` (виж tests/docs-manual.cjs).
//
//   node scripts/docs-manual.cjs           # презаписва приложенията
//   node scripts/docs-manual.cjs --check   # само проверка (exit 1 при разминаване)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'documentation', '09_COMPLETE_MANUAL');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readOrEmpty = (abs) => (fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '');

// ── Опции от config.yaml + описания от en.yaml ──────────────────────────────
function optionsOf() {
  const lines = read('hapi_enterprise/config.yaml').split('\n');
  const start = lines.indexOf('options:');
  if (start < 0) throw new Error('config.yaml: липсва блок options');
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[A-Za-z_]/.test(line)) break;
    const m = /^ {2}([a-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    out.push({ key: m[1], value: value === '' ? '(празно)' : value });
  }
  return out;
}

// Мини-четец на translations/en.yaml: само блоковете `ключ: → name/description`.
function translationOf(lang, key) {
  const lines = read(`hapi_enterprise/translations/${lang}.yaml`).split('\n');
  const start = lines.findIndex((l) => l === `  ${key}:`);
  if (start < 0) return { name: '', description: '' };
  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[a-z0-9_]+:/.test(lines[i])) break;
    block.push(lines[i]);
  }
  const joined = block.join('\n');
  const name = (/ {4}name: (.*)/.exec(joined) || [])[1] || '';
  const descRaw = (/ {4}description: >-\n([\s\S]*)$/.exec(joined) || [])[1] || (/ {4}description: (.*)/.exec(joined) || [])[1] || '';
  const description = descRaw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
  return { name: name.trim(), description };
}

function renderOptions() {
  const options = optionsOf();
  const rows = [];
  rows.push('# Приложение А — всички опции на add-on-а');
  rows.push('');
  rows.push('> Генерирано от `scripts/docs-manual.cjs`; **не се редактира на ръка**.');
  rows.push('> Стойността в колоната „по подразбиране“ е точно това, което издание ' + version() + ' доставя.');
  rows.push('');
  rows.push(`Общо: **${options.length}** опции.`);
  rows.push('');
  rows.push('| Опция | По подразбиране | Име в интерфейса | Какво прави |');
  rows.push('| --- | --- | --- | --- |');
  for (const o of options) {
    const t = translationOf('en', o.key);
    const name = t.name || '';
    const desc = t.description.replace(/\|/g, '\\|');
    rows.push(`| \`${o.key}\` | \`${o.value}\` | ${name} | ${desc} |`);
  }
  rows.push('');
  return rows.join('\n');
}

function version() {
  return (/^version: "([^"]+)"/m.exec(read('hapi_enterprise/config.yaml')) || [])[1] || '';
}

// ── Админ маршрути от admin-api-spec.js ────────────────────────────────────
function routesOf() {
  const src = read('hapi_enterprise/admin-api-spec.js');
  const out = [];
  const re = /\['(GET|POST|PUT|PATCH|DELETE)',\s*'([^']+)',\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ method: m[1], path: m[2], description: m[3] });
  return out;
}

function renderApi() {
  const routes = routesOf();
  const groups = new Map();
  for (const r of routes) {
    // Групата е първите два сегмента след /admin/api — така таблицата се чете по теми.
    const parts = r.path.split('/').filter(Boolean);
    const group = parts.slice(0, 2).join('/') || 'root';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(r);
  }
  const names = [...groups.keys()].sort();
  const out = [];
  out.push('# Приложение Б — административни маршрути');
  out.push('');
  out.push('> Генерирано от `scripts/docs-manual.cjs` от `hapi_enterprise/admin-api-spec.js`;');
  out.push('> **не се редактира на ръка**. Всеки маршрут носи своята способност (виж');
  out.push('> `02_TO_BE_ARCHITECTURE/API_ARCHITECTURE_SPEC.md` за пълния договор).');
  out.push('');
  out.push(`Общо: **${routes.length}** маршрута в **${names.length}** групи.`);
  out.push('');
  out.push('| Група | Маршрути |');
  out.push('| --- | --- |');
  for (const name of names) out.push(`| \`/${name}\` | ${groups.get(name).length} |`);
  out.push('');
  for (const name of names) {
    out.push(`## /${name}`);
    out.push('');
    out.push('| Метод | Път | Какво прави |');
    out.push('| --- | --- | --- |');
    for (const r of groups.get(name)) out.push(`| ${r.method} | \`${r.path}\` | ${r.description.replace(/\|/g, '\\|')} |`);
    out.push('');
  }
  return out.join('\n');
}

const APPENDICES = [
  { file: 'APPENDIX-A-OPTIONS.md', render: renderOptions },
  { file: 'APPENDIX-B-API.md', render: renderApi },
];

const check = process.argv.includes('--check');
let stale = 0;
for (const { file, render } of APPENDICES) {
  const abs = path.join(DIR, file);
  const next = render();
  if (check) {
    if (readOrEmpty(abs) !== next) {
      console.error(`${path.relative(ROOT, abs)} е извън синхрон — пусни: node scripts/docs-manual.cjs`);
      stale++;
    }
    continue;
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(abs, next);
  console.log(`записан ${path.relative(ROOT, abs).replace(/\\/g, '/')}`);
}
if (check) {
  if (stale) process.exit(1);
  console.log(`OK docs-manual: ${APPENDICES.length} приложения в синхрон (версия ${version()})`);
}
