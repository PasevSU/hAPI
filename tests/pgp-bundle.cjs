'use strict';
// Ключов пакет на диска: импорт при старт, роли от subkeys/*.json, без дубликати,
// повторен импорт през API не създава втори запис.
const { stopChild, freePort } = require('./helpers.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const pgp = require('../hapi_enterprise/pgp');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-bundle-'));
  const port = await freePort();
  const adminPort = await freePort();
  const token = 'bundle-test-admin-token-1234567890';
  const admin = `http://127.0.0.1:${adminPort}`;
  const base = `http://127.0.0.1:${port}`;
  let child;

  const key = pgp.generate({ algorithm: 'ed25519', version: 6, userId: 'Bundle Test <bundle@example.test>' });
  const bundleDir = path.join(dir, 'keys', `01-bundle-${key.fingerprint.slice(-8)}`);
  fs.mkdirSync(path.join(bundleDir, 'subkeys'), { recursive: true });
  fs.writeFileSync(path.join(bundleDir, 'public.asc'), key.publicArmored);
  fs.writeFileSync(path.join(bundleDir, 'private.asc'), key.secretArmored);
  fs.writeFileSync(path.join(bundleDir, 'subkeys', '01-sign.json'), JSON.stringify({ role: 'sign' }));
  fs.writeFileSync(path.join(bundleDir, 'subkeys', '02-encrypt-comms.json'), JSON.stringify({ role: 'encrypt-comms' }));

  const env = {
    ...process.env,
    DATA_DIR: dir,
    OPTIONS_PATH: path.join(dir, 'missing-options.json'),
    PORT: String(port),
    ADMIN_TOKEN: token,
    INGRESS_MODE: 'true',
    ADMIN_PORT: String(adminPort),
    ADMIN_BIND_HOST: '127.0.0.1',
  };
  const wait = async () => {
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(base + '/health')).status === 200) return true;
      } catch { }
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  const keys = async () => {
    const res = await fetch(admin + '/admin/api/pgp/keys', { headers: { Authorization: 'Bearer ' + token } });
    return { status: res.status, value: await res.json() };
  };

  try {
    child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env, stdio: 'ignore' });
    assert.equal(await wait(), true, 'сървърът стартира');

    // 1. Ключът от папката е импортиран с отпечатък, роли и шифрован секрет.
    const first = await keys();
    assert.equal(first.status, 200);
    assert.equal(first.value.keys.length, 1, 'един ключ от пакета');
    const imported = first.value.keys[0];
    assert.equal(imported.fingerprint, key.fingerprint);
    assert.equal(imported.keyId, key.keyId);
    assert.equal(imported.hasSecret, true, 'секретната част е прикачена');
    assert.equal(imported.source, 'bundle');
    assert.deepEqual([...imported.roles].sort(), ['encrypt-comms', 'sign'], 'ролите идват от subkeys/*.json');
    const publicBlock = await fetch(`${admin}/admin/api/pgp/keys/${imported.id}/public`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(publicBlock.status, 200);
    const published = await publicBlock.json();
    assert.equal(published.publicArmored.includes('BEGIN PGP PUBLIC KEY BLOCK'), true, 'публичната част се пази отделно');
    assert.equal(JSON.stringify(first.value.keys).includes('BEGIN PGP PRIVATE KEY BLOCK'), false, 'секретът не се връща в API-то');

    // 2. Рестарт: няма дубликат.
    await stopChild(child);
    child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env, stdio: 'ignore' });
    assert.equal(await wait(), true, 'сървърът стартира повторно');
    const second = await keys();
    assert.equal(second.value.keys.length, 1, 'повторният старт не дублира ключа');

    // 3. Ръчен импорт: нищо ново, едно пропуснато.
    const manual = await fetch(admin + '/admin/api/pgp/keys/import', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(manual.status, 200);
    const report = await manual.json();
    assert.equal(report.imported.length, 0);
    assert.equal(report.skipped.length, 1);
    assert.match(report.skipped[0].reason, /already imported/);
    assert.equal((await keys()).value.keys.length, 1);

    // 4. Без токен на ingress listener-а → admin по подразбиране (ролите са опционални).
    const anonymous = await fetch(admin + '/admin/api/pgp/keys/import', { method: 'POST' });
    assert.equal(anonymous.status, 200);

    console.log('PASS pgp bundle: импорт при старт, роли от subkeys, без дубликати, admin gate');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
