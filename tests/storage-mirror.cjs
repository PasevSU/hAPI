'use strict';
// Сценарий: огледало на файловете (второ копие на всяко качване).
//
//   • качване пише и в `storage_mirror`, байтовете на копието съвпадат с оригинала;
//   • POST /admin/api/storage/mirror/verify сверява SHA-256 на двете страни;
//   • липсващ оригинал → `primaryMissing`, с repair се връща от копието (самолекуване);
//   • липсващо/подправено копие → `mirrorMissing` / `mismatch`, repair го поправя;
//   • изчезнали и двете → `lost` (repair не лъже, че е възстановено);
//   • изтриване на файл/портал чисти и копието;
//   • огледало върху самата data директория е грешка при старт.
const { stopChild } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(base, attempts = 160) {
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await fetch(base + '/health')).ok) return true;
    } catch {}
    await sleep(50);
  }
  return false;
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-storage-mirror-'));
  const dataDir = path.join(root, 'data');
  const mirrorDir = path.join(root, 'mirror');
  const port = 41100 + Math.floor(Math.random() * 400);
  const token = 'storage-mirror-admin-token-0123456789';
  const base = `http://127.0.0.1:${port}`;
  const auth = { Authorization: 'Bearer ' + token };

  const call = async (route, { method = 'GET', body } = {}) => {
    const res = await fetch(base + route, {
      method,
      headers: { ...auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
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
      DATA_DIR: dataDir,
      OPTIONS_PATH: path.join(root, 'missing-options.json'),
      PORT: String(port),
      ADMIN_TOKEN: token,
      STORAGE_MIRROR: mirrorDir,
      STORAGE_MIRROR_ANY: '1',
    },
    stdio: 'ignore',
  });

  try {
    assert.ok(await waitHealthy(base), 'сървърът стартира с огледало');

    const portal = await call('/admin/api/portals', { method: 'POST', body: { slug: 'mirror', title: 'Mirror' } });
    assert.equal(portal.status, 201, JSON.stringify(portal.value));
    const portalId = portal.value.id;

    const upload = async (name, body) => {
      const res = await fetch(`${base}/admin/api/portals/${portalId}/files`, {
        method: 'POST',
        headers: { ...auth, 'X-File-Name': name },
        body,
      });
      const text = await res.text();
      assert.equal(res.status, 201, text);
      return JSON.parse(text);
    };
    const fileA = await upload('a.txt', 'съдържание А'.repeat(50));
    const fileB = await upload('b.txt', 'съдържание Б'.repeat(50));

    const primaryPath = (id) => path.join(dataDir, 'files', portalId, id);
    const mirrorPath = (id) => path.join(mirrorDir, 'files', portalId, id);

    // 1. Копията съществуват и са байт-идентични.
    for (const file of [fileA, fileB]) {
      assert.ok(fs.existsSync(primaryPath(file.id)), 'оригиналът е на място');
      assert.ok(fs.existsSync(mirrorPath(file.id)), 'копието е на място');
      assert.deepEqual(fs.readFileSync(mirrorPath(file.id)), fs.readFileSync(primaryPath(file.id)));
    }

    // 2. Всичко е ok.
    const clean = await call('/admin/api/storage/mirror/verify', { method: 'POST' });
    assert.equal(clean.status, 200, JSON.stringify(clean.value));
    assert.equal(clean.value.checked, 2);
    assert.equal(clean.value.problems, 0);
    assert.equal(clean.value.dir, path.resolve(mirrorDir));
    for (const item of clean.value.files) {
      assert.equal(item.status, 'ok');
      assert.equal(item.equal, true);
    }

    // 3. Липсващ оригинал → primaryMissing; без repair нищо не се пипа.
    fs.unlinkSync(primaryPath(fileA.id));
    const missingPrimary = await call('/admin/api/storage/mirror/verify', { method: 'POST' });
    assert.equal(missingPrimary.status, 409);
    assert.equal(missingPrimary.value.files.find((f) => f.fileId === fileA.id).status, 'primaryMissing');
    assert.equal(fs.existsSync(primaryPath(fileA.id)), false, 'без repair оригиналът не се създава');

    // 4. repair връща оригинала от копието и файлът пак е валиден.
    const repaired = await call('/admin/api/storage/mirror/verify', { method: 'POST', body: { repair: true } });
    assert.equal(repaired.status, 200, JSON.stringify(repaired.value));
    assert.equal(repaired.value.repaired, 1);
    assert.equal(repaired.value.problems, 0);
    assert.deepEqual(fs.readFileSync(primaryPath(fileA.id)), fs.readFileSync(mirrorPath(fileA.id)));
    const integrity = await call(`/admin/api/portals/${portalId}/integrity`);
    assert.equal(integrity.value.verified, true, 'цялостта е възстановена');

    // 5. Липсващо копие → mirrorMissing, repair го създава.
    fs.unlinkSync(mirrorPath(fileB.id));
    const missingMirror = await call('/admin/api/storage/mirror/verify', { method: 'POST' });
    assert.equal(missingMirror.value.files.find((f) => f.fileId === fileB.id).status, 'mirrorMissing');
    const repairedMirror = await call('/admin/api/storage/mirror/verify', { method: 'POST', body: { repair: true } });
    assert.equal(repairedMirror.value.repaired, 1);
    assert.ok(fs.existsSync(mirrorPath(fileB.id)));

    // 6. Подправено копие → mismatch, repair връща оригинала.
    fs.writeFileSync(mirrorPath(fileB.id), Buffer.from('подправено копие'));
    const mismatch = await call('/admin/api/storage/mirror/verify', { method: 'POST' });
    assert.equal(mismatch.value.files.find((f) => f.fileId === fileB.id).status, 'mismatch');
    await call('/admin/api/storage/mirror/verify', { method: 'POST', body: { repair: true } });
    assert.deepEqual(fs.readFileSync(mirrorPath(fileB.id)), fs.readFileSync(primaryPath(fileB.id)));

    // 7. Изчезнали и двете → lost; repair не се лъже.
    fs.unlinkSync(primaryPath(fileA.id));
    fs.unlinkSync(mirrorPath(fileA.id));
    const lost = await call('/admin/api/storage/mirror/verify', { method: 'POST', body: { repair: true } });
    assert.equal(lost.value.files.find((f) => f.fileId === fileA.id).status, 'lost');
    assert.equal(lost.value.files.find((f) => f.fileId === fileA.id).repaired, false);
    assert.equal(fs.existsSync(primaryPath(fileA.id)), false);

    // 8. Изтриване през API чисти и копието.
    const del = await call(`/admin/api/portals/${portalId}/files/${fileB.id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.equal(fs.existsSync(mirrorPath(fileB.id)), false, 'копието се трие с файла');

    // 9. Изтриване на портала чисти цялата му папка в огледалото.
    fs.mkdirSync(path.join(mirrorDir, 'files', portalId), { recursive: true });
    const delPortal = await call(`/admin/api/portals/${portalId}`, { method: 'DELETE' });
    assert.equal(delPortal.status, 200);
    assert.equal(fs.existsSync(path.join(mirrorDir, 'files', portalId)), false, 'папката на портала се трие');

    // 10. SAMOLекуване при четене: оригиналът се връща от копието.
    const portal2 = await call('/admin/api/portals', { method: 'POST', body: { slug: 'heal', title: 'Heal' } });
    const healPortalId = portal2.value.id;
    const healUpload = await fetch(`${base}/admin/api/portals/${healPortalId}/files`, {
      method: 'POST',
      headers: { ...auth, 'X-File-Name': 'heal.txt' },
      body: 'данни за самолекуване',
    });
    const healFile = await healUpload.json();
    fs.unlinkSync(path.join(dataDir, 'files', healPortalId, healFile.id));
    const preview = await call(`/admin/api/portals/${healPortalId}/files/${healFile.id}/preview`);
    assert.equal(preview.status, 200, 'четенето минава към копието');
    assert.ok(fs.existsSync(path.join(dataDir, 'files', healPortalId, healFile.id)), 'оригиналът е възстановен');

    console.log(
      'PASS storage mirror: копие при качване, verify ok/primaryMissing/mirrorMissing/mismatch/lost, repair, самолекуване',
    );
  } finally {
    await stopChild(child);
    fs.rmSync(root, { recursive: true, force: true });
  }

  // 11. Огледало върху самата data директория е грешка при старт.
  const badRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-storage-mirror-bad-'));
  const badChild = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env,
      DATA_DIR: badRoot,
      OPTIONS_PATH: path.join(badRoot, 'missing-options.json'),
      PORT: String(41900 + Math.floor(Math.random() * 90)),
      ADMIN_TOKEN: 'storage-mirror-admin-token-0123456789',
      STORAGE_MIRROR: badRoot,
      STORAGE_MIRROR_ANY: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    const stderr = await new Promise((resolve) => {
      let text = '';
      badChild.stderr.on('data', (chunk) => {
        text += chunk.toString();
      });
      const timer = setTimeout(() => {
        badChild.kill();
        resolve(text);
      }, 8000);
      badChild.once('exit', () => {
        clearTimeout(timer);
        resolve(text);
      });
    });
    assert.notEqual(badChild.exitCode, 0, 'сървърът не бива да тръгва с огледало върху данните');
    assert.match(stderr, /storage_mirror must differ/, `stderr: ${stderr.slice(0, 300)}`);
  } finally {
    await stopChild(badChild);
    fs.rmSync(badRoot, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
