'use strict';
// Достъпност на логиката през GUI.
//
// Изискването е всяка административна функция да е стигаема от конзолата, а не само от API.
// Тестът вади имената на подмаршрутите от `server.js` и проверява кои от тях НЕ се срещат
// в GUI кода (200 знака след литерал `/admin/api/`, за да се хване и шаблонен низ с
// интерполация). Резултатът трябва да съвпада точно с три списъка по-долу:
//
//   • NON_RESOURCES — не са административни ресурси (публичен API, статични пътища);
//   • DYNAMIC_GUI    — стигат се от GUI, но пътят се сглобява динамично (проверено ръчно);
//   • KNOWN_GAPS     — ТУК НЯМА GUI. Това е дългът, който тестът пази видим: ако някой
//                      добави нова функция без панел, тестът пада; ако някой затвори
//                      дупка, тестът също пада, за да се махне редът от списъка.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const uiDir = path.join(root, 'hapi_enterprise', 'ui');
const uiSources = fs
  .readdirSync(uiDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => 'hapi_enterprise/ui/' + f)
  // Генераторът е отделно приложение под `/generator/`, но също е GUI: шаблоните се качват
  // и трият от него, затова способността `generator` не е дупка без интерфейс.
  .concat(['hapi_enterprise/generator/app.js']);
const ui = uiSources.map(read).join('\n');
const serverSrc = read('hapi_enterprise/server.js');

// Имената на подмаршрутите: `parts[3] === 'x'` и т.н. — това е единственият стабилен списък
// в кода; самите маршрути се сглобяват от сегменти.
const names = new Set();
for (const m of serverSrc.matchAll(/parts\[\d\] === '([a-z0-9-]+)'/g)) names.add(m[1]);

const starts = [...ui.matchAll(/\/admin\/api\//g)].map((m) => m.index);
// Името се брои за достъпно, ако се среща като част от път: 200 знака след литерал
// `/admin/api/` (шаблонен низ) ИЛИ като сегмент в кавички/наклонени черти (`'/sign'`).
const coveredByGui = (name) =>
  starts.some((i) => new RegExp('\\b' + name + '\\b').test(ui.slice(i, i + 200))) ||
  new RegExp('[/\'"`]' + name + '([\'"`/?]|$)').test(ui);

// Не са административни ресурси: публичен API и статични пътища.
const NON_RESOURCES = new Set(['admin', 'api', 'v1', 'v2', 'ui', 'site', 'public', 'secret', 'file', 'reveal', 'p', 's']);

// Стигат се от GUI, но пътят се строи динамично (files-manager/portal-files), затова
// литералното търсене не ги вижда. Всяко име тук има панел и тест.
const DYNAMIC_GUI = new Set(['attachments', 'hashes', 'lock', 'notes', 'upload', 'versions', 'register']);

// Дълг: административни функции БЕЗ GUI. На 2026-10-22 бяха затворени осем от девет
// (associate, detach, integrity, integrity-jobs, migrate, sign, signed-url, signing-key,
// verify-signature) — вж. commit „gui: осемте функции без панел са свързани“.
const KNOWN_GAPS = new Map();

const uncovered = [...names].filter((n) => !coveredByGui(n)).sort();
const expected = [...new Set([...NON_RESOURCES, ...DYNAMIC_GUI, ...KNOWN_GAPS.keys()])].sort();
const unexpected = uncovered.filter((n) => !expected.includes(n));

assert.deepEqual(
  unexpected,
  [],
  'нови административни функции без GUI: ' +
  unexpected.join(', ') +
  ' — добави панел в конзолата (или ред в KNOWN_GAPS с причина, ако е съзнателен дълг)',
);

// Затворена дупка не бива да остава в списъка: иначе „дългът“ изгнива.
const fixed = [...KNOWN_GAPS.keys()].filter((n) => !uncovered.includes(n));
assert.deepEqual(
  fixed,
  [],
  'тези функции вече се стигат от GUI — махни ги от KNOWN_GAPS: ' + fixed.join(', '),
);

// Публичният API път на „портална страница“ не бива да се бърка с административен.
for (const gap of KNOWN_GAPS.keys()) {
  assert.ok(serverSrc.includes("'" + gap + "'"), 'маршрутът ' + gap + ' вече не съществува в server.js — обнови списъка');
}

// Интерфейсът, който ги прави достъпни, трябва да е НАЛИЧЕН, а не само споменат: всеки
// контрол се търси по id или data-атрибут в конкретния панел.
const filesManager = read('hapi_enterprise/ui/files-manager.js');
const portalControl = read('hapi_enterprise/ui/portal-control.js');
const settings = read('hapi_enterprise/ui/settings-panel.js');
const CONTROLS = [
  ['подписан URL (файл)', filesManager, "data-signed-url"],
  ['разписка (файл)', filesManager, 'data-receipt'],
  ['проверка на разписка', filesManager, 'data-verify-receipt'],
  ['ключ за подпис (портал)', portalControl, 'pf-rotate-key'],
  ['проверка за цялост (портал)', portalControl, 'pf-integrity'],
  ['фонова проверка (портал)', portalControl, 'pf-integrity-job'],
  ['миграция (настройки)', settings, 'set-migrate-analyze'],
  ['свързване на запис', settings, '/associate'],
  ['отделяне на запис', settings, '/detach'],
];
for (const [label, source, marker] of CONTROLS) {
  assert.ok(source.includes(marker), 'липсва контрол за „' + label + '“ (' + marker + ')');
}

console.log(
  `PASS ui-coverage: ${names.size} подмаршрута · ${uncovered.length} без GUI (${KNOWN_GAPS.size} са известен дълг, ${DYNAMIC_GUI.size} динамични, ${NON_RESOURCES.size} не са ресурси)`,
);
