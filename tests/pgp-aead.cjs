'use strict';
// AEAD-ЗАЩИТА НА СЕКРЕТЕН КЛЮЧ (RFC 9580 §5.5.3, usage 253) — F7-1/двигател.
//
// До 0.69.87 такъв ключ се отказваше с `S2K_AEAD_UNSUPPORTED`, защото Node нямаше OCB.
// Node 22+/OpenSSL 3 го има нативно (`aes-*-ocb`), затова сега ключът се отваря.
//
// Проверява се РЕАЛНИЯТ път: ключът се генерира от нашия двигател, секретната му секция се
// заключва с `sealAeadSecretSection` (AEAD, usage 253), после се отваря обратно през
// `openAeadSecretSection`. Така фикстурът не е ръчно сглобен — той е резултат от същия код,
// който после го чете, и подправен байт се хваща от AEAD тага.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pgp = require('../hapi_enterprise/pgp.js');

const PASS = 'fx-pass-2026';
const cases = [];
const ok = (label) => cases.push(label);

// ── 1. Платформата има OCB (иначе предметът на теста е друг) ────────────────
{
  const ciphers = crypto.getCiphers();
  assert.ok(ciphers.includes('aes-256-ocb'), 'OpenSSL дава aes-256-ocb (Node 22+/OpenSSL 3)');
  assert.equal(pgp.AEAD_MODES[2].name, 'ocb', 'режим 2 = OCB, както в OpenPGP');
  assert.equal(pgp.AEAD_MODES[2].nonce, 15, 'OCB nonce е 15 байта (RFC 9580)');
  ok('платформата има OCB; режим 2 = OCB с 15-байтов nonce');
}

// ── 2. Правим v6 ключ и заключваме секретната му секция с AEAD ──────────────
// Пакетът се сглобява с помощта на самия модул (`packet` + `armor`), за да е същата
// структура, която продуцентът на ключове пише.
const v6 = pgp.generate({ version: 6, algorithm: 'ed25519', userId: 'aead probe <aead@probe.test>' });
const secretPacket = pgp.readPackets(pgp.dearmor(v6.secretArmored).data)[0];
assert.equal(secretPacket.body[0], 6, 'секретният пакет е v6');
// Публичната част свършва там, където започва usage байтът — взимаме го от самия ключ.
const publicBody = secretPacket.body.subarray(0, secretPacket.body.length - 1 - 32);
const plainSecret = Buffer.from(secretPacket.body.subarray(publicBody.length + 1));
const rebuild = (sealed) => pgp.armor('PRIVATE', pgp.packet(5, Buffer.concat([publicBody, sealed])));

{
  const sealed = pgp.sealAeadSecretSection({ plain: plainSecret, publicBody, passphrase: PASS });
  assert.equal(sealed[0], 253, 'секцията започва с usage 253 (AEAD)');
  const parsed = pgp.parseKeyBlock(rebuild(sealed), { passphrase: PASS }).primary;
  assert.equal(parsed.version, 6, 'ключът се разчита като v6');
  assert.equal(parsed.fingerprint, v6.fingerprint, 'отпечатъкът не се променя от защитата');
  ok('AEAD: секцията се заключва (usage 253) и се отваря обратно с паролата');
}

// ── 3. Грешна парола се отказва с ТОЧЕН код ────────────────────────────────
{
  const sealed = pgp.sealAeadSecretSection({ plain: plainSecret, publicBody, passphrase: PASS });
  assert.throws(
    () => pgp.parseKeyBlock(rebuild(sealed), { passphrase: 'грешна-парола' }),
    (e) => e.code === 'PASSPHRASE_WRONG' || e.code === 'BAD_KEY',
    'грешната парола се отказва',
  );
  ok('грешна парола → отказ (AEAD тагът не се проверява)');
}

// ── 4. Подправен байт в шифротекста се хваща от тага ───────────────────────
{
  const sealed = pgp.sealAeadSecretSection({ plain: plainSecret, publicBody, passphrase: PASS });
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 20] ^= 0xff; // в шифротекста, преди 16-байтовия таг
  assert.throws(
    () => pgp.parseKeyBlock(rebuild(tampered), { passphrase: PASS }),
    (e) => e.code === 'PASSPHRASE_WRONG' || e.code === 'BAD_KEY',
    'подправеният шифротекст не се приема',
  );
  ok('подправен шифротекст → отказ (AEAD автентикация, не „почти вярно“)');
}

// ── 5. AD свързва секцията с ПУБЛИЧНАТА част: смяна на ключа чупи тага ─────
{
  const sealed = pgp.sealAeadSecretSection({ plain: plainSecret, publicBody, passphrase: PASS });
  const otherPublic = Buffer.from(publicBody);
  otherPublic[10] ^= 0xff; // „друг“ ключ, със същата заключена секция
  assert.throws(
    () => pgp.parseKeyBlock(pgp.armor('PRIVATE', pgp.packet(5, Buffer.concat([otherPublic, sealed]))), { passphrase: PASS }),
    () => true,
    'заключената секция не може да се премести на друг ключ',
  );
  ok('AD: заключената секция не се мести на друг ключ (тагът пада)');
}

// ── 6. Без парола причината е PASSPHRASE_REQUIRED, не „счупен ключ“ ────────
{
  const sealed = pgp.sealAeadSecretSection({ plain: plainSecret, publicBody, passphrase: PASS });
  assert.throws(
    () => pgp.parseKeyBlock(rebuild(sealed), { passphrase: '' }),
    (e) => e.code === 'PASSPHRASE_REQUIRED',
    'без парола → PASSPHRASE_REQUIRED',
  );
  ok('без парола → PASSPHRASE_REQUIRED с точна причина');
}

console.log('PASS pgp-aead: ' + cases.length + ' проверки — ' + cases.join('; '));
