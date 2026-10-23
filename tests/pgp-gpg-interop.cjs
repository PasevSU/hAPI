'use strict';
// Интероп с GnuPG: нашият подпис се проверява от gpg и обратно.
// Ако gpg липсва (напр. в контейнер), тестът се прескача с ясно съобщение.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const pgp = require('../hapi_enterprise/pgp.js');

function hasGpg() {
  try {
    execFileSync('gpg', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!hasGpg()) {
  console.log('pgp-gpg-interop SKIPPED (gpg не е инсталиран)');
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-pgp-interop-'));
const data = Buffer.from('интероп ' + new Date().toISOString(), 'utf8');
const dataFile = path.join(tmp, 'payload.bin');
fs.writeFileSync(dataFile, data);

const gpgIn = (home) => (args) =>
  execFileSync('gpg', ['--homedir', home, '--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase', '', ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

// ── 1. Наш подпис → gpg ────────────────────────────────────────────────────
const homeOurs = path.join(tmp, 'ours');
fs.mkdirSync(homeOurs, { recursive: true });
const ours = gpgIn(homeOurs);
for (const algorithm of ['ed25519', 'rsa2048']) {
  const key = pgp.generate({ algorithm, userId: `Interop ${algorithm} <${algorithm}@example.test>` });
  const sigFile = path.join(tmp, `ours-${algorithm}.asc`);
  const pubFile = path.join(tmp, `ours-${algorithm}.pub.asc`);
  fs.writeFileSync(sigFile, pgp.signDetached(data, key.secretArmored).armored);
  fs.writeFileSync(pubFile, key.publicArmored);
  ours(['--import', pubFile]);
  const out = ours(['--status-fd', '1', '--verify', sigFile, dataFile]);
  assert.match(out, /\[GNUPG:\] GOODSIG/, `gpg трябва да приеме нашия ${algorithm} подпис`);
}

// ── 2. Подпис от gpg → нашият verifier ─────────────────────────────────────
for (const [algorithm, uid] of [
  ['rsa2048', 'Gpg Rsa <rsa@example.test>'],
  ['ed25519', 'Gpg Ed <ed@example.test>'],
]) {
  const home = path.join(tmp, `gpg-${algorithm}`);
  fs.mkdirSync(home, { recursive: true });
  const run = gpgIn(home);
  run(['--quick-generate-key', uid, algorithm, 'sign', '0']);
  const publicArmored = run(['--armor', '--export', uid]);
  const sigFile = path.join(tmp, `gpg-${algorithm}.asc`);
  run(['--armor', '--detach-sign', '--output', sigFile, dataFile]);
  const result = pgp.verifyDetached(data, fs.readFileSync(sigFile, 'utf8'), publicArmored);
  assert.equal(result.valid, true, `нашият verifier трябва да приеме gpg ${algorithm} подпис: ${JSON.stringify(result)}`);
}

// ── 3. OpenPGP v6 (RFC 9580) — само ако инсталираният gpg го поддържа ───────
// GnuPG преди 2.5 (и някои 2.5 сборки) още не поддържат v6 ключове/алгоритъм 27,
// затова тук не се вали, а се отчита дали интеропът е възможен.
const homeV6 = path.join(tmp, 'v6');
fs.mkdirSync(homeV6, { recursive: true });
const v6 = pgp.generate({ algorithm: 'rsa2048', version: 6, userId: 'Interop V6 <v6@example.test>' });
const v6Pub = path.join(tmp, 'v6.pub.asc');
const v6Sig = path.join(tmp, 'v6.sig.asc');
fs.writeFileSync(v6Pub, v6.publicArmored);
fs.writeFileSync(v6Sig, pgp.signDetached(data, v6.secretArmored).armored);
let v6Supported = false;
try {
  gpgIn(homeV6)(['--import', v6Pub]);
  const out = gpgIn(homeV6)(['--status-fd', '1', '--verify', v6Sig, dataFile]);
  v6Supported = /\[GNUPG:\] GOODSIG/.test(out);
} catch {
  v6Supported = false;
}
if (v6Supported) {
  // Обратната посока: gpg подписва с импортирания v6 ключ, ние проверяваме.
  const sigFile6 = path.join(tmp, 'v6-gpg.sig.asc');
  gpgIn(homeV6)(['--armor', '--detach-sign', '--local-user', v6.fingerprint, '--output', sigFile6, dataFile]);
  const back6 = pgp.verifyDetached(data, fs.readFileSync(sigFile6, 'utf8'), v6.publicArmored);
  assert.equal(back6.valid, true, `нашият verifier трябва да приеме gpg v6 подпис: ${JSON.stringify(back6)}`);
  assert.equal(back6.version, 6);
  console.log('pgp-gpg-interop: OpenPGP v6 интероп потвърден');
} else {
  console.log('pgp-gpg-interop: инсталираният gpg не поддържа OpenPGP v6 — v6 се проверява само със собствени тестове');
}

// Уверяваме се, че v6 ключът не се е объркал с v4 (v4 подпис не минава с v6 ключ).
assert.equal(pgp.verifyDetached(data, pgp.signDetached(data, pgp.generate({ algorithm: 'ed25519' }).secretArmored).armored, v6.publicArmored).valid, false);

// ── 4. Криптиране: gpg → hAPI и компресията ────────────────────────────
// GnuPG компресира преди криптиране (zlib по подразбиране), а hAPI чете само SEIPD v1
// без компресия. Тук се проверява, че такова съобщение се ОТКАЗВА с точен код, а
// `--compress-algo none` минава.
// Ключът се прави с gpg, а не с нашия генератор: gpg отказва да криптира към ключ без
// self-signature с ключови флагове („Unusable public key“) — ограничение на gpg, не на hAPI.
// Версията на gpg решава формата: 2.4 пише SEIPD v1, а 2.5 по подразбиране AEAD/OCB.
// И двата изхода са ясни кодове, затова тестът твърди кода, който отговаря на ФАЙЛА,
// а не гадае според версията.
const homeEnc = path.join(tmp, 'gpg-enc');
fs.mkdirSync(homeEnc, { recursive: true });
const runEnc = gpgIn(homeEnc);
const encUid = 'Interop Enc <enc@example.test>';
runEnc(['--rfc4880', '--quick-generate-key', encUid, 'rsa2048', 'encr', '0']);
const encSecret = runEnc(['--armor', '--export-secret-keys', encUid]);
const plainFile = path.join(tmp, 'plain.txt');
fs.writeFileSync(plainFile, data);

/** Кодът, с който hAPI отказва съобщението (или 'OK', ако го отвори). */
const outcomeOf = (file) => {
  try {
    pgp.decryptMessage(fs.readFileSync(file, 'utf8'), encSecret, '');
    return 'OK';
  } catch (e) {
    return e.code || 'NO_CODE';
  }
};
/** Форматът на файла се чете от самите пакети, а не се предполага. */
const formOf = (file) => {
  const packets = pgp.readPackets(pgp.dearmor(fs.readFileSync(file, 'utf8')).data);
  if (packets.some((p) => p.tag === 20)) return 'aead';
  if (packets.some((p) => p.tag === 18)) return 'seipd1';
  return 'other';
};

const compFile = path.join(tmp, 'compressed.gpg');
runEnc(['--armor', '--encrypt', '--trust-model', 'always', '--recipient', encUid, '--compress-algo', 'zlib', '--output', compFile, plainFile]);
const plainGpg = path.join(tmp, 'uncompressed.gpg');
runEnc(['--armor', '--encrypt', '--trust-model', 'always', '--recipient', encUid, '--compress-algo', 'none', '--output', plainGpg, plainFile]);
const form = formOf(compFile);
if (form === 'seipd1') {
  assert.equal(outcomeOf(compFile), 'UNSUPPORTED_COMPRESSION', 'компресирано съобщение (SEIPD v1) трябва да даде UNSUPPORTED_COMPRESSION');
  assert.equal(outcomeOf(plainGpg), 'OK', 'съобщение от gpg без компресия трябва да се отвори');
  console.log('pgp-gpg-interop: gpg → hAPI — SEIPD v1 без компресия се отваря, с компресия дава UNSUPPORTED_COMPRESSION');
} else {
  // gpg 2.5: AEAD и за двете — отказът пак трябва да е точен, не обща грешка.
  assert.equal(form, 'aead', `непознат формат от gpg: ${form}`);
  assert.equal(outcomeOf(compFile), 'UNSUPPORTED_AEAD', 'AEAD съобщение от gpg трябва да даде UNSUPPORTED_AEAD');
  assert.equal(outcomeOf(plainGpg), 'UNSUPPORTED_AEAD', 'AEAD съобщение от gpg трябва да даде UNSUPPORTED_AEAD');
  console.log('pgp-gpg-interop: инсталираният gpg пише AEAD/OCB — gpg → hAPI криптиране се отказва с UNSUPPORTED_AEAD');
}


fs.rmSync(tmp, { recursive: true, force: true });
console.log('pgp-gpg-interop OK');
process.exit(0);
