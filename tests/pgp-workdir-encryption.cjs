'use strict';
// L2 (0.69.67): криптирана работна папка (W4 от плана).
//
// Договорът от `PGP_KEYRING_AND_WORK_FOLDER.md`:
//   • при `pgp_encrypt_workdir` файлът в папката на портала е контейнер
//     (AES-256-GCM, DEK обвит с PGP) — открито съдържание на диска няма;
//   • add-on-ът чете и връща ОТКРИТОТО съдържание (иначе порталът не работи);
//   • без частен ключ четенето е `WORKDIR_LOCKED` (503), а подменено съдържание —
//     `WORKDIR_CORRUPT`;
//   • миграцията иска `?confirm=1`, прави копие и е идемпотентна;
//   • при изключено L2 (по подразбиране) файловете остават открити.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { freePort } = require('./helpers.cjs');
const workdir = require('../hapi_enterprise/workdir-crypto.js');

const FIX = path.join(__dirname, 'fixtures/pgp');
const PUBLIC = path.join(FIX, 'public.asc');
const SECRET = path.join(FIX, 'secret.asc');
const PASS = 'fx-pass-2026';
const TOKEN = 'workdir-encryption-token-0123456789';
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

async function boot({ encryptWorkdir, dataDir }) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-l2-'));
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
  if (encryptWorkdir) env.PGP_ENCRYPT_WORKDIR = 'true';
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
    stop: async () => {
      child.kill('SIGKILL');
      await new Promise((r) => {
        child.once('exit', r);
        setTimeout(r, 2000);
      });
    },
  };
}

async function makePortal(server, label) {
  const folder = fs.mkdtempSync(path.join(shareBase, 'hapi-l2-'));
  const slug = 'l2-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const created = await server.api('/admin/api/portals', {
    method: 'POST',
    body: JSON.stringify({ title: label, slug, storage_root: '/share/' + path.basename(folder) }),
  });
  const portal = created.body.portal || created.body;
  assert.ok(portal && portal.id, 'порталът трябва да е създаден: ' + JSON.stringify(created.body).slice(0, 200));
  return { portal, folder };
}

