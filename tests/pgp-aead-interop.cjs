'use strict';
// AEAD-ЗАЩИТА НА СЕКРЕТЕН КЛЮЧ СРЕЩУ ВТОРА РЕАЛИЗАЦИЯ (RFC 9580 §5.5.3, usage 253).
//
// Досега `pgp.js` проверяваше себе си със себе си: `sealAeadSecretSection` заключва,
// `openAeadSecretSection` отваря. Това хваща подправен байт, но НЕ хваща системна грешка —
// ако подредбата на полетата, nonce-то или свързаните данни са сгрешени по един и същ начин
// и в двете посоки, тестът пак е зелен. GnuPG 2.5.24 не може да е еталон (отказва 253).
//
// Затова еталонът е `tests/lib/aead-interop.py`: друг език, друга библиотека
// (`cryptography` → AESOCB3/AESGCM), а S2K, AD, nonce и подредбата са написани наново по RFC.
// Проверяват се ДВЕТЕ посоки, защото всяка покрива различна грешка:
//   • наш ключ → Python декриптира: хваща грешка в ТОВА, което пишем;
//   • ключ на Python → нашият двигател го отваря: хваща грешка в ТОВА, което четем.
// Ако `cryptography` липсва, тестът се ПРОПУСКА с изрично съобщение — не „минава тихо“.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const pgp = require('../hapi_enterprise/pgp.js');

const PASS = 'interop-pass-2026';
const script = path.join(__dirname, 'lib', 'aead-interop.py');
const cases = [];
const ok = (label) => cases.push(label);

const findPython = () => {
  for (const cmd of ['python', 'py']) {
    const r = spawnSync(cmd, ['-c', 'import cryptography, sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  return '';
};
const python = findPython();
if (!python) {
  console.log('PASS pgp-aead-interop: пропуснат — няма python с `cryptography` (независим еталон няма)');
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-aead-interop-'));
const run = (command, payload) => {
  const file = path.join(tmp, command + '-' + Math.random().toString(16).slice(2, 8) + '.json');
  fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  const r = spawnSync(python, [script, command, file], { encoding: 'utf8' });
  fs.rmSync(file, { force: true });
  const out = (() => {
    try { return JSON.parse(String(r.stdout || '').trim()) } catch { return null }
  })();
  return { status: r.status, out, stderr: String(r.stderr || '') };
};

// ── 0. Фикстурът: истински v6 ключ от нашия двигател ────────────────────────
const v6 = pgp.generate({ version: 6, algorithm: 'ed25519', userId: 'interop probe <interop@probe.test>' });
const secretPacket = pgp.readPackets(pgp.dearmor(v6.secretArmored).data)[0];
assert.equal(secretPacket.body[0], 6, 'секретният пакет е v6');
const publicBody = secretPacket.body.subarray(0, secretPacket.body.length - 1 - 32);
const plainSecret = Buffer.from(secretPacket.body.subarray(publicBody.length + 1));
const rebuild = (sealed) => pgp.armor('PRIVATE', pgp.packet(5, Buffer.concat([publicBody, sealed])));
ok('фикстур: v6 ключ от нашия двигател, секретната секция отделена от публичната част');

// ── 1. Наш ключ → независимата реализация трябва да го отвори ───────────────
{
  const sealed = pgp.sealAeadSecretSection({ plain: plainSecret, publicBody, passphrase: PASS });
  const out = run('decrypt', {
    sealed: Buffer.from(sealed).toString('base64'),
    publicBody: Buffer.from(publicBody).toString('base64'),
    passphrase: PASS,
  });
  assert.equal(out.status, 0, 'Python декриптира нашия ключ: ' + JSON.stringify(out.out) + ' ' + out.stderr);
  assert.deepEqual(Buffer.from(out.out.plain, 'base64'), plainSecret,
    'независимата реализация връща ТОЧНИТЕ байтове на секретната секция');
  ok('нашият AEAD ключ се отваря от независима реализация (същите байтове)');
}

// ── 2. Грешна парола пада и при независимата реализация ─────────────────────
// Ако този тест минеше, еталонът не проверява автентикация, а само „някакъв“ шифър.
{
  const sealed = pgp.sealAeadSecretSection({ plain: plainSecret, publicBody, passphrase: PASS });
  const out = run('decrypt', {
    sealed: Buffer.from(sealed).toString('base64'),
    publicBody: Buffer.from(publicBody).toString('base64'),
    passphrase: 'грешна-парола',
  });
  assert.notEqual(out.status, 0, 'с грешна парола Python трябва да се провали');
  assert.ok(out.out && out.out.error, 'причината се казва: ' + JSON.stringify(out.out));
  ok('независимата реализация отказва грешна парола (тагът е автентикация, не декор)');
}

// ── 3. Ключ, заключен от независимата реализация → нашият двигател го отваря ─
// Двата варианта на подредбата: RFC-овият (с октет за дължина) и този без него, който
// `openAeadSecretSection` съзнателно приема — точно тук се вижда дали толерантността работи.
for (const variant of ['with-length', 'without-length']) {
  const out = run('encrypt', {
    plain: Buffer.from(plainSecret).toString('base64'),
    publicBody: Buffer.from(publicBody).toString('base64'),
    passphrase: PASS,
    variant,
  });
  assert.equal(out.status, 0, 'Python заключва ключ (' + variant + '): ' + JSON.stringify(out.out));
  const sealed = Buffer.from(out.out.sealed, 'base64');
  assert.equal(sealed[0], 253, 'чуждaта секция също започва с 253');
  const parsed = pgp.parseKeyBlock(rebuild(sealed), { passphrase: PASS }).primary;
  assert.equal(parsed.version, 6, 'нашият двигател разчита ключа като v6');
  assert.equal(parsed.fingerprint, v6.fingerprint, 'отпечатъкът съвпада — значи секретът е същият');
  // Контролната сума на секретната секция се проверява след декриптиране: ако байтовете не
  // са ТОЧНИТЕ, разборът пада. Затова успехът тук не е „някакъв ключ“, а същият ключ.
  assert.throws(
    () => pgp.parseKeyBlock(rebuild(sealed), { passphrase: 'грешна-парола' }),
    (e) => e.code === 'PASSPHRASE_WRONG' || e.code === 'BAD_KEY' || e.code === 'CHECKSUM',
    'чуждият ключ с грешна парола се отказва',
  );
  ok('ключ, заключен от независимата реализация (' + variant + '), се отваря от нашия двигател');
}

// ── 4. Подправен байт в ЧУЖДИЯ шифротекст се хваща от нашия двигател ───────
{
  const out = run('encrypt', {
    plain: Buffer.from(plainSecret).toString('base64'),
    publicBody: Buffer.from(publicBody).toString('base64'),
    passphrase: PASS,
  });
  const sealed = Buffer.from(out.out.sealed, 'base64');
  sealed[sealed.length - 20] ^= 0xff;
  assert.throws(
    () => pgp.parseKeyBlock(rebuild(sealed), { passphrase: PASS }),
    (e) => e.code === 'PASSPHRASE_WRONG' || e.code === 'BAD_KEY' || e.code === 'CHECKSUM',
    'подправен чужд шифротекст не се приема',
  );
  ok('подправен байт в чужд AEAD шифротекст → отказ (нашата страна също автентикира)');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS pgp-aead-interop: ' + cases.length + ' проверки — ' + cases.join('; '));
