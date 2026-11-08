'use strict';
// НЕПОЗНАТ ПОДКЛЮЧ НЕ СЪБАРВА ЦЕЛИЯ КЛЮЧОВ БЛОК (DEF-43).
//
// Защо този тест: PGPony записва в блока и подключ с алгоритъм 36 — опитен номер от чернова на
// RFC 9580, който не съществува в регистъра на изданието. До 0.69.199 такъв подключ хвърляше
// `UNSUPPORTED_ALGORITHM` за ЦЕЛИЯ блок, тоест ключохранилището ставаше недостъпно
// (`PUBLIC_UNREADABLE`), PGP панелът изглеждаше празен, а подписът и криптирането — изключени,
// макар основният ключ и останалите подключове да са напълно използваеми.
//
// Тестът пада, ако:
//   • блок с непознат подключ пак не се чете;
//   • непознатият подключ влезе в `keys` (двигателят не бива да гадае какво е);
//   • `skipped` не казва кой пакет и с кой код е пропуснат;
//   • непознат ОСНОВЕН ключ минава тихо — там блокът наистина е безполезен и трябва да се откаже.
const assert = require('node:assert/strict');
const path = require('node:path');

const pgp = require(path.join(__dirname, '..', 'hapi_enterprise', 'pgp.js'));

/** Синтетичен v6 подключ с алгоритъм, който двигателят не познава. */
function unknownSubkey(algo, materialLength) {
  const body = Buffer.alloc(10 + materialLength);
  body[0] = 6; // версия
  body.writeUInt32BE(1793941203, 1); // created
  body[5] = algo;
  body.writeUInt32BE(materialLength, 6);
  body.fill(0x5a, 10);
  return pgp.packet(14, body);
}

const made = pgp.generate({ algorithm: 'ed25519', userId: 'hAPI test <test@example.invalid>', version: 6 });
assert.ok(made.publicArmored.includes('BEGIN PGP PUBLIC KEY BLOCK'), 'генериран е публичен ключ');

const clean = pgp.dearmor(made.publicArmored).data;
const dirty = Buffer.concat([clean, unknownSubkey(36, 1624)]);

// ── 1. Блокът се чете, въпреки непознатия подключ ────────────────────────────
const parsed = pgp.parseKeyBlock(pgp.armor('public', dirty));
assert.ok(parsed.primary, 'основният ключ е налице');
assert.equal(parsed.primary.algorithm, 'Ed25519', 'основният ключ е този, който е генериран');
assert.equal(parsed.primary.version, 6, 'версията на основния ключ е запазена');
assert.equal(parsed.keys.length, 1, 'в `keys` влиза само познатият ключ: ' + parsed.keys.length);

// ── 2. Пропуснатият пакет се назовава, вместо да се премълчи ─────────────────
assert.equal(parsed.skipped.length, 1, 'пропуснатият подключ е записан');
assert.equal(parsed.skipped[0].tag, 14, 'пропуснат е ПОДКЛЮЧ (таг 14), не основен ключ');
assert.equal(parsed.skipped[0].code, 'UNSUPPORTED_ALGORITHM', 'кодът казва защо е пропуснат');
assert.match(parsed.skipped[0].message, /36/, 'съобщението носи номера на алгоритъма: ' + parsed.skipped[0].message);

// ── 3. Познат подключ пак влиза в списъка ────────────────────────────────────
const x25519 = (() => {
  const body = Buffer.alloc(10 + 32);
  body[0] = 6;
  body.writeUInt32BE(1793941203, 1);
  body[5] = 25; // X25519 (RFC 9580 §9.1)
  body.writeUInt32BE(32, 6);
  body.fill(0x33, 10);
  return pgp.packet(14, body);
})();
const withKnown = pgp.parseKeyBlock(pgp.armor('public', Buffer.concat([clean, unknownSubkey(36, 1624), x25519])));
assert.equal(withKnown.keys.length, 2, 'познатият подключ е в `keys`');
assert.equal(withKnown.skipped.length, 1, 'само непознатият е пропуснат');

// ── 4. Непознат ОСНОВЕН ключ не минава тихо ─────────────────────────────────
const primaryBody = Buffer.alloc(10 + 32);
primaryBody[0] = 6;
primaryBody.writeUInt32BE(1793941203, 1);
primaryBody[5] = 36;
primaryBody.writeUInt32BE(32, 6);
assert.throws(
  () => pgp.parseKeyBlock(pgp.armor('public', pgp.packet(6, primaryBody))),
  (e) => e.code === 'UNSUPPORTED_ALGORITHM',
  'непознат основен ключ се отказва с точна причина',
);

console.log(
  'PASS pgp-unknown-subkey: непознат подключ (алг. 36) не събаря блока · влиза в `skipped` с причина · ' +
  'познат подключ (X25519) се чете · непознат основен ключ се отказва',
);
