'use strict';
// ПАЗАЧ: Report Studio го няма никъде (ADR-0028, D10, 0.69.242).
//
// Защо има тест: премахването на 91 698 байта интерфейс е лесно да се „върне“ случайно —
// един `<script>` таг, един запис в allowlist-а или един раздел в менюто и студиото пак
// съществува, без никой да разбере. Тестът проверява ВСЯКО място, на което то се виждаше:
//   1. файловете липсват (студио, обхвати, обекти) и нищо не ги зарежда;
//   2. allowlist-ът на статиката ги няма (иначе 404-то е само защото файлът липсва);
//   3. няма раздел в менюто, който да сочи `ReportStudio` — разделът `report` води към
//      списъка с линкове (`HapiReportsPanel`);
//   4. няма висящи ключове в речника (`rs.*`, `report.scope.*`) и няма извиквания на
//      изчезналите глобални обекти в останалите модули;
//   5. СЪРВЪРНИЯТ рендър остава — той е това, което строи отчетите днес.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const addon = path.join(root, 'hapi_enterprise');
const read = (rel) => fs.readFileSync(path.join(addon, rel), 'utf8');

// ── 1. Файловете ги няма ────────────────────────────────────────────────────
for (const gone of ['ui/report-studio.js', 'ui/report-scope.js', 'ui/report-objects.js']) {
  assert.equal(fs.existsSync(path.join(addon, gone)), false, 'файлът трябва да е изтрит: ' + gone);
}
// СЪРВЪРНИЯТ рендър остава: новите отчети минават през него.
for (const kept of ['report-manifest.js', 'report-render.js', 'report-package.js', 'report-stamp.js']) {
  assert.ok(fs.existsSync(path.join(addon, kept)), 'сървърният рендър остава: ' + kept);
}

// ── 2. Нищо не ги зарежда и allowlist-ът ги няма ───────────────────────────
const indexHtml = read('ui/index.html');
for (const gone of ['report-studio.js', 'report-scope.js', 'report-objects.js']) {
  assert.equal(indexHtml.includes(gone), false, 'index.html не бива да зарежда ' + gone);
}
assert.ok(indexHtml.includes('reports-panel.js'), 'index.html зарежда панела „Отчети“');
const allowlist = JSON.parse(read('ui-files.json'));
const served = Object.values(allowlist).map(([rel]) => rel);
for (const gone of ['ui/report-studio.js', 'ui/report-scope.js', 'ui/report-objects.js']) {
  assert.equal(served.includes(gone), false, 'allowlist-ът не бива да сервира ' + gone);
}
assert.ok(served.includes('ui/reports-panel.js'), 'allowlist-ът сервира панела „Отчети“');

// ── 3. Менюто: разделът `report` води към списъка с линкове ────────────────
const app = read('ui/app.js');
assert.equal(/global:\s*'ReportStudio'/.test(app), false, 'менюто не бива да сочи изчезналия ReportStudio');
assert.match(app, /global:\s*'HapiReportsPanel'/, 'разделът `report` сочи панела „Отчети“');
// Симетрията на менюто не се пипа от това премахване: разделът остава, сменя се само панелът.
const visible = [...app.matchAll(/\{ id: '([a-z]+)', ico: '[a-z-]+'(?:, section: '[a-z]+')?, group: '([a-z]+)' \}/g)];
assert.ok(visible.length >= 16, 'менюто пази поне 16 раздела, намерени ' + visible.length);

// ── 4. Никакви висящи препратки в останалите модули ────────────────────────
const uiFiles = fs.readdirSync(path.join(addon, 'ui')).filter((name) => name.endsWith('.js'));
const leftovers = [];
for (const name of uiFiles) {
  const source = fs.readFileSync(path.join(addon, 'ui', name), 'utf8');
  for (const symbol of ['HapiReportStudio', 'HapiReportScope', 'HapiReportObjects', 'window.ReportStudio@']) {
    // `@` в името е маркер за „точно този идентификатор“, а не част от друг.
    const needle = symbol.replace('@', '');
    if (new RegExp('\\b' + needle + '\\b').test(source)) leftovers.push(name + ' → ' + needle);
  }
}
assert.deepEqual(leftovers, [], 'няма модул, който да вика изчезналите обекти: ' + leftovers.join(', '));
const i18n = read('ui/i18n.js');
assert.equal(/'rs\.[a-z]/.test(i18n), false, 'речникът не бива да пази ключове `rs.*`');
assert.equal(/'report\.scope\./.test(i18n), false, 'речникът не бива да пази ключове `report.scope.*`');
assert.match(i18n, /'rp\.title':/, 'речникът има ключовете на панела „Отчети“');

// ── 5. Панелът съществува и чете листа ─────────────────────────────────────
const panel = read('ui/reports-panel.js');
assert.match(panel, /window\.HapiReportsPanel\s*=\s*\{\s*mount/, 'панелът се обявява за менюто');
assert.match(panel, /\/admin\/api\/v2\/reports\/links/, 'панелът чете листа с линковете');
assert.match(panel, /'DELETE'/, 'панелът може да изтрие отчет (линкът спира да работи)');
// Разметката е СТАТИЧНА (един шаблон), а всичко от сървъра влиза чрез `textContent` —
// иначе име на файл от портала можеше да стане HTML.
assert.match(panel, /\.textContent\s*=/, 'данните се рисуват като текст');
assert.equal(/innerHTML\s*=\s*[^\s`]/.test(panel), false, 'панелът не строи разметка от данни');

console.log('PASS report-studio-removed: 3 файла изтрити · allowlist и меню без студио · без висящи ключове · рендърът остава');
