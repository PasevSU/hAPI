'use strict';
// Обектен регистър на Report Studio: 8 категории, ready / system / planned.
const assert = require('node:assert/strict');
const objects = require('../hapi_enterprise/ui/report-objects.js');
const M = require('../hapi_enterprise/report-manifest.js');

// 1. Всеки готов обект е валиден тип в манифеста (един договор).
for (const o of objects.ready()) {
  assert.ok(M.ELEMENT_TYPES.includes(o.type), `ready тип не е в схемата: ${o.type}`);
}
assert.equal(objects.ready().length, 17, '17 готови обекта: 13 предишни + лого, сертификат, колони, динамичен блок');

// 2. Системните обекти са точно START/STOP.
assert.deepEqual(objects.system().map((o) => o.type).sort(), [M.START, M.STOP].sort());

// 3. Планираните обекти не се добавят (не са в схемата) — без фиктивни функции.
// 0.69.61: списъкът е празен, защото последните четири обекта имат валидация и
// реален рендер в PDF-а (`tests/report-objects-real.cjs` го мери).
for (const o of objects.planned()) {
  assert.equal(M.ELEMENT_TYPES.includes(o.type), false, `planned тип е в схемата: ${o.type}`);
  assert.equal(objects.isReady(o.type), false);
}
assert.equal(objects.planned().length, 0, 'няма планирани обекти — всичко в библиотеката работи');
assert.deepEqual(
  objects.OBJECTS.filter((o) => o.status === 'planned').map((o) => o.type),
  [],
  'остават само наистина несвършените обекти',
);

// 4. Всяка категория съществува и всеки обект е в нея.
for (const o of objects.OBJECTS) {
  assert.ok(objects.CATEGORIES.some((c) => c.id === o.category), `липсва категория за ${o.type}`);
}
assert.equal(objects.CATEGORIES.length, 8);

// 5. Уникални типове.
assert.equal(new Set(objects.OBJECTS.map((o) => o.type)).size, objects.OBJECTS.length);

// 6. Филтриране и етикети.
assert.equal(objects.byCategory('all').length, objects.OBJECTS.length);
assert.deepEqual(objects.byCategory('tables').map((o) => o.type).sort(), ['hash-table', 'table']);
assert.equal(objects.label('rfc3161-start'), 'RFC 3161 START');
assert.equal(objects.label('pagebreak'), 'Нова страница');
assert.equal(objects.isReady('table'), true);
assert.equal(objects.isReady('pagebreak'), true, 'нова страница вече е готов блок');
assert.equal(objects.isReady('subtitle'), true, 'подзаглавие вече е готов блок');
assert.equal(objects.isReady('legal'), true, 'правната декларация вече е готов блок');
assert.equal(objects.isReady('data-block'), true, 'системните данни вече са готов блок');
assert.equal(objects.isReady('columns'), true, 'колоните вече се добавят');
assert.equal(objects.isReady('logo'), true, 'логото вече се добавя');
assert.equal(objects.isReady('certificate'), true, 'сертификатът вече се добавя');
assert.equal(objects.isReady('dynamic'), true, 'динамичният блок вече се добавя');
assert.equal(objects.get('nope'), null);

// 7. Defaults съдържат това, което newBlock очаква.
assert.deepEqual(objects.get('table').defaults.columns, ['name']);
assert.ok(objects.get('hash-table').defaults.algorithms.includes('SHA256'));
assert.ok(Array.isArray(objects.get('metadata').defaults.items));
assert.equal(objects.get('columns').defaults.columns.length, 2, 'колоните тръгват с две');
assert.equal(objects.get('dynamic').defaults.aggregate, 'count', 'динамичният блок тръгва с брой');
assert.equal(objects.get('certificate').defaults.ref, 'cms', 'сертификатът тръгва с CMS сертификата');
assert.equal(objects.get('logo').defaults.widthMm, 40, 'логото тръгва 40 мм широко');

console.log('report-objects OK');
