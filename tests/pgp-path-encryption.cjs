'use strict';
// L1 (0.69.67): вътрешните пътища в хранилището (W3 от плана).
//
// Договорът от `PGP_KEYRING_AND_WORK_FOLDER.md`:
//   • при `pgp_encrypt_paths` в записа стои `storagePathEnc` (PGP съобщение), а откритият
//     път се извежда при четене — в `db.json` не бива да има `storagePath`;
//   • без ключ четенето е `STORAGE_PATH_LOCKED`, не „празен път“;
//   • миграцията е еднократна, идемпотентна и прави копие на базата преди промяната;
//   • при изключено L1 (по подразбиране) поведението е старото — открит `storagePath`.
//
// Тестът работи с истински сървър, качва през истинските маршрути (`tree/upload` +
// `tree/register`) и чете СУРОВИТЕ данни от `db.json` (огледалото на SQLite хранилището),
// за да не разчита на това, което API-то връща.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { freePort } = require('./helpers.cjs');

const FIX = path.join(__dirname, 'fixtures/pgp');
const PUBLIC = path.join(FIX, 'public.asc');
const SECRET = path.join(FIX, 'secret.asc');
const PASS = 'fx-pass-2026';
const TOKEN = 'path-encryption-token-0123456789';
const cases = [];
const ok = (label) => cases.push(label);

// `/share` се разресолва спрямо устройството на ТЕКУЩАТА директория (сървърът наследява
// cwd), затова базата се взима от cwd — на Windows os.tmpdir() е на друго устройство.
const shareBase = path.join(path.parse(process.cwd()).root, 'share');
let shareBaseOk = true;
try {
  fs.mkdirSync(shareBase, { recursive: true });
} catch {
  shareBaseOk = false;
}

/** Стартира сървъра с изолирана инсталация и чака /health. */
async function boot({ encryptPaths, dataDir }) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-l1-'));
  const port = await freePort();
  const env = {
    ...process.env,
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    PORT: String(port),
    ADMIN_PORT: '0',
    PUBLIC_GATEWAY_PORT: '0',
    PGP_PATH_PUBLIC: PUBLIC,
    PGP_PATH_SECRET: SECRET,
    PGP_KEY_PASS: PASS,
  };
  if (encryptPaths) env.PGP_ENCRYPT_PATHS = 'true';
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += c.toString();
  });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(base + '/health')).status === 200) {
        up = true;
        break;
      }
    } catch {
      /* още не слуша */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(up, 'сървърът не вдигна /health: ' + stderr.slice(0, 300));
  const auth = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
  const api = async (p, init = {}) => {
    const r = await fetch(base + p, { headers: auth, ...init });
    const text = await r.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: r.status, body };
  };
  return {
    dataDir: dir,
    base,
    api,
    auth,
    stop: async () => {
      child.kill('SIGKILL');
      await new Promise((r) => {
        child.once('exit', r);
        setTimeout(r, 2000);
      });
    },
  };
}

/** Суровите данни от огледалото на хранилището (не от API-то). */
const rawStore = (dataDir) => {
  const file = path.join(dataDir, 'db.json');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

/** Създава портал със собствена папка в /share (изолирана за теста). */
async function makePortal(server, label) {
  const folder = fs.mkdtempSync(path.join(shareBase, 'hapi-l1-'));
  const storageRoot = '/share/' + path.basename(folder);
  // Slug-ът има собствен формат (малки букви/цифри/тире), затова не се взима от името на
  // папката (mkdtemp слага главни букви), а се прави отделен уникален.
  const slug = 'l1-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const created = await server.api('/admin/api/portals', {
    method: 'POST',
    body: JSON.stringify({ title: label, slug, storage_root: storageRoot }),
  });
  const portal = created.body.portal || created.body;
  assert.ok(portal && portal.id, 'порталът трябва да е създаден: ' + JSON.stringify(created.body).slice(0, 200));
  return { portal, folder };
}

