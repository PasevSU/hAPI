'use strict';
// OpenPGP v6 (RFC 9580): ключове и подписи. Проверява СТРУКТУРАТА на пакетите, не само
// кръговия тест — иначе една грешна версия на подписа би минала незабелязано.
// Криптирането съзнателно НЕ се проверява тук: виж CHANGELOG (v6 AEAD още не е налично).
const assert = require('node:assert/strict');
const pgp = require('../hapi_enterprise/pgp');

const data = Buffer.from('hAPI Enterprise · RFC 9580 probe\n', 'utf8');

// ── 1. v6 ключ ───────────────────────────────────────────────────────────────
const v6 = pgp.generate({ version: 6, algorithm: 'ed25519', userId: 'v6 probe <v6@probe.test>' });
assert.equal(v6.version, 6, 'ключът е v6');
assert.equal(v6.algorithm, 'Ed25519', 'алгоритъм 27 = Ed25519 (RFC 9580)');
assert.match(v6.fingerprint, /^[0-9A-F]{64}$/, 'v6 пръстовият отпечатък е SHA-256 (32 байта = 64 hex)');
assert.equal(v6.keyId, v6.fingerprint.slice(0, 16), 'v6 keyId е първите 64 бита от отпечатъка');

const pubPackets = pgp.readPackets(pgp.dearmor(v6.publicArmored).data);
assert.equal(pubPackets[0].tag, 6, 'публичният блок започва с Public-Key пакет');
assert.equal(pubPackets[0].body[0], 6, 'пакетът е версия 6');
assert.equal(pubPackets[0].body[5], 27, 'алгоритъм 27 (Ed25519, v6)');
assert.equal(pubPackets[0].body.readUInt32BE(6), 32, 'v6 ключовият материал е uint32 дължина + сурова Ed25519 точка (32 байта, без 0x40 префикс)');
assert(pubPackets.some(p => p.tag === 2), 'v6 ключът носи Direct Key self-signature (tag 2)');
const direct = pubPackets.find(p => p.tag === 2);
assert.equal(direct.body[0], 6, 'self-signature е v6');
assert.equal(direct.body[1], 0x1f, 'Direct Key signature тип 0x1f');

const parsed = pgp.parseKeyBlock(v6.publicArmored);
assert.equal(parsed.primary.version, 6);
assert.equal(parsed.primary.fingerprint, v6.fingerprint);
const described = pgp.describe(parsed);
assert.equal(described.version, 6);
assert.equal(described.algorithm, 'Ed25519');

// ── 2. v6 подпис: версия, алгоритми, salt ────────────────────────────────────
const sig = pgp.signDetached(data, v6.secretArmored);
const sigBody = pgp.readPackets(pgp.dearmor(sig.armored).data).find(p => p.tag === 2).body;
assert.equal(sigBody[0], 6, 'подписът е версия 6');
assert.equal(sigBody[1], 0x00, 'binary document signature');
assert.equal(sigBody[2], 27, 'подписва с ключ от алгоритъм 27');
assert.equal(sigBody[3], 10, 'Ed25519 подписва със SHA-512');
const hashedLen = sigBody.readUInt32BE(4);
assert(hashedLen > 0, 'има хеширани подпакети');
const unhashedLen = sigBody.readUInt32BE(8 + hashedLen);
assert.equal(unhashedLen, 0, 'v6 не използва unhashed подпакети');
// След unhashed полетата са: [2 байта left16][1 байт дължина на salt][salt][подпис].
// RFC 9580 §5.2.3 задава размер на salt по алгоритъм: SHA-256 → 16, SHA-512 → 32.
const saltAt = 8 + hashedLen + 4 + 2;
assert.equal(sigBody[saltAt], 32, 'v6 подписът носи 32-байтов salt при SHA-512 (RFC 9580 §5.2.3)');
assert.equal(sigBody.length - (saltAt + 1 + 32), 64, 'след salt идва суровият Ed25519 подпис (64 байта)');