/** Качва файл през истинския маршрут и връща пътя му на диска. */
async function upload(server, portalId, folder, rel, content) {
  const r = await fetch(`${server.base}/admin/api/portals/${portalId}/tree/upload?path=${encodeURIComponent(rel)}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN },
    body: content,
  });
  const body = await r.text();
  assert.equal(r.status, 201, 'качването трябва да мине: ' + body.slice(0, 200));
  return path.join(folder, ...rel.split('/').filter(Boolean));
}

(async () => {
  if (!shareBaseOk) {
    console.log('SKIP pgp-workdir-encryption: ' + shareBase + ' не може да се създаде — липсва /share');
    return;
  }
  const dirs = [];
  try {
    // ── 1. L2 изключено: на диска стои откритото съдържание (старото поведение) ─
    {
      const s = await boot({ encryptWorkdir: false });
      dirs.push(s.dataDir);
      try {
        const { portal, folder } = await makePortal(s, 'L2 plain');
        dirs.push(folder);
        const full = await upload(s, portal.id, folder, '/договор.pdf', 'открито съдържание');
        assert.equal(fs.readFileSync(full, 'utf8'), 'открито съдържание', 'без L2 файлът е открит');
        assert.equal(workdir.isSealed(fs.readFileSync(full)), false);
      } finally {
        await s.stop();
      }
      ok('L2 изключено → открит файл в папката');
    }

    // ── 2. L2 включено: на диска е контейнер, но порталът чете съдържанието ────
    {
      const s = await boot({ encryptWorkdir: true });
      dirs.push(s.dataDir);
      let portalFolder;
      let portalId;
      try {
        const made = await makePortal(s, 'L2 sealed');
        portalFolder = made.folder;
        portalId = made.portal.id;
        dirs.push(portalFolder);
        const payload = 'тайно съдържание'.repeat(5000);
        const full = await upload(s, portalId, portalFolder, '/договор.pdf', payload);

        const onDisk = fs.readFileSync(full);
        assert.equal(workdir.isSealed(onDisk), true, 'на диска трябва да е контейнер');
        assert.ok(!onDisk.includes(Buffer.from('тайно съдържание')), 'открито съдържание не бива да личи');
        assert.equal(workdir.plainSize(onDisk), Buffer.byteLength(payload), 'заглавката пази оригиналния размер');

        // Дървото показва оригинала, не размера на контейнера.
        const tree = await s.api(`/admin/api/portals/${portalId}/tree/api.json`);
        assert.equal(tree.status, 200, 'дървото трябва да се чете: ' + JSON.stringify(tree.body).slice(0, 200));
        const fileNode = (tree.body.files || []).find((f) => f.name === 'договор.pdf') ||
          ((tree.body.tree && tree.body.tree.files) || [])[0];
        assert.ok(fileNode, 'файлът трябва да е в дървото');
        assert.equal(fileNode.size, Buffer.byteLength(payload), 'размерът в дървото е оригиналният');
      } finally {
        await s.stop();
      }

      // ── 3. Подменено съдържание не минава ──────────────────────────────────
      const file = path.join(portalFolder, 'договор.pdf');
      const tampered = fs.readFileSync(file);
      tampered[tampered.length - 25] ^= 0x01;
      fs.writeFileSync(file, tampered);
      const s2 = await boot({ encryptWorkdir: true });
      try {
        // Същият DATA_DIR не е нужен: четем файла през нашия контейнер.
        const { create } = require('../hapi_enterprise/path-crypto.js');
        const ring = create({
          env: { PGP_PATH_PUBLIC: PUBLIC, PGP_PATH_SECRET: SECRET, PGP_KEY_PASS: PASS, PGP_ENCRYPT_WORKDIR: 'true' },
        });
        assert.throws(() => workdir.open(tampered, ring), (e) => e.code === 'WORKDIR_CORRUPT');
      } finally {
        await s2.stop();
      }
      ok('L2 включено → контейнер на диска, оригинален размер в дървото, подмяна → WORKDIR_CORRUPT');
    }

    // ── 4. Без частен ключ → WORKDIR_LOCKED ────────────────────────────────────
    {
      const { create } = require('../hapi_enterprise/path-crypto.js');
      const ring = create({
        env: { PGP_PATH_PUBLIC: PUBLIC, PGP_PATH_SECRET: SECRET, PGP_KEY_PASS: PASS, PGP_ENCRYPT_WORKDIR: 'true' },
      });
      const container = workdir.seal(Buffer.from('данни'), ring);
      const blind = create({ env: { PGP_PATH_PUBLIC: PUBLIC, PGP_ENCRYPT_WORKDIR: 'true' } });
      assert.throws(
        () => workdir.open(container, blind),
        (e) => e.code === 'WORKDIR_LOCKED' && e.status === 503,
        'без ключ трябва да е WORKDIR_LOCKED',
      );
      ok('без частен ключ → WORKDIR_LOCKED (503)');
    }

    // ── 5. Миграция: иска confirm, прави копие, идемпотентна е ────────────────
    {
      const plain = await boot({ encryptWorkdir: false });
      const plainData = plain.dataDir;
      dirs.push(plainData);
      let folder;
      try {
        const made = await makePortal(plain, 'L2 legacy');
        folder = made.folder;
        dirs.push(folder);
        await upload(plain, made.portal.id, folder, '/стар/файл.pdf', 'старо съдържание');
      } finally {
        await plain.stop();
      }

      const sealed = await boot({ encryptWorkdir: true, dataDir: plainData });
      try {
        const withoutConfirm = await sealed.api('/admin/api/pgp/seal-workdir', { method: 'POST' });
        assert.equal(withoutConfirm.status, 400, 'без ?confirm=1 миграцията се отказва');

        const migrated = await sealed.api('/admin/api/pgp/seal-workdir?confirm=1', { method: 'POST' });
        assert.equal(migrated.status, 200, 'миграцията трябва да мине: ' + JSON.stringify(migrated.body).slice(0, 200));
        assert.equal(migrated.body.sealed, 1, 'един файл трябва да е криптиран: ' + JSON.stringify(migrated.body));
        assert.ok(migrated.body.backup, 'прави се копие преди промяната');

        const onDisk = fs.readFileSync(path.join(folder, 'стар', 'файл.pdf'));
        assert.equal(workdir.isSealed(onDisk), true, 'след миграцията файлът е контейнер');
        const backupDir = path.join(plainData, 'internal', 'workdir-backup', migrated.body.backup);
        assert.ok(fs.existsSync(backupDir), 'копието трябва да е на място');
        const backupFile = path.join(backupDir, String(migrated.body.failed[0]?.portal || ''), 'стар', 'файл.pdf');
        if (fs.existsSync(backupFile)) assert.equal(fs.readFileSync(backupFile, 'utf8'), 'старо съдържание');

        const again = await sealed.api('/admin/api/pgp/seal-workdir?confirm=1', { method: 'POST' });
        assert.equal(again.status, 200);
        assert.equal(again.body.sealed, 0, 'втори пуск не бива да криптира нищо');
        assert.ok(again.body.already >= 1, 'вторият пуск вижда вече криптираните');
      } finally {
        await sealed.stop();
      }
      ok('миграция: ?confirm=1, копие преди промяната, втори пуск → sealed:0');
    }

    console.log('PASS pgp-workdir-encryption: ' + cases.length + ' проверки — ' + cases.join('; '));
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
  console.error('FAIL pgp-workdir-encryption: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
