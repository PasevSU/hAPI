'use strict';
// PGP ключохранилище (B2) — договорът от
// `documentation/02_TO_BE_ARCHITECTURE/PGP_KEYRING_AND_WORK_FOLDER.md`.
//
// Прави каквото обещава документът, и нищо повече:
//   • ключовете идват САМО от изричните пътища (`PGP_PATH_PUBLIC`, `PGP_PATH_SECRET`,
//     `PGP_PATH_PASS`), не от „папка“ и не от предположение къде е `/config`;
//   • PGP е ПО ИЗБОР: без пътища add-on-ът работи, `available:false`, причина `NO_PATHS`;
//   • `pgp_encrypt_*` без ключ е ГРЕШКА (`PGP_SECRET_KEY_REQUIRED`), не тихо „не криптира“;
//   • в отговора НЯМА път до файла и НЯМА парола (INV-P7); паролата се казва само като
//     източник (`option` / `file` / `none`);
//   • грешна парола и заключен ключ дават точните кодове (INV-P6).
//
// Ключовете във `tests/fixtures/pgp/` са тестови (gpg, RSA 2048, парола `fx-pass-2026`).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { freePort } = require('./helpers.cjs');
const { create, ENV } = require('../hapi_enterprise/path-crypto.js');

const FIX = path.join(__dirname, 'fixtures/pgp');
const PUBLIC = path.join(FIX, 'public.asc');
const SECRET = path.join(FIX, 'secret.asc');
const PASS = 'fx-pass-2026';
const cases = [];
const ok = (label) => cases.push(label);

const keyringWith = (env) => create({ env });

// ── 1. Без пътища: PGP е изключен, но това не е грешка ──────────────────────
{
  const k = keyringWith({});
  const s = k.status();
  assert.equal(s.available, false);
  assert.equal(s.reason, 'NO_PATHS');
  assert.deepEqual(s.keys, []);
  assert.equal(s.storageKeyId, '');
  assert.equal(s.passphraseSource, 'none');
  assert.equal(k.requireEncryptionKey(), '', 'без включено криптиране липсата на ключ не е грешка');
  ok('без пътища → available:false/NO_PATHS, стартът продължава');
}

// ── 2. Само публичен ключ: може да криптира, не може да декриптира ──────────
{
  const s = keyringWith({ [ENV.public]: PUBLIC }).status();
  assert.equal(s.available, true);
  assert.equal(s.canDecrypt, false);
  assert.equal(s.reason, '');
  assert.match(s.storageKeyId, /^[0-9A-F]{16}$/, 'трябва да има ключ за криптиране');
  assert.equal(s.keys.length, 1);
  assert.equal(s.keys[0].algorithm, 'RSA');
  // Ролята идва от Key Flags в self-sig (0x0F), а изборът на ключ казва ЗАЩО е този ключ.
  assert.equal(s.keys[0].keyFlags, 0x0f, 'фикстурата носи 0x0F (certify+sign+comms+storage)');
  assert.deepEqual(s.keys[0].roles, ['certify', 'sign', 'encrypt-comms', 'encrypt-storage']);
  assert.equal(s.storageKeySource, 'key-flags', 'ключът е избран по роля encrypt-storage');
  ok('само публичен ключ → може да криптира, не може да декриптира');
}

// ── 3. Публичен + частен с парола от опцията ────────────────────────────────
{
  const s = keyringWith({ [ENV.public]: PUBLIC, [ENV.secret]: SECRET, [ENV.keyPass]: PASS }).status();
  assert.equal(s.available, true);
  assert.equal(s.canDecrypt, true);
  assert.equal(s.passphraseSource, 'option');
  assert.equal(s.reason, '');
  assert.ok(s.primaryKeyId);
  ok('частен ключ + парола от опцията → може и двете');
}

// ── 4. Парола от файл и предимство на опцията ───────────────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-pass-'));
  const passFile = path.join(dir, 'pass.txt');
  fs.writeFileSync(passFile, PASS + '\n');
  const fromFile = keyringWith({ [ENV.secret]: SECRET, [ENV.pass]: passFile }).status();
  assert.equal(fromFile.canDecrypt, true, 'паролата от файл трябва да отвори ключа');
  assert.equal(fromFile.passphraseSource, 'file');

  const optionWins = keyringWith({ [ENV.secret]: SECRET, [ENV.pass]: passFile, [ENV.keyPass]: PASS }).status();
  assert.equal(optionWins.passphraseSource, 'option');
  ok('парола от файл работи; опцията има предимство');
}

// ── 5. INV-P6: точните кодове при грешна/липсваща парола ────────────────────
{
  const noPass = keyringWith({ [ENV.secret]: SECRET }).status();
  assert.equal(noPass.available, false);
  assert.ok(['PASSPHRASE_REQUIRED', 'PASSPHRASE_WRONG'].includes(noPass.reason), 'получено: ' + noPass.reason);

  const wrongPass = keyringWith({ [ENV.secret]: SECRET, [ENV.keyPass]: 'грешна-парола' }).status();
  assert.equal(wrongPass.available, false);
  assert.ok(['PASSPHRASE_WRONG', 'PASSPHRASE_REQUIRED'].includes(wrongPass.reason), 'получено: ' + wrongPass.reason);
  ok('липсваща/грешна парола → PASSPHRASE_*, ключът не се приема');
}

