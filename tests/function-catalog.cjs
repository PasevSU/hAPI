'use strict';
// ПОРТА: нито една изнасяна функция не остава без тест.
//
// Правилото: за всяка функция, която модул в `hapi_enterprise/` изнася (или връща от
// `create()`), името ѝ трябва да се среща в някой файл от `tests/`. Това е ПРОКСИ за
// покритие — не доказва поведение, но не позволява функция да потъне без нито едно
// извикване. Доказателството за поведение е в самите тестове (вж. „PASS …“ редовете).
//
// Отчетът `reports/FUNCTION-CATALOG.{md,json}` трябва да е пресен: ако някой добави
// функция и тест, но забрави `node scripts/function-catalog.cjs`, портата пада с ясна
// инструкция — така документът не започва да лъже.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { collect, untested } = require('../scripts/function-catalog.cjs');

const modules = collect();
const fnTotal = modules.reduce((n, m) => n + m.functions.filter((f) => f.kind === 'функция').length, 0);
const fnTested = modules.reduce((n, m) => n + m.functions.filter((f) => f.kind === 'функция' && f.tested).length, 0);
const missing = untested();

// T01: няма непокрита функция. Списъкът се показва целият, за да е ясно какво да се напише.
assert.deepEqual(missing, [], 'T01 непокрити функции: ' + (missing.length ? missing.join(', ') : 'няма'));
assert.equal(fnTotal - fnTested, 0, 'T02 разликата между изнесени и покрити функции е нула');

// T03: отчетът е пресен (иначе документът лъже за реалното състояние).
const jsonPath = path.join(__dirname, '..', 'reports', 'FUNCTION-CATALOG.json');
assert.equal(fs.existsSync(jsonPath), true, 'T03 отчетът reports/FUNCTION-CATALOG.json съществува — пусни node scripts/function-catalog.cjs');
const stored = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
assert.equal(stored.fnTotal, fnTotal, 'T04 отчетът е пресен по брой функции — пусни node scripts/function-catalog.cjs');
assert.equal(stored.fnTested, fnTested, 'T05 отчетът е пресен по брой покрити функции — пусни node scripts/function-catalog.cjs');

// T06: същият набор модули, за да не изчезне модул от отчета тихо.
const liveModules = modules.map((m) => m.module).sort();
const storedModules = stored.modules.map((m) => m.module).sort();
assert.deepEqual(liveModules, storedModules, 'T06 отчетът изброява същите модули като кода');

// T07: всяка функция, отбелязана като покрита, наистина има име в тестовете.
const corpus = fs.readdirSync(path.join(__dirname)).filter((f) => f.endsWith('.cjs'))
  .map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
const ghosts = modules.flatMap((m) => m.functions.filter((f) => f.tested && !new RegExp('\\b' + f.name.replace(/[$]/g, '\\$') + '\\b').test(corpus)).map((f) => m.module + ':' + f.name));
assert.deepEqual(ghosts, [], 'T07 няма функция, отбелязана като покрита без име в тестовете');

console.log('PASS function-catalog: ' + fnTotal + ' изнасяни функции в ' + modules.length + ' модула · ' + fnTested + ' покрити с тест · 0 непокрити · отчетът е пресен');
