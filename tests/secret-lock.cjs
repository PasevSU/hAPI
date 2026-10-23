'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ОРАКУЛ: заключването на тайна по id не изтича.
//
// Дефектът (намерен от одита, 0.69.43): в Map се слагаше `previous.then(() => current)`,
// а се изчистваше само при `get(id) === current` — условие, което никога не е вярно.
// Всеки преглед на тайна оставяше запис в Map завинаги: бавен теч на памет и мъртъв
// код за изчистване. Тестът проверява и семантиката (сериализация по id), и че
// заключванията се МАХАТ.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('node:assert/strict');
const { create } = require('../hapi_enterprise/secret-lock');

(async () => {
  const lock = create();
  const events = [];

  // 1. Две едновременни извиквания за един и същ id се сериализират.
  const step = (name, ms) => async () => {
    events.push(name + ':start');
    await new Promise((r) => setTimeout(r, ms));
    events.push(name + ':end');
    return name;
  };
  const [a, b] = await Promise.all([lock('secret-1', step('A', 40)), lock('secret-1', step('B', 5))]);
  assert.deepEqual([a, b], ['A', 'B'], 'резултатите се връщат по ред');
  assert.deepEqual(events, ['A:start', 'A:end', 'B:start', 'B:end'], 'второто изчаква първото: ' + events.join(' → '));
  assert.equal(lock.size(), 0, 'след приключване не остава заключване (беше течът)');

  // 2. Различните id-та не се блокират едно друго.
  events.length = 0;
  await Promise.all([lock('x', step('X', 40)), lock('y', step('Y', 5))]);
  assert.deepEqual(events.filter((e) => e.endsWith(':start')), ['X:start', 'Y:start'], 'различните тайни вървят паралелно');
  assert.equal(lock.size(), 0, 'след паралелните заключвания Map е празен');

  // 3. Изключение вътре в критичната секция не чупи опашката и не оставя запис.
  await assert.rejects(lock('boom', async () => { throw Object.assign(new Error('отказ'), { status: 403 }) }));
  assert.equal(lock.size(), 0, 'изключението също освобождава заключването');
  assert.equal(await lock('boom', async () => 'след грешката'), 'след грешката', 'следващият достъп минава');

  // 4. Течът, който тестът пази: 500 различни тайни → 0 записа.
  for (let i = 0; i < 500; i++) await lock('secret-' + i, async () => i);
  assert.equal(lock.size(), 0, '500 прегледа не оставят нито един запис в Map');

  // 5. Едновременни достъпи до 50 различни тайни.
  await Promise.all(Array.from({ length: 50 }, (_, i) => lock('par-' + i, async () => new Promise((r) => setTimeout(r, 5)))));
  assert.equal(lock.size(), 0, 'след паралелна вълна Map е празен');

  console.log('PASS secret-lock: сериализация по id · паралелност между различни id · освобождаване при грешка · 550 достъпа без остатък в Map');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