// ── 3. Проверка ──────────────────────────────────────────────────────────────
const ok = pgp.verifyDetached(data, sig.armored, v6.publicArmored);
assert.equal(ok.valid, true, 'подписът се проверява');
assert.equal(ok.version, 6);
assert.equal(ok.fingerprint, v6.fingerprint);
assert.equal(ok.keyId, v6.keyId);

const tampered = pgp.verifyDetached(Buffer.concat([data, Buffer.from('!')]), sig.armored, v6.publicArmored);
assert.equal(tampered.valid, false, 'подправени данни не минават');
assert.equal(tampered.reason, 'DIGEST_MISMATCH');

// ── 4. Изолация между ключовете и обратна съвместимост ───────────────────────
const other = pgp.generate({ version: 6, algorithm: 'ed25519', userId: 'other <other@probe.test>' });
assert.notEqual(other.fingerprint, v6.fingerprint);
const wrongKey = pgp.verifyDetached(data, sig.armored, other.publicArmored);
assert.equal(wrongKey.valid, false, 'чужд v6 ключ не приема подписа');

const v4 = pgp.generate({ version: 4, algorithm: 'ed25519', userId: 'v4 probe <v4@probe.test>' });
assert.equal(v4.version, 4, 'v4 остава достъпен');
assert.match(v4.fingerprint, /^[0-9A-F]{40}$/, 'v4 отпечатъкът е SHA-1 (40 hex)');
const v4sig = pgp.signDetached(data, v4.secretArmored);
assert.equal(pgp.readPackets(pgp.dearmor(v4sig.armored).data).find(p => p.tag === 2).body[0], 4, 'v4 ключ → v4 подпис');
assert.equal(pgp.verifyDetached(data, v4sig.armored, v4.publicArmored).valid, true, 'v4 подписът също се проверява');
assert.equal(pgp.verifyDetached(data, v4sig.armored, v6.publicArmored).valid, false, 'v4 подпис не минава с v6 ключ');
assert.equal(pgp.verifyDetached(data, sig.armored, v4.publicArmored).valid, false, 'v6 подпис не минава с v4 ключ');

// ── 5. Публичен ключ от секретния блок ───────────────────────────────────────
const derived = pgp.publicKeyOf(v6.secretArmored);
assert.equal(pgp.parseKeyBlock(derived).primary.fingerprint, v6.fingerprint, 'публичният ключ се извлича от секретния');
assert.equal(pgp.verifyDetached(data, sig.armored, derived).valid, true, 'извлеченият публичен ключ проверява подписа');

// ── 6. Реалният път: v6 ключ подписва експортен пакет ────────────────────────
// Това е същият код, който ползва /admin/api/packages с autoSign.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const packager = require('../hapi_enterprise/packager');
(async () => {
  const packRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-v6-pack-'));
  try {
    const packs = packager.create({ root: packRoot });
    const meta = await packs.build({
      portal: { id: 'p-v6', slug: 'v6', title: 'v6 signing' },
      files: [{ name: 'note.txt', data, source: 'portal' }],
      sign: { secretArmored: v6.secretArmored, keyId: v6.keyId, label: 'v6 probe' },
      ttlHours: 1,
    });
    assert.equal(meta.hasSignature, true, 'пакетът е подписан');
    assert.equal(meta.signature.fingerprint, v6.fingerprint, 'подписът носи v6 отпечатъка');
    assert.equal(meta.signature.keyId, v6.keyId);
    assert.equal(meta.signature.hash, 'SHA-512');
    const armoredSig = fs.readFileSync(path.join(packRoot, 'packages', `${meta.id}.zip.asc`), 'utf8');
    const zip = fs.readFileSync(path.join(packRoot, 'packages', `${meta.id}.zip`));
    const verdict = pgp.verifyDetached(zip, armoredSig, v6.publicArmored);
    assert.equal(verdict.valid, true, 'подписът на пакета се проверява с v6 ключа');
    assert.equal(verdict.version, 6);
    console.log('PASS pgp v6: Ed25519 v6 ключ (fpr SHA-256, keyId 64 бита), v6 подпис със salt, проверка, изолация, v4 съвместимост и подписан експортен пакет');
  } finally {
    fs.rmSync(packRoot, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1 });
