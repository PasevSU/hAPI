'use strict';
// Двигателят на PGP (hapi_enterprise/pgp.js) — криптиране/декриптиране без външни
// инструменти. Тестът е самодостатъчен: генерира ключовете си с вградения генератор,
// затова върви и на CI, където няма gpg и няма npm пакети.
//
// Покрива инвариантите от `PGP_KEYRING_AND_WORK_FOLDER.md`:
//   INV-P3 — без верен ключ четенето се отказва с ясен код;
//   INV-P4 — съобщение с невалиден MDC се отхвърля изцяло;
//   INV-P6 — неподдържаните формати дават точния код, не обща грешка.
// Интеропът с gpg 2.5.24 и OpenPGP.js 6.3.2 се мери отделно, защото иска външни инструменти.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pgp = require('../hapi_enterprise/pgp.js');

const cases = [];
const ok = (label) => cases.push(label);

/** Октавите на armored блока без заглавките — за да подправим байт в шифротекста. */
const armorBody = (armored) =>
  Buffer.from(
    armored
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('-----') && !/^[A-Za-z-]+: /.test(line))
      .join(''),
    'base64',
  );

// ── 1. RSA: пълен кръг ────────────────────────────────────────────────────────
const rsa = pgp.generate({ algorithm: 'rsa2048', userId: 'rsa <r@test>' });
assert.equal(rsa.version, 4);
assert.match(rsa.keyId, /^[0-9A-F]{16}$/);

const message = 'порталът работи — ' + new Date().toISOString();
const sealed = pgp.encryptToKey(Buffer.from(message, 'utf8'), rsa.publicArmored);
assert.equal(sealed.keyId, rsa.keyId, 'PKESK трябва да сочи към ключа, с който е криптирано');
assert.match(sealed.armored, /-----BEGIN PGP MESSAGE-----/);
assert.match(sealed.armored, /-----END PGP MESSAGE-----/);

const opened = pgp.decryptMessage(sealed.armored, rsa.secretArmored, '');
assert.equal(opened.toString('utf8'), message, 'съобщението трябва да се върне същото');
ok('RSA 2048: криптиране → декриптиране');

// Два пъти един и същ вход дава различен шифротекст (случаен сесиен ключ и префикс).
const again = pgp.encryptToKey(Buffer.from(message, 'utf8'), rsa.publicArmored);
assert.notEqual(again.armored, sealed.armored, 'шифротекстът не бива да е детерминиран');
ok('всеки шифротекст е различен');

// ── 2. Двоични данни ─────────────────────────────────────────────────────────
const binary = crypto.randomBytes(4096);
const sealedBinary = pgp.encryptToKey(binary, rsa.publicArmored);
assert.deepEqual(pgp.decryptMessage(sealedBinary.armored, rsa.secretArmored, ''), binary);
ok('4 KiB двоични данни');

// ── 2b. Открит текст, който ИЗГЛЕЖДА като заглавка на компресиран пакет ────────
// Регресия от CI: проверката за компресия гледаше резултата СЛЕД разопаковането, т.е.
// самия открит текст — 4 KiB случайни данни падаха с UNSUPPORTED_COMPRESSION с шанс ~2%
// на пускане (стария формат 0xA3 и новия 0xC8 са точно такива заглавки).
for (const first of [0xa3, 0xc8, 0xa0, 0xff]) {
  const looksCompressed = Buffer.concat([Buffer.from([first]), crypto.randomBytes(64)]);
  assert.deepEqual(
    pgp.decryptMessage(pgp.encryptToKey(looksCompressed, rsa.publicArmored).armored, rsa.secretArmored, ''),
    looksCompressed,
    `данни, започващи с 0x${first.toString(16)}, трябва да се върнат непроменени`,
  );
}
ok('данни, които приличат на компресиран пакет, не се бъркат с компресия');

// ── 3. INV-P4: подправен шифротекст → отказ ──────────────────────────────────
const raw = armorBody(sealed.armored);
const tampered = Buffer.from(raw);
tampered[tampered.length - 30] ^= 0x01; // вътре в шифротекста, преди MDC
assert.throws(
  () => pgp.decryptMessage(pgp.armor('MESSAGE', tampered), rsa.secretArmored, ''),
  (e) => ['MDC_MISMATCH', 'DECRYPT_FAILED', 'MDC_MISSING', 'BAD_MESSAGE'].includes(e.code),
  'подправен шифротекст трябва да бъде отказан',
);
ok('INV-P4 подправен шифротекст → отказ');

// ── 4. INV-P3: чужд ключ не отваря съобщението ───────────────────────────────
const other = pgp.generate({ algorithm: 'rsa2048', userId: 'other <o@test>' });
assert.throws(
  () => pgp.decryptMessage(sealed.armored, other.secretArmored, ''),
  (e) => ['BAD_SESSION_KEY', 'DECRYPT_FAILED', 'NO_KEY', 'MISSING_KEY'].includes(e.code),
  'чужд ключ не бива да отваря съобщението',
);
ok('INV-P3 чужд ключ → отказ');

// ── 5. INV-P6: AEAD съобщение → UNSUPPORTED_AEAD, не обща грешка ──────────────
// Взимаме истинския PKESK и слагаме на мястото на SEIPD пакет tag 20 (AEAD), както прави gpg.
const packets = pgp.readPackets(pgp.dearmor(sealed.armored).data);
const pkesk = packets.find((p) => p.tag === 1);
const aeadBody = Buffer.from([1, 9, 2, 16, 0, 0, 0, 0]); // версия 1, AES-256, OCB
const aeadMessage = Buffer.concat([
  // `packet()` се ползва, защото PKESK тялото е над 191 байта (двубайтова дължина).
  pgp.packet(1, pkesk.body),
  pgp.packet(20, aeadBody),
]);
assert.throws(
  () => pgp.decryptMessage(pgp.armor('MESSAGE', aeadMessage), rsa.secretArmored, ''),
  (e) => e.code === 'UNSUPPORTED_AEAD' && /OCB/.test(e.message),
  'AEAD трябва да върне UNSUPPORTED_AEAD с името на режима',
);
ok('INV-P6 AEAD → UNSUPPORTED_AEAD (OCB)');

// ── 6. Ключ само за подпис не може да криптира ───────────────────────────────
const signOnly = pgp.generate({ algorithm: 'ed25519', userId: 'sign <s@test>' });
assert.throws(
  () => pgp.encryptToKey(Buffer.from('x'), signOnly.publicArmored),
  (e) => e.code === 'NO_ENCRYPTION_KEY',
  'ключ само за подпис не може да криптира — трябва ясен код',
);
ok('ключ само за подпис → NO_ENCRYPTION_KEY');

// ── 7. Празни данни → INVALID_DATA (не „успешно празно съобщение“) ───────────
assert.throws(
  () => pgp.encryptToKey(Buffer.alloc(0), rsa.publicArmored),
  (e) => e.code === 'INVALID_DATA',
);
ok('празни данни → INVALID_DATA');

console.log('PASS pgp-engine: ' + cases.length + ' проверки — ' + cases.join('; '));