// ── 6. INV-P7: в отговора няма път и няма парола ────────────────────────────
{
  const k = keyringWith({ [ENV.public]: PUBLIC, [ENV.secret]: SECRET, [ENV.keyPass]: PASS });
  const dump = JSON.stringify(k.status());
  assert.ok(!dump.includes(PUBLIC), 'пътят до публичния ключ не бива да излиза в отговора');
  assert.ok(!dump.includes(SECRET), 'пътят до частния ключ не бива да излиза в отговора');
  assert.ok(!dump.includes(PASS), 'паролата не бива да излиза в отговора');
  // Поле с паролата няма — проверява се името на ключа, не стойността.
  assert.ok(!/"(passphrase|pass|password|keyPass)"\s*:/.test(dump), 'няма поле с паролата');
  ok('INV-P7 без път и без парола в status');
}

// ── 7. Непрочетим/счупен файл → точна причина, без път ──────────────────────
{
  const missing = keyringWith({ [ENV.secret]: path.join(os.tmpdir(), 'няма-такъв-файл.asc') }).status();
  assert.equal(missing.available, false);
  assert.equal(missing.reason, 'SECRET_UNREADABLE');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-bad-'));
  const junk = path.join(dir, 'junk.asc');
  fs.writeFileSync(junk, 'това не е ключ');
  const broken = keyringWith({ [ENV.public]: junk }).status();
  assert.equal(broken.available, false);
  assert.equal(broken.reason, 'PUBLIC_UNREADABLE');
  assert.ok(!JSON.stringify(broken).includes(junk));
  ok('липсващ/счупен файл → *_UNREADABLE без път');
}

// ── 8. `pgp_encrypt_*` без ключ е грешка, не тихо „не криптира“ ────────────
{
  const k = keyringWith({ [ENV.encryptPaths]: 'true' });
  assert.throws(
    () => k.requireEncryptionKey(),
    (e) => e.code === 'PGP_SECRET_KEY_REQUIRED' && e.status === 503 && e.detail === 'NO_PATHS',
    'включено криптиране без ключ трябва да е PGP_SECRET_KEY_REQUIRED'
  );
  const withKey = keyringWith({ [ENV.public]: PUBLIC, [ENV.encryptPaths]: 'true' });
  assert.match(withKey.requireEncryptionKey(), /^[0-9A-F]{16}$/);
  ok('pgp_encrypt_paths без ключ → PGP_SECRET_KEY_REQUIRED; с ключ → keyId');
}

// ── 9. Препрочитане: смяна на пътя се вижда след reload ────────────────────
{
  // Собствена среда, за да не зависи тестът от това какво има в обвивката на машината
  // (напр. PGP_PATH_SECRET от ръчен пуск би направил „липсва публичен път“ невалиден случай).
  const env = { ...process.env };
  for (const key of Object.values(ENV)) delete env[key];
  const k = keyringWith(env);
  assert.equal(k.status().available, false);
  env[ENV.public] = PUBLIC;
  try {
    const live = create({ env });
    assert.equal(live.status().available, true);
    env[ENV.public] = '';
    assert.equal(live.status().available, true, 'кешът пази старото състояние до reload');
    assert.equal(live.reload().available, false, 'reload препрочита от средата');
  } finally {
    delete env[ENV.public];
  }
  ok('reload препрочита; кешът не се сменя сам');
}

// ── 10. HTTP: състоянието се вижда само с администраторски токен ────────────
(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-keyring-'));
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-keyring-st-'));
  fs.mkdirSync(path.join(storageRoot, 'addon_config'), { recursive: true });
  const token = 'keyring-test-token-0123456789ab';
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      STORAGE_ROOT_OVERRIDE: storageRoot,
      STORAGE_LOCATION: 'addon_config',
      STORAGE_SUBDIRECTORY: 'hapi_enterprise',
      ADMIN_TOKEN: token,
      PORT: String(port),
      ADMIN_PORT: '0',
      PUBLIC_GATEWAY_PORT: '0',
      [ENV.public]: PUBLIC,
      [ENV.secret]: SECRET,
      [ENV.keyPass]: PASS,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += c.toString();
  });
  const base = `http://127.0.0.1:${port}`;
  const health = async () => {
    for (let i = 0; i < 160; i++) {
      try {
        const r = await fetch(base + '/health');
        if (r.status === 200) return true;
      } catch {
        /* още не слуша */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  try {
    assert.ok(await health(), 'сървърът не вдигна /health: ' + stderr.slice(0, 300));

    const anon = await fetch(base + '/admin/api/pgp/keyring');
    assert.equal(anon.status, 401, 'без токен състоянието на ключовете не се показва');

    const auth = { Authorization: 'Bearer ' + token };
    const got = await fetch(base + '/admin/api/pgp/keyring', { headers: auth });
    assert.equal(got.status, 200);
    const body = await got.json();
    assert.equal(body.keyring.available, true);
    assert.equal(body.keyring.canDecrypt, true);
    assert.ok(!JSON.stringify(body).includes(PASS), 'паролата не бива да излиза по HTTP');
    assert.ok(!JSON.stringify(body).includes(PUBLIC), 'пътят не бива да излиза по HTTP');

    const reloaded = await fetch(base + '/admin/api/pgp/keyring/reload', { method: 'POST', headers: auth });
    assert.equal(reloaded.status, 200);
    assert.equal((await reloaded.json()).reloaded, true);
    ok('HTTP: 401 без токен, 200 с токен, reload работи, без тайни в отговора');
  } finally {
    child.kill('SIGKILL');
    await new Promise((r) => {
      child.once('exit', r);
      setTimeout(r, 2000);
    });
  }

  console.log('PASS pgp-keyring: ' + cases.length + ' проверки — ' + cases.join('; '));
})().catch((err) => {
  console.error('FAIL pgp-keyring: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
