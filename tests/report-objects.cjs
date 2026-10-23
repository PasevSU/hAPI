'use strict';
// Обектен регистър на Report Studio: 8 категории, ready / system / planned.
const assert = require('node:assert/strict');
const objects = require('../hapi_enterprise/ui/report-objects.js');
const M = require('../hapi_enterprise/report-manifest.js');

// 1. Всеки готов обект е валиден тип в манифеста (един договор).
for (const o of objects.ready()) {
  assert.ok(M.ELEMENT_TYPES.includes(o.type), `ready тип не е в схемата: ${o.type}`);
}
assert.equal(objects.ready().length, 13);

// 2. Системните обекти са точно START/STOP.
assert.deepEqual(objects.system().map((o) => o.type).sort(), [M.START, M.STOP].sort());

// 3. Планираните обекти не се добавят (не са в схемата) — без фиктивни функции.
for (const o of objects.planned()) {
  assert.equal(M.ELEMENT_TYPES.includes(o.type), false, `planned тип е в схемата: ${o.type}`);
  assert.equal(objects.isReady(o.type), false);
}
assert.equal(objects.planned().length, 4);
assert.deepEqual(
  objects.planned().map((o) => o.type).sort(),
  ['certificate', 'columns', 'dynamic', 'logo'],
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
assert.equal(objects.isReady('columns'), false, 'колоните остават планирани');
assert.equal(objects.get('nope'), null);

// 7. Defaults съдържат това, което newBlock очаква.
assert.deepEqual(objects.get('table').defaults.columns, ['name']);
assert.ok(objects.get('hash-table').defaults.algorithms.includes('SHA256'));
assert.ok(Array.isArray(objects.get('metadata').defaults.items));

console.log('report-objects OK');
