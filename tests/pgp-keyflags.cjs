'use strict';
// Key Flags (подпакет 27 от обвързващия подпис) решават КОЙ ключ криптира вътрешните данни.
//
// Преди тази промяна `encryptionKeyOf()` връщаше първия X25519/X448 (иначе RSA) без да гледа
// ролите: при пакет с отделен `encrypt-comms` подключ и отделен `encrypt-storage` подключ
// можеше да се избере грешният. Документът от години казва „storage ключът е този с 0x08“,
// а кодът не го четеше — точно разминаването, което 0.69.67 премахна другаде.
//
// Тук се проверява:
//   1. флаговете се четат от РЕАЛЕН ключ (gpg, 0x0F) и се превръщат в роли;
//   2. при два подключа се избира този с 0x08, а не първият по ред;
//   3. при липса на 0x08 се ползва 0x04 (comms) и това се казва;
//   4. при липса на каквито и да е флагове — правилото по вид, пак с ясен източник;
//   5. собственият ни генератор слага ролите, които реално ползва (0x0F), вместо 0x03;
//   6. `encryptionKeyOf()` остава съвместим (същият ключ като `storageKeyOf().key`).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pgp = require('../hapi_enterprise/pgp.js');

const cases = [];
const ok = (label) => cases.push(label);
const FIXTURE = path.join(__dirname, 'fixtures/pgp/public.asc');

// ── 1. Реален ключ от gpg: self-sig носи 0x0F ────────────────────────────────
const parsed = pgp.parseKeyBlock(fs.readFileSync(FIXTURE, 'utf8'));
assert.equal(parsed.primary.keyFlags, 0x0f, 'фикстурата носи key flags 0x0F в self-sig');
assert.deepEqual(
  parsed.primary.roles,
  ['certify', 'sign', 'encrypt-comms', 'encrypt-storage'],
  'ролите идват от битовете на флаговете, в документирания ред',
);
ok('key flags от реален self-sig → роли');

// ── 2. Два подключа: печели този с 0x08, а не първият ────────────────────────
const twoSubkeys = {
  primary: { keyId: 'AAAA0000AAAA0000', kind: 'ed25519', isSubkey: false, keyFlags: 0x03 },
  keys: [
    { keyId: 'AAAA0000AAAA0000', kind: 'ed25519', isSubkey: false, keyFlags: 0x03, canSign: true },
    { keyId: 'BBBB0000BBBB0000', kind: 'x25519', isSubkey: true, keyFlags: 0x04 },
    { keyId: 'CCCC0000CCCC0000', kind: 'x25519', isSubkey: true, keyFlags: 0x08 },
  ],
};
const chosen = pgp.storageKeyOf(twoSubkeys);
assert.equal(chosen.key.keyId, 'CCCC0000CCCC0000', 'избира се подключът с encrypt-storage (0x08)');
assert.equal(chosen.source, 'key-flags', 'източникът на избора е ясен');
ok('два подключа (comms 0x04 и storage 0x08) → storage');

// ── 3. Само comms (0x04): ползва се, но източникът го казва ──────────────────
const commsOnly = {
  primary: { keyId: 'AAAA0000AAAA0000', kind: 'ed25519', isSubkey: false, keyFlags: 0x03 },
  keys: [
    { keyId: 'AAAA0000AAAA0000', kind: 'ed25519', isSubkey: false, keyFlags: 0x03, canSign: true },
    { keyId: 'BBBB0000BBBB0000', kind: 'x25519', isSubkey: true, keyFlags: 0x04 },
  ],
};
const comms = pgp.storageKeyOf(commsOnly);
assert.equal(comms.key.keyId, 'BBBB0000BBBB0000');
assert.equal(comms.source, 'key-flags-comms', 'без 0x08 се казва, че е избран comms ключ');
ok('само comms ключ → избран, но с точен източник');

// ── 4. Без флагове: правилото по вид, с ясен източник ────────────────────────
const noFlags = {
  primary: { keyId: 'AAAA0000AAAA0000', kind: 'rsa', isSubkey: false, canSign: true },
  keys: [{ keyId: 'AAAA0000AAAA0000', kind: 'rsa', isSubkey: false, canSign: true }],
};
const byKind = pgp.storageKeyOf(noFlags);
assert.equal(byKind.key.keyId, 'AAAA0000AAAA0000');
assert.equal(byKind.source, 'kind', 'без флагове се пада към правилото по вид и се казва');
ok('без флагове → правило по вид');

// ── 5. Собственият генератор носи ролите, които ползва ───────────────────────
const generated = pgp.generate({ algorithm: 'rsa2048', userId: 'flags <f@test>' });
const generatedParsed = pgp.parseKeyBlock(generated.publicArmored);
assert.equal(generatedParsed.primary.keyFlags, 0x0f, 'генерираният ключ трябва да носи 0x0F, не 0x03');
assert.ok(generatedParsed.primary.roles.includes('encrypt-storage'), 'генерираният ключ има роля encrypt-storage');
const generatedChoice = pgp.storageKeyOf(generatedParsed);
assert.equal(generatedChoice.source, 'key-flags', 'генерираният ключ се избира по флаговете си');
assert.equal(generatedChoice.key.keyId, generated.keyId);
ok('генериран ключ: 0x0F и избор по флагове');

// ── 6. Съвместимост на стария изход ──────────────────────────────────────────
assert.equal(
  pgp.encryptionKeyOf(parsed).keyId,
  pgp.storageKeyOf(parsed).key.keyId,
  'encryptionKeyOf връща същия ключ като storageKeyOf().key',
);
ok('encryptionKeyOf е съвместим');

console.log('PASS pgp-keyflags: ' + cases.length + ' проверки — ' + cases.join('; '));
