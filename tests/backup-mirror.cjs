'use strict';
// Сценарий: втори backup таргет (огледало) с проверка по SHA-256.
//
//   • всяки нов backup се копира в backup_mirror и копието се сверява с оригинала;
//   • POST /admin/api/database/backups/verify преизчислява SHA-256 на всичко и
//     отчита състоянието на огледалото (ok / mismatch / missing);
//   • подправено копие не минава за валидно — verify го отчита като mismatch;
//   • backup_mirror = backup_folder е конфигурационна грешка → add-on-ът не стартира.
const { stopChild, freePort } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(base, attempts = 140) {
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await fetch(base + '/health')).ok) return true;
    } catch { }
    await sleep(50);
  }
  return false;
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-mirror-'));
  const primary = path.join(root, 'primary');
  const mirror = path.join(root, 'mirror');
  const port = await freePort();
  const token = 'backup-mirror-admin-token-0123456789';
  const base = `http://127.0.0.1:${port}`;

  const call = async (route, { method = 'GET' } = {}) => {
    const res = await fetch(base + route, { method, headers: { Authorization: 'Bearer ' + token } });
    let value = null;
    try {
      value = await res.json();
    } catch {
      value = null;
    }
    return { status: res.status, value };
  };

  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env,
      DATA_DIR: path.join(root, 'data'),
      OPTIONS_PATH: path.join(root, 'missing-options.json'),
      PORT: String(port),
      ADMIN_TOKEN: token,
      BACKUP_DIR: primary,
      BACKUP_MIRROR: mirror,
      BACKUP_DIR_ANY: '1',
      BACKUP_MIRROR_ANY: '1',
    },
    stdio: 'ignore',
  });

  try {
    assert.ok(await waitHealthy(base), 'сървърът стартира с огледало');

    // 1. Backup създава копие и го проверява.
    const created = await call('/admin/api/database/backup', { method: 'POST' });
    assert.equal(created.status, 201, JSON.stringify(created.value));
    const backup = created.value.backup;
    assert.match(backup.sha256, /^[a-f0-9]{64}$/);
    assert.ok(backup.mirror, 'отговорът трябва да носи информация за огледалото');
    assert.equal(backup.mirror.verified, true, JSON.stringify(backup.mirror));
    assert.equal(backup.mirror.sha256, backup.sha256, 'копието трябва да е байт-идентично');
    assert.equal(backup.mirror.dir, path.resolve(mirror));
    assert.ok(fs.existsSync(path.join(mirror, backup.name)), 'копието съществува на втория таргет');
    assert.ok(fs.existsSync(path.join(primary, backup.name)), 'оригиналът съществува на първия таргет');

    // 2. Списъкът показва къде е огледалото.
    const list = await call('/admin/api/database/backups');
    assert.equal(list.status, 200);
    assert.ok(list.value.backups.some((b) => b.name === backup.name));
    assert.equal(list.value.mirror.dir, path.resolve(mirror));

    // 3. Проверка: оригинала и копието съвпадат.
    const verify = await call('/admin/api/database/backups/verify', { method: 'POST' });
    assert.equal(verify.status, 200, JSON.stringify(verify.value));
    assert.equal(verify.value.checked, 1);
    assert.equal(verify.value.mismatched, 0);
    const item = verify.value.files.find((f) => f.name === backup.name);
    assert.equal(item.primary, 'ok');
    assert.equal(item.mirror, 'ok');
    assert.equal(item.sha256, backup.sha256);

    // 4. Подправено копие не минава за валидно.
    const mirrorFile = path.join(mirror, backup.name);
    fs.writeFileSync(mirrorFile, Buffer.concat([fs.readFileSync(mirrorFile), Buffer.from('tampered')]));
    const tampered = await call('/admin/api/database/backups/verify', { method: 'POST' });
    assert.equal(tampered.status, 200);
    assert.equal(tampered.value.mismatched, 1, 'подправеното копие се отчита');
    const bad = tampered.value.files.find((f) => f.name === backup.name);
    assert.equal(bad.primary, 'ok', 'оригиналът остава валиден');
    assert.equal(bad.mirror, 'mismatch');
    assert.notEqual(bad.mirrorSha256, bad.sha256);

    // 5. Липсващо копие също е видим проблем, не тишина.
    fs.unlinkSync(mirrorFile);
    const missing = await call('/admin/api/database/backups/verify', { method: 'POST' });
    assert.equal(missing.value.files.find((f) => f.name === backup.name).mirror, 'missing');
    assert.equal(missing.value.mismatched, 1);

    // 6. Втори backup след триенето пак създава валидно копие.
    const second = await call('/admin/api/database/backup', { method: 'POST' });
    assert.equal(second.status, 201);
    assert.equal(second.value.backup.mirror.verified, true);
    assert.notEqual(second.value.backup.name, backup.name, 'имената на архивите са уникални');

    console.log(
      'PASS backup mirror: SHA-256 проверка при създаване, verify API, подправено и липсващо копие',
    );
  } finally {
    await stopChild(child);
    fs.rmSync(root, { recursive: true, force: true });
  }

  // 7. Огледало, равно на първия таргет, е грешка — add-on-ът отказва старт.
  const sameRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-mirror-same-'));
  const sameDir = path.join(sameRoot, 'backups');
  const badPort = await freePort();
  const badChild = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env,
      DATA_DIR: path.join(sameRoot, 'data'),
      OPTIONS_PATH: path.join(sameRoot, 'missing-options.json'),
      PORT: String(badPort),
      ADMIN_TOKEN: 'backup-mirror-admin-token-0123456789',
      BACKUP_DIR: sameDir,
      BACKUP_MIRROR: sameDir,
      BACKUP_DIR_ANY: '1',
      BACKUP_MIRROR_ANY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const stderr = await new Promise((resolve) => {
      let text = '';
      badChild.stderr.on('data', (chunk) => {
        text += chunk.toString();
      });
      badChild.once('exit', () => resolve(text));
      setTimeout(() => {
        badChild.kill();
        resolve(text);
      }, 8000);
    });
    assert.notEqual(badChild.exitCode, 0, 'сървърът не бива да тръгва с огледало върху оригинала');
    assert.match(stderr, /backup_mirror must differ/, `stderr: ${stderr.slice(0, 300)}`);
  } finally {
    await stopChild(badChild);
    fs.rmSync(sameRoot, { recursive: true, force: true });
  }

})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
