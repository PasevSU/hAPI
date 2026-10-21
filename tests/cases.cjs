'use strict';
// Дела (cases): номер, уникалност, полета по желание (extras), изглед и изтриване.
const assert = require('node:assert/strict');
const C = require('../hapi_enterprise/cases.js');

const db = {};
// Контактът на делото трябва да съществува в директорията.
db.directory = { contacts: [{ id: 'c1', email: 'a@b.co', fields: {} }] };
const c = C.addCase(db, {
  number: '2026-1',
  title: 'Дело 2026-1',
  category: 'Правни дела',
  subject: 'посещение на лице',
  contactId: 'c1',
  extras: [{ key: 'Съд', value: 'СРС' }, { key: '', value: 'skip' }],
});
assert.equal(c.number, '2026-1');
assert.equal(c.category, 'Правни дела');
assert.equal(c.contactId, 'c1');
assert.deepEqual(c.extras, [{ key: 'Съд', value: 'СРС' }]);
assert.throws(() => C.addCase(db, { number: '2026-9', contactId: 'nope' }), /Unknown contact/);
assert.throws(() => C.patchCase(db, c.id, { contactId: 'nope' }), /Unknown contact/);
assert.equal(C.list(db).cases.length, 1);
assert.throws(() => C.addCase(db, { number: '2026-1' }), /already exists/);
assert.throws(() => C.addCase(db, { number: '   ' }), /Invalid case number/);
assert.throws(() => C.addCase(db, { number: '2', extras: 'nope' }), /extras must be an array/);

const p = C.patchCase(db, c.id, { title: 'Ново заглавие', extras: [{ key: 'Статус', value: 'в ход' }] });
assert.equal(p.title, 'Ново заглавие');
assert.deepEqual(p.extras, [{ key: 'Статус', value: 'в ход' }]);
assert.equal(C.caseView(db, c.id).extras[0].key, 'Статус');
assert.equal(C.caseView(db, 'nope'), null);
assert.equal(C.caseById(db, c.id).number, '2026-1');
assert.throws(() => C.patchCase(db, 'nope', {}), /Case not found/);
assert.deepEqual(C.removeCase(db, c.id), { deleted: c.id });
assert.equal(C.list(db).cases.length, 0);
assert.throws(() => C.removeCase(db, 'nope'), /Case not found/);

console.log('cases OK');