/** Качва файл в папката на портала и го регистрира (двете стъпки, които прави панелът). */
async function uploadAndRegister(server, portalId, relPath, content) {
  // `mkdir=1`: тестът качва по вложен път нарочно (като избрана цяла папка), а качване
  // на файл в липсваща папка вече е 404 — папки не се създават мълчаливо.
  const upl = await fetch(
    `${server.base}/admin/api/portals/${portalId}/tree/upload?path=${encodeURIComponent(relPath)}&mkdir=1`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: content },
  );
  const upBody = await upl.text();
  if (![200, 201].includes(upl.status)) return { step: 'upload', status: upl.status, body: upBody };
  const reg = await server.api(`/admin/api/portals/${portalId}/tree/register`, {
    method: 'POST',
    body: JSON.stringify({ path: relPath }),
  });
  return { step: 'register', status: reg.status, body: reg.body };
}

(async () => {
  if (!shareBaseOk) {
    console.log('SKIP pgp-path-encryption: ' + shareBase + ' не може да се създаде — липсва /share');
    return;
  }
  const dirs = [];
  try {
    // ── 1. По подразбиране (L1 изключено): пътят е открит, както преди ────────
    {
      const s = await boot({ encryptPaths: false });
      dirs.push(s.dataDir);
      try {
        const { portal, folder } = await makePortal(s, 'L1 plain');
        dirs.push(folder);
        const up = await uploadAndRegister(s, portal.id, '/договор-17.pdf', 'съдържание');
        assert.equal(up.status, 201, 'качването трябва да мине: ' + JSON.stringify(up.body).slice(0, 200));
        const raw = rawStore(s.dataDir);
        assert.ok(raw.includes('"storagePath":'), 'без L1 пътят е открит (документирано поведение)');
        assert.ok(!raw.includes('storagePathEnc'), 'без L1 няма шифротекст');
        const state = await s.api('/admin/api/pgp/keyring');
        assert.equal(state.body.keyring.encryptPaths, false);
      } finally {
        await s.stop();
      }
      ok('L1 изключено → открит storagePath (без промяна)');
    }

    // ── 2. L1 включено: в хранилището няма открит път, но четенето работи ─────
    {
      const s = await boot({ encryptPaths: true });
      dirs.push(s.dataDir);
      try {
        const { portal, folder } = await makePortal(s, 'L1 sealed');
        dirs.push(folder);
        const up = await uploadAndRegister(s, portal.id, '/договор-17.pdf', 'тайно съдържание');
        assert.equal(up.status, 201, 'качването трябва да мине: ' + JSON.stringify(up.body).slice(0, 200));

        const raw = rawStore(s.dataDir);
        assert.ok(!raw.includes('"storagePath":'), 'в хранилището не бива да има открит storagePath');
        assert.ok(raw.includes('storagePathEnc'), 'трябва да има storagePathEnc');

        const list = await s.api(`/admin/api/portals/${portal.id}/files`);
        const files = (list.body && (list.body.files || list.body)) || [];
        const file = Array.isArray(files) ? files.find((f) => f.name === 'договор-17.pdf') : null;
        assert.ok(file, 'файлът трябва да се вижда в списъка: ' + JSON.stringify(list.body).slice(0, 200));
        assert.equal(file.storagePath, '/договор-17.pdf', 'пътят идва разшифрован през API-то');
      } finally {
        await s.stop();
      }
      ok('L1 включено → storagePathEnc в хранилището, разшифрован път през API');
    }

    // ── 3. Миграция: стар запис с открит път → шифротекст, идемпотентно ───────
    {
      const plain = await boot({ encryptPaths: false });
      let portalFolder;
      const plainDataDir = plain.dataDir;
      dirs.push(plainDataDir);
      try {
        const made = await makePortal(plain, 'L1 legacy');
        portalFolder = made.folder;
        dirs.push(portalFolder);
        const up = await uploadAndRegister(plain, made.portal.id, '/стара-папка/файл.pdf', 'старо съдържание');
        assert.equal(up.status, 201, 'качването трябва да мине');
        assert.ok(rawStore(plainDataDir).includes('"storagePath":'), 'преди миграцията пътят е открит');
      } finally {
        await plain.stop();
      }

      // Същата DATA директория, но със включено L1: миграцията се пуска през API-то.
      const sealed = await boot({ encryptPaths: true, dataDir: plainDataDir });
      try {
        const migrated = await sealed.api('/admin/api/pgp/seal-paths', { method: 'POST' });
        assert.equal(migrated.status, 200, 'миграцията трябва да мине: ' + JSON.stringify(migrated.body).slice(0, 200));
        assert.ok(migrated.body.sealed >= 1, 'поне един запис трябва да е криптиран');
        assert.ok(migrated.body.backup, 'преди миграцията се прави копие на базата');

        const raw = rawStore(plainDataDir);
        assert.ok(!raw.includes('"storagePath":'), 'след миграцията няма открит storagePath');
        assert.ok(raw.includes('storagePathEnc'), 'след миграцията има storagePathEnc');

        const again = await sealed.api('/admin/api/pgp/seal-paths', { method: 'POST' });
        assert.equal(again.status, 200);
        assert.equal(again.body.sealed, 0, 'втори пуск не бива да криптира нищо');
        assert.ok(again.body.already >= 1, 'вторият пуск вижда вече криптираните');
      } finally {
        await sealed.stop();
      }
      ok('миграция: открит път → шифротекст, с копие на базата и без повторна работа');
    }

    // ── 4. Без ключ криптиран път не се чете тихо като празен ─────────────────
    {
      const { create } = require('../hapi_enterprise/path-crypto.js');
      const ring = create({
        env: { PGP_PATH_PUBLIC: PUBLIC, PGP_PATH_SECRET: SECRET, PGP_KEY_PASS: PASS, PGP_ENCRYPT_PATHS: 'true' },
      });
      const armored = ring.sealPath('/вътрешен/път.pdf');
      assert.match(armored, /-----BEGIN PGP MESSAGE-----/);
      const blind = create({ env: { PGP_PATH_PUBLIC: PUBLIC, PGP_ENCRYPT_PATHS: 'true' } });
      assert.throws(
        () => blind.openPath(armored),
        (e) => e.code === 'STORAGE_PATH_LOCKED' && e.status === 503,
        'без частен ключ пътят трябва да е STORAGE_PATH_LOCKED, не празен низ',
      );
      assert.equal(ring.openPath(armored), '/вътрешен/път.pdf');
      const disabled = create({ env: { PGP_PATH_PUBLIC: PUBLIC } });
      assert.throws(() => disabled.sealPath('/x'), (e) => e.code === 'PGP_PATHS_DISABLED');
      ok('без ключ → STORAGE_PATH_LOCKED; без L1 → PGP_PATHS_DISABLED');
    }

    // ── 5. Отговорът за ключовете не носи парола и път (INV-P7), включително L1 ─
    {
      const s = await boot({ encryptPaths: true });
      dirs.push(s.dataDir);
      try {
        const state = await s.api('/admin/api/pgp/keyring');
        const dump = JSON.stringify(state.body);
        assert.equal(state.status, 200);
        assert.ok(!dump.includes(PASS), 'паролата не бива да излиза');
        assert.ok(!dump.includes(PUBLIC) && !dump.includes(SECRET), 'пътищата до ключовете не бива да излизат');
      } finally {
        await s.stop();
      }
      ok('INV-P7: L1 не добавя парола/път към отговора за ключовете');
    }

    console.log('PASS pgp-path-encryption: ' + cases.length + ' проверки — ' + cases.join('; '));
  } finally {
    for (const dir of dirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* чистенето не е част от договора */
      }
    }
  }
})().catch((err) => {
  console.error('FAIL pgp-path-encryption: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
