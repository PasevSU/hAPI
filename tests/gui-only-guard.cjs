'use strict';
// Пази СВОЙСТВОТО на `tests/gui-journeys.cjs`: сценариите да минават САМО през интерфейса.
//
// Защо е нужен отделен тест: обещанието „само през GUI“ се чупи тихо — един `server.api()`
// за подготовка и тестът започва да проверява кода през задната врата, а твърдението
// „потребителят може“ става невярно, без никой да забележи.
//
// Проверява се в две посоки:
//   1. статично — в сценариите няма fetch/api/spawn/директен require на add-on модул;
//   2. динамично — обектът, който сценариите получават, НЯМА `api`/`authFetch`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
// Файловете са с CRLF — за да се търсят многоредови откъси, редът се нормализира.
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

const journeys = read('tests/gui-journeys.cjs');
// Проверява се КОДЪТ, не коментарите: обяснението „тук не се ползва server.api“ не е
// нарушение. Затова коментарите се махат предварително (URL-ите с `://` остават цели).
const journeyCode = journeys
  .replace(/\/\*[\s\S]*?\*\//g, '')
  // Редовете са с CRLF — затова се делят по `\r?\n`, иначе `.*$` не стига до края.
  .split(/\r?\n/)
  .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
  .join('\n');
const lib = read('tests/lib/gui-journey.cjs');
const app = read('hapi_enterprise/ui/app.js');
const panel = read('hapi_enterprise/ui/settings-panel.js');

// ── 1. Никаква задна врата в сценариите ────────────────────────────────────────
const FORBIDDEN = [
  ['server.api(', 'подготовка през административното API вместо интерфейса'],
  ['server.authFetch(', 'директна заявка с токен от теста'],
  ['authFetch(', 'директна заявка с токен от теста'],
  ['child_process', 'стартиране на процеси от теста'],
  ['require(\'../hapi_enterprise/', 'ползване на add-on модул направо, вместо през панела'],
  ['require("../hapi_enterprise/', 'ползване на add-on модул направо, вместо през панела'],
  ['globalThis.fetch', 'заобикаляне на панелния fetch'],
  ['XMLHttpRequest', 'заобикаляне на панелния fetch'],
];
const found = FORBIDDEN.filter(([needle]) => journeyCode.includes(needle)).map(([needle, why]) => needle + ' — ' + why);
assert.deepEqual(found, [], 'сценариите излизат извън интерфейса:\n  ' + found.join('\n  '));

// Единствената мрежова операция, позволена на сценария, е отваряне на ВЕЧЕ ПОКАЗАН линк.
const bareFetch = [...journeyCode.matchAll(/(?<![\w.$])fetch\s*\(/g)].length;
assert.equal(bareFetch, 0, 'сценарият вика fetch сам (' + bareFetch + ' пъти) — отварянето на линк става с app.openLink()');
assert.ok(journeys.includes('app.openLink('), 'сценарият отваря показания адрес през app.openLink()');

// ── 2. Машината не дава API на теста ──────────────────────────────────────────
const returnBlock = lib.slice(lib.indexOf('  return {\n    document: doc'));
assert.ok(returnBlock.length > 100, 'намирам обекта, който машината връща');
assert.equal(/\bapi\s*:/.test(returnBlock), false, 'машината не бива да връща `api` — това е задната врата');
assert.equal(/\bauthFetch\s*:/.test(returnBlock), false, 'машината не бива да връща `authFetch`');
// `openLink` е единствената мрежова врата и е САМО за четене.
const openLink = lib.slice(lib.indexOf('async openLink(url)'));
assert.match(openLink.slice(0, 400), /await fetch\(url\);/, 'openLink отваря адреса без тяло и без метод');
assert.equal(/method\s*:/.test(openLink.slice(0, 400)), false, 'openLink не бива да праща заявки с метод (не е действие)');

// ── 3. Сценариите наистина вървят по навигацията и секциите ────────────────────
assert.match(journeys, /app\.navIds\(\)/, 'панелите се обхождат от навигацията, не от списък в теста');
assert.match(journeys, /app\.section\(/, 'секциите се отварят с натискане на таб');
assert.match(journeys, /\[data-section\]/, 'табовете се вземат от екрана, а не от копие на списъка');
assert.match(journeys, /app\.click\('#pf-new'/, 'порталът се създава с бутона от панела');
assert.match(journeys, /app\.openLink\(/, 'адресът се отваря след като панелът го покаже');

const journeyCalls = [...journeys.matchAll(/await journey\('/g)].length;
// Прагът е 70, а сценариите са 70. Новите J65–J69 натискат „Копирай“ на тайната връзка,
// менюто „API ▾“ (копирай / отвори / изтегли), рекурсивния отчет от картата, „Отвори
// портала“ по идентификатор в контролния панел и преизчисляването на пълния пакет хешове.
// J70 и J71 минават през панела с филтри: търсене по име, филтър по тип, подредба по име в
// двете посоки и масова смяна на политиката на два избрани файла. J72 записва профил на
// настройките от общия таб и го изтрива от реда му в списъка. Извън обхвата остават само
// действия, които искат предварително състояние на сървъра (PGP ключ, отнемане на QR
// артефакт или на токен, регистриране на файл от мрежовия дял, записи в картотеката, жива
// задача, подписан PDF) — причините са изброени в края на `tests/gui-journeys.cjs`, а
// самите бутони се пазят от `tests/files-manager.cjs`.
assert.ok(journeyCalls >= 70, 'сценариите са поне 70 (сега ' + journeyCalls + ')');

// Всяка навигационна точка трябва да е достижима: сценарият проверява, че и 17-те са там.
const navIds = [...app.matchAll(/\{ id: '([a-z]+)', ico: [^}]*\}/g)].map((m) => m[1]);
assert.equal(navIds.length, 17, 'app.js изброява 17 навигационни точки');
for (const id of navIds) {
  assert.ok(journeys.includes("'" + id + "'"), 'сценариите не споменават навигационната точка „' + id + '“');
}

// Всяка секция на „Настройки“ трябва да е обходена — сценарият върви по табовете от екрана,
// но проверяваме и че списъкът в панела не е празен.
const sections = [...panel.matchAll(/\{ id: '([a-z]+)', label: 'section\./g)].map((m) => m[1]);
assert.ok(sections.length >= 16, 'панелът има поне 16 секции (сега ' + sections.length + ')');

console.log('PASS gui-only-guard: ' + journeyCalls + ' сценария · 0 задни врати · ' + navIds.length + ' навигационни точки · ' + sections.length + ' секции');
