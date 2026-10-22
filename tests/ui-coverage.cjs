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
const uiSources = ['hapi_enterprise/admin.html', 'hapi_enterprise/admin.js'].concat(
  fs.readdirSync(uiDir).filter((f) => f.endsWith('.js')).map((f) => 'hapi_enterprise/ui/' + f),
);
const ui = uiSources.map(read).join('\n');
const serverSrc = read('hapi_enterprise/server.js');

// Имената на подмаршрутите: `parts[3] === 'x'` и т.н. — това е единственият стабилен списък
// в кода; самите маршрути се сглобяват от сегменти.
const names = new Set();
for (const m of serverSrc.matchAll(/parts\[\d\] === '([a-z0-9-]+)'/g)) names.add(m[1]);

const starts = [...ui.matchAll(/\/admin\/api\//g)].map((m) => m.index);
const coveredByGui = (name) => starts.some((i) => new RegExp('\\b' + name + '\\b').test(ui.slice(i, i + 200)));

// Не са административни ресурси: публичен API и статични пътища.
const NON_RESOURCES = new Set(['admin', 'api', 'v1', 'v2', 'ui', 'site', 'public', 'secret', 'file', 'reveal', 'p', 's']);

// Стигат се от GUI, но пътят се строи динамично (files-manager/portal-files), затова
// литералното търсене не ги вижда. Всяко име тук има панел и тест.
const DYNAMIC_GUI = new Set(['attachments', 'hashes', 'lock', 'notes', 'upload', 'versions']);

// Дълг: административни функции БЕЗ GUI. Всяка има причина и трябва да се затвори с панел.
const KNOWN_GAPS = new Map([
  ['associate', 'свързване на запис със случай — има API, няма панел'],
  ['integrity', 'проверка за цялост на файл на портал — има API; конзолата проверява само одитната верига'],
  ['integrity-jobs', 'фонови проверки за цялост — има API, няма панел'],
  ['migrate', 'миграция на хранилището (GET статус + POST пускане) — има API, няма панел'],
  ['register', 'регистриране на дървото на кабинета (tree/register) — има API, няма бутон'],
  ['sign', 'разписка (HMAC-SHA256) за файл — има API, няма панел'],
  ['signed-url', 'подписан URL за файл на портал — има API, няма бутон'],
  ['signing-key', 'ротация на ключа за подпис на портала — има API, няма бутон'],
  ['verify-signature', 'проверка на разписка (HMAC) — има API, няма панел'],
]);

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

console.log(
  `PASS ui-coverage: ${names.size} подмаршрута · ${uncovered.length} без GUI (${KNOWN_GAPS.size} са известен дълг, ${DYNAMIC_GUI.size} динамични, ${NON_RESOURCES.size} не са ресурси)`,
);
