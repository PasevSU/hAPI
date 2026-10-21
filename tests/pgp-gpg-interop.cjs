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

fs.rmSync(tmp, { recursive: true, force: true });
console.log('pgp-gpg-interop OK');
process.exit(0);
