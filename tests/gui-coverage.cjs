'use strict';
// Покритие на GUI тестовете: всяка функция на интерфейса трябва да има сценарий.
//
// Този тест не пуска сървър — той пази СПИСЪЦИТЕ. Идеята е същата като при
// `tests/ui-coverage.cjs` (маршрут без панел чупи теста), но от другата страна:
//   • всеки таб на „Настройки“ трябва да е в списъка на `gui-sections.cjs`;
//   • всеки бутон (`data-action`) трябва да има ОЧАКВАНЕ в таблицата `CASES`;
//   • всяка навигационна точка от `app.js` трябва да е в `gui-panels.cjs`;
//   • всеки модул, който обявява `window.*Panel`, трябва да се монтира в GUI тест;
//   • забранени са измислени `/v2/...` пътища — точно този клас дефект (мъртви бутони,
//     които връщат 404) беше намерен от новите GUI тестове.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const uiDir = path.join(root, 'hapi_enterprise', 'ui');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const readUi = (file) => fs.readFileSync(path.join(uiDir, file), 'utf8');

const panel = readUi('settings-panel.js');
const sectionsTest = read('tests/gui-sections.cjs');
const panelsTest = read('tests/gui-panels.cjs');
const app = readUi('app.js');

// ── 1. Секциите на „Настройки“ ──────────────────────────────────────────────────
const sectionIds = [...panel.matchAll(/\{ id: '([a-z]+)', label: 'section\./g)].map((m) => m[1]);
assert.ok(sectionIds.length >= 15, 'панелът има поне 15 секции (сега ' + sectionIds.length + ')');
const coveredSections = [...sectionsTest.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
// `general` не е в SECTIONS (това е екранът „Основни“), но се монтира в gui-panels.cjs.
coveredSections.push('general');
const missingSections = sectionIds.filter((id) => !coveredSections.includes(id));
assert.deepEqual(missingSections, [], 'секции без GUI сценарий: ' + missingSections.join(', '));

// ── 2. Всеки бутон има очакване ────────────────────────────────────────────────
// `data-action` се среща и в шаблонен низ (`data-action="' + id + '"`), затова се вземат
// само литералните стойности — те са бутоните, които потребителят вижда по секции.
const actionButtons = [
  ...new Set([
    ...[...panel.matchAll(/data-action="([a-zA-Z0-9]+)"/g)].map((m) => m[1]),
    // Бутоните, които се строят от помощника `form('<id>', …)` — те също са `data-action`.
    ...[...panel.matchAll(/\n\s*form\('([a-zA-Z0-9]+)'/g)].map((m) => m[1]),
  ]),
].sort();
assert.ok(actionButtons.length >= 30, 'поне 30 бутона в панела (сега ' + actionButtons.length + ')');
const caseBlock = sectionsTest.slice(sectionsTest.indexOf('const CASES = {'), sectionsTest.indexOf('// ── Разходка по всички секции'));
assert.ok(caseBlock.length > 500, 'намирам таблицата CASES в gui-sections.cjs');
const missingCases = actionButtons.filter((action) => !new RegExp('\\n\\s{6}' + action + ': \\{').test(caseBlock));
assert.deepEqual(missingCases, [], 'бутони без очакване в GUI теста: ' + missingCases.join(', '));

// Обратното също е вярно: очакване за несъществуващ бутон е мъртъв код в теста.
const caseNames = [...caseBlock.matchAll(/\n\s{6}([a-zA-Z]+): \{/g)].map((m) => m[1]);
const orphanCases = caseNames.filter((name) => !actionButtons.includes(name));
assert.deepEqual(orphanCases, [], 'очаквания за несъществуващи бутони: ' + orphanCases.join(', '));

// ── 3. Всяка навигационна точка е монтирана ─────────────────────────────────────
// Точките без своя секция се монтират директно (`gui-panels.cjs`), а тези със
// `section:` отварят „Настройки“ на тази секция — покрити са от `gui-sections.cjs`.
const navEntries = [...app.matchAll(/\{ id: '([a-z]+)', ico: [^}]*\}/g)].map((m) => ({
  id: m[1],
  section: (m[0].match(/section: '([a-z]+)'/) || [])[1] || null,
}));
assert.ok(navEntries.length >= 16, 'навигацията има поне 16 точки (сега ' + navEntries.length + ')');
const missingNav = navEntries
  .filter((entry) => (entry.section ? !coveredSections.includes(entry.section) : !new RegExp("id: '" + entry.id + "'").test(panelsTest)))
  .map((entry) => entry.id + (entry.section ? ' → секция ' + entry.section : ''));
assert.deepEqual(missingNav, [], 'навигационни точки без GUI тест: ' + missingNav.join(', '));

// ── 4. Всеки панелен модул се монтира някъде ───────────────────────────────────
const panelModules = fs
  .readdirSync(uiDir)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => /window\.[A-Za-z]*Panel\s*=|window\.ReportStudio\s*=/.test(readUi(f)));
assert.ok(panelModules.length >= 8, 'поне 8 панелни модула (сега ' + panelModules.length + ')');
const missingModules = panelModules.filter((file) => !panelsTest.includes("'" + file + "'"));
assert.deepEqual(missingModules, [], 'модули, които никой GUI тест не зарежда: ' + missingModules.join(', '));

// ── 5. Няма измислени пътища (класът дефект, който тестовете хванаха) ──────────
const invented = [
  /\/admin\/api\/v2\/organizations/,
  /\/admin\/api\/v2\/ingest/,
  /\/admin\/api\/v2\/merge/,
  /\/admin\/api\/v2\/conflicts/,
  /\/admin\/api\/v2\/migrate/,
];
for (const file of fs.readdirSync(uiDir).filter((f) => f.endsWith('.js'))) {
  const src = readUi(file);
  for (const pattern of invented) {
    assert.equal(pattern.test(src), false, file + ': интерфейсът вика несъществуващ път ' + pattern + ' — сървърът обслужва тези действия под /admin/api/directory/... или /admin/api/portals/merge');
  }
}

console.log(
  'PASS gui-coverage: ' + sectionIds.length + ' секции · ' + actionButtons.length + ' бутона с очакване · ' +
  navEntries.length + ' навигационни точки · ' + panelModules.length + ' панелни модула · без измислени пътища',
);
