'use strict';
// ПРИСЪДАТА НА СВЕРКАТА — `verify-verdict.js`.
//
// Тестът пада, ако:
//   • подмяна (`MISMATCH`) или липсващ файл (`MISSING`) не правят сверката провалена — тогава
//     панелът и фоновата задача пак биха мълчали (точно това стана: `summary.mismatch` срещу
//     ключ `MISMATCH`);
//   • `WRITABLE` (файлът е сменяем, WORM е изключен) се брои за провал — това е предупреждение;
//   • празно/липсващо обобщение хвърля вместо да върне „нула проверени“.
const assert = require('node:assert');
const { verdict, describe, PROBLEM_KEYS, WARNING_KEYS } = require('../hapi_enterprise/verify-verdict');

// 1. Чиста сверка: няма проблемни, няма предупреждения.
assert.deepEqual(verdict({ VERIFIED: 3, MISMATCH: 0, MISSING: 0, INVALID_TYPE: 0, ERROR: 0, WRITABLE: 0 }), {
  verified: 3,
  failed: 0,
  warnings: 0,
  ok: true,
});

// 2. Всяка проблемна причина прави сверката провалена — и то с точния брой.
for (const key of PROBLEM_KEYS) {
  const judged = verdict({ VERIFIED: 2, [key]: 1 });
  assert.equal(judged.failed, 1, `${key} се брои за проблемен файл`);
  assert.equal(judged.ok, false, `${key} прави сверката провалена`);
}

// 3. Няколко причини наведнъж се сумират.
assert.equal(verdict({ VERIFIED: 1, MISMATCH: 2, MISSING: 3, ERROR: 1 }).failed, 6, 'причините се сумират');

// 4. `WRITABLE` е предупреждение, не провал (WORM изключен ≠ подмяна).
const writable = verdict({ VERIFIED: 1, WRITABLE: 1 });
assert.equal(writable.warnings, 1, 'сменяемият файл се вижда като предупреждение');
assert.equal(writable.ok, true, 'сменяем файл не прави сверката провалена');

// 5. Празно обобщение не хвърля.
assert.deepEqual(verdict(), { verified: 0, failed: 0, warnings: 0, ok: true }, 'липсващо обобщение = нула');
assert.deepEqual(verdict(null), { verified: 0, failed: 0, warnings: 0, ok: true }, 'null също');
// Низове от JSON не се превръщат в NaN.
assert.equal(verdict({ VERIFIED: '2', MISMATCH: '1' }).failed, 1, 'числата като текст се броят');

// 6. Редът за човек носи същите числа.
const text = describe({ VERIFIED: 2, MISMATCH: 1 });
assert.equal(text.text, 'проверени 2 · проблемни 1 · предупреждения 0');
assert.equal(text.ok, false);

// 7. Списъците са ЗАТВОРЕН И договор — документацията се позовава на тях.
assert.deepEqual([...PROBLEM_KEYS], ['MISMATCH', 'MISSING', 'INVALID_TYPE', 'ERROR']);
assert.deepEqual([...WARNING_KEYS], ['WRITABLE']);

console.log('PASS verify-verdict: MISMATCH/MISSING/INVALID_TYPE/ERROR = провал · WRITABLE = предупреждение · празно обобщение = нула (без изключение)');
