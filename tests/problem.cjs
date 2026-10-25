'use strict';
// ФОРМАТА НА ГРЕШКАТА Е ДОГОВОР (RFC 9457) — чиста проверка, без сървър.
//
// Защо отделен тест: `fail()` се вика от стотици места. Ако формата се счупи, тя се чупи
// навсякъде наведнъж, а `api-input-errors` вижда само 23 от маршрутите. Тук се проверява
// самата функция: задължителните полета, обратната съвместимост (`error`), устойчивостта при
// непознат код и при липсващо съобщение.
const assert = require('node:assert/strict');
const problem = require('../hapi_enterprise/problem.js');

assert.equal(problem.CODE, 'PROBLEM_DETAILS_RFC9457', 'правилото има код');

// 1. Петте полета, които клиентът може да чете.
const conflict = problem.body(409, 'Заето');
assert.deepEqual(
  Object.keys(conflict).sort(),
  ['detail', 'error', 'status', 'title', 'type'],
  'тялото носи точно договорените полета',
);
assert.equal(conflict.error, 'Заето', 'старото `error` остава (обратна съвместимост)');
assert.equal(conflict.detail, 'Заето', 'детайлът е същото съобщение');
assert.equal(conflict.status, 409, 'status е число, не низ');
assert.equal(conflict.type, 'about:blank', 'типът е about:blank — не делим видове');
assert.equal(conflict.title, 'Conflict', 'заглавието е стандартното за кода');

// 2. Всеки код, който сървърът реално ползва, има заглавие — иначе `title` става „Error“.
for (const code of [400, 401, 403, 404, 405, 406, 409, 410, 413, 415, 422, 429, 500, 502, 503, 504]) {
  const body = problem.body(code, 'x');
  assert.equal(body.title, problem.TITLES[code], `код ${code} има заглавие`);
  assert.notEqual(body.title, 'Error', `код ${code} не пада към общия „Error“`);
}

// 3. Непознат код не гърми и не лъже за статуса.
const weird = problem.body(418, 'чайник');
assert.equal(weird.status, 418, 'непознатият код се запазва');
assert.equal(weird.title, 'Error', 'непознат код → общо заглавие, не измислено');
assert.equal(problem.body('409', 'x').status, 409, 'низът се приема като число');

// 4. Липсващо съобщение не става „undefined“ в отговора.
const empty = problem.body(400);
assert.equal(empty.detail, '', 'липсващото съобщение е празен низ');
assert.equal(empty.error, '', 'и `error` е празен низ, не undefined');

// 5. Нищо не се споделя между извикванията (мутация на един отговор не пипа друг).
const a = problem.body(404, 'a');
a.title = 'счупено';
assert.equal(problem.body(404, 'b').title, 'Not Found', 'всяко извикване връща нов обект');

console.log('PASS problem: RFC 9457 полета · старото `error` · заглавие за всеки реален код · устойчивост при непознат код');
