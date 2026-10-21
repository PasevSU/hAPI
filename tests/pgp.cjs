'use strict';
// OpenPGP (PGP) деташиран подпис: генерация, подписване, проверка, armor и откриване на
// подправяне. Проверява се и че ключът пази само публичната част, когато се публикува.
const assert = require('node:assert/strict');
const pgp = require('../hapi_enterprise/pgp.js');

// 1. Ed25519: генерация → подпис → проверка.
const ed = pgp.generate({ algorithm: 'ed25519', userId: 'Тест Едо <ed@example.test>' });
assert.match(ed.publicArmored, /^-----BEGIN PGP PUBLIC KEY BLOCK-----/);
assert.match(ed.secretArmored, /^-----BEGIN PGP PRIVATE KEY BLOCK-----/);
assert.match(ed.keyId, /^[A-F0-9]{16}$/);
assert.equal(ed.fingerprint.length, 40);
assert.equal(ed.algorithm, 'EdDSA (Ed25519)');

const data = Buffer.from('доказателствен пакет\n' + 'A'.repeat(1000), 'utf8');
const sig = pgp.signDetached(data, ed.secretArmored);
assert.match(sig.armored, /^-----BEGIN PGP SIGNATURE-----/);
assert.equal(sig.keyId, ed.keyId);
assert.equal(sig.hash, 'SHA-512'); // EdDSA подписва с SHA-512, както GnuPG

const ok = pgp.verifyDetached(data, sig.armored, ed.publicArmored);
assert.equal(ok.valid, true, JSON.stringify(ok));
assert.equal(ok.keyId, ed.keyId);

// 2. Подправени данни → отказ.
const tampered = pgp.verifyDetached(Buffer.from('доказателствен пакет\n' + 'A'.repeat(999) + 'B'), sig.armored, ed.publicArmored);
assert.equal(tampered.valid, false);
assert.equal(tampered.reason, 'DIGEST_MISMATCH');

// 3. Подправен armor (CRC) → отказ.
const sigLines = sig.armored.split('\n');
const crcIndex = sigLines.findIndex((l) => l.startsWith('='));
assert.ok(crcIndex > 0, 'armor съдържа CRC24 ред');
sigLines[crcIndex] = '=AAAA';
const brokenArmor = sigLines.join('\n');
assert.equal(pgp.verifyDetached(data, brokenArmor, ed.publicArmored).valid, false);

// 4. Чужди ключ → UNKNOWN_SIGNING_KEY.
const other = pgp.generate({ algorithm: 'ed25519', userId: 'Друг <other@example.test>' });
const foreign = pgp.verifyDetached(data, sig.armored, other.publicArmored);
assert.equal(foreign.valid, false);
assert.equal(foreign.reason, 'UNKNOWN_SIGNING_KEY');

// 5. RSA 2048 също се подписва и проверява.
const rsa = pgp.generate({ algorithm: 'rsa2048', userId: 'Тест Рас <rsa@example.test>' });
const rsaSig = pgp.signDetached(data, rsa.secretArmored);
const rsaOk = pgp.verifyDetached(data, rsaSig.armored, rsa.publicArmored);
assert.equal(rsaOk.valid, true, JSON.stringify(rsaOk));
assert.equal(rsaOk.keyId, rsa.keyId);
assert.equal(rsaSig.hash, 'SHA-256');

// 6. Публичният ключ, извлечен от секретния, не съдържа тайната част.
const derived = pgp.publicKeyOf(rsa.secretArmored);
assert.match(derived, /^-----BEGIN PGP PUBLIC KEY BLOCK-----/);
assert.equal(pgp.describe(pgp.parseKeyBlock(derived)).hasSecret, false);
assert.equal(pgp.describe(pgp.parseKeyBlock(derived)).keyId, rsa.keyId);
assert.equal(pgp.verifyDetached(data, rsaSig.armored, derived).valid, true);

// 7. CRC24 и armor кръгова проверка.
const raw = Buffer.from('hello-pgp');
const armored = pgp.armor('SIGNATURE', raw);
assert.equal(pgp.dearmor(armored).data.toString(), 'hello-pgp');
assert.equal(pgp.crc24(raw), pgp.crc24(Buffer.from('hello-pgp')));

// 8. Ясни грешки вместо тих fallback.
assert.throws(() => pgp.parseKeyBlock('not a key'), /armor/i);
assert.throws(() => pgp.dearmor('-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nzzz\n'), /base64|armor/i);

// 9. OpenPGP v6 (RFC 9580): 64-октетен отпечатък, keyId = първите 8 октета,
//    подпис със salt и Issuer Fingerprint (без Issuer Key ID).
const v6 = pgp.generate({ algorithm: 'ed25519', version: 6, userId: 'Тест v6 <v6@example.test>' });
assert.equal(v6.version, 6);
assert.equal(v6.fingerprint.length, 64, 'v6 отпечатъкът е SHA-256');
assert.equal(v6.keyId, v6.fingerprint.slice(0, 16), 'v6 keyId е началото на отпечатъка');
assert.equal(v6.algorithm, 'Ed25519');

const info6 = pgp.describe(pgp.parseKeyBlock(v6.publicArmored));
assert.equal(info6.version, 6);
assert.equal(info6.hasSecret, false);
assert.equal(info6.keyId, v6.keyId);
assert.equal(pgp.describe(pgp.parseKeyBlock(v6.secretArmored)).hasSecret, true);

const sig6 = pgp.signDetached(data, v6.secretArmored);
assert.match(sig6.armored, /^-----BEGIN PGP SIGNATURE-----/);
assert.equal(sig6.keyId, v6.keyId);
const sig6Body = pgp.readPackets(pgp.dearmor(sig6.armored).data).find((p) => p.tag === 2).body;
assert.equal(sig6Body[0], 6, 'версия 6 на подписа');
assert.ok(sig6Body.readUInt32BE(4) > 0, '4-октетна дължина на хешираните subpacket-и');
assert.equal(sig6Body.includes(Buffer.from([0x10, 0x09])), false, 'v6 подписът не носи Issuer Key ID');
const ok6 = pgp.verifyDetached(data, sig6.armored, v6.publicArmored);
assert.equal(ok6.valid, true, JSON.stringify(ok6));
assert.equal(ok6.version, 6);
assert.equal(ok6.keyId, v6.keyId);

// Подправени данни при v6 → DIGEST_MISMATCH; v6 ключ не се приема за v4 подпис.
assert.equal(pgp.verifyDetached(Buffer.from('друго'), sig6.armored, v6.publicArmored).reason, 'DIGEST_MISMATCH');
assert.equal(pgp.verifyDetached(data, sig6.armored, ed.publicArmored).valid, false);
// v4 подпис не минава с v6 ключ (различна схема на хеширане).
assert.equal(pgp.verifyDetached(data, sig.armored, v6.publicArmored).valid, false);

// v6 RSA: MPI подпис, SHA-256 по подразбиране.
const rsa6 = pgp.generate({ algorithm: 'rsa2048', version: 6, userId: 'Тест RSA v6 <rsa6@example.test>' });
assert.equal(rsa6.version, 6);
const rsa6Sig = pgp.signDetached(data, rsa6.secretArmored);
assert.equal(rsa6Sig.hash, 'SHA-256');
const rsa6Ok = pgp.verifyDetached(data, rsa6Sig.armored, rsa6.publicArmored);
assert.equal(rsa6Ok.valid, true, JSON.stringify(rsa6Ok));
assert.equal(rsa6Ok.version, 6);

console.log('pgp OK');
process.exit(0);
