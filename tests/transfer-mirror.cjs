'use strict';
// ПРЕХВЪРЛЯНЕ + ОГЛЕДАЛО: второто копие трябва да следва файла, а не да остава сирак.
//
// `routes/file-transfer.js` вика `storeMirrored` при целта и `removeMirrored` при източника.
// Докато нямаше тест за тази връзка, „копирах файл, а огледалото не разбра“ щеше да се види
// само при възстановяване — тоест когато вече е късно. Тук се проверява с жив сървър:
//   1. качване → има копие в огледалото;
//   2. копиране в друг портал → има ВТОРО копие, байт по байт същото;
//   3. преместване → копието на източника го няма, на целта го има;
//   4. регистърът носи `mirror: 'ok'`, за да се вижда състоянието без да се рови по диска.
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { stopChild, freePort } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
let step = 'старт';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-transfer-mirror-'));
  const mirrorDir = path.join(dir, 'mirror');
  fs.mkdirSync(mirrorDir, { recursive: true });
  const port = await freePort();
  const token = 'transfer-mirror-token-9f2c1d4b7e';
  const child = spawn(process.execPath, [path.join(ROOT, 'hapi_enterprise', 'server.js')], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      PORT: String(port),
      ADMIN_TOKEN: token,
      STORAGE_MIRROR: mirrorDir,
      STORAGE_MIRROR_ANY: '1', // тестовата папка е извън /share — разрешаваме изрично
      PORTAL_FOLDER_COPY: 'false',
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (p, method = 'GET', data, headers = {}) => {
    const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, ...headers }, body: data });
    const type = r.headers.get('content-type') || '';
    const value = type.includes('application/json') ? await r.json() : await r.arrayBuffer();
    return { status: r.status, value };
  };
  const json = (p, method, body) => call(p, method, JSON.stringify(body), { 'Content-Type': 'application/json' });
  const mirrorCopy = (portalId, fileId) => path.join(mirrorDir, 'files', portalId, fileId);

  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await call('/health')).status === 200) { ready = true; break } } catch { /* още пали */ }
      await new Promise((r) => setTimeout(r, 30));
    }
    assert(ready, 'сървърът трябва да стартира');

    step = 'два портала';
    const A = (await json('/admin/api/portals', 'POST', { slug: 'mirror-a', title: 'Огледало А' })).value;
    const B = (await json('/admin/api/portals', 'POST', { slug: 'mirror-b', title: 'Огледало Б' })).value;
    assert.ok(A.id && B.id, 'порталите са създадени');

    step = 'качване';
    const bytes = Buffer.from('съдържание, което трябва да стигне и до огледалото', 'utf8');
    const uploaded = (await call(`/admin/api/portals/${A.id}/files`, 'POST', bytes, {
      'X-File-Name': encodeURIComponent('документ.txt'),
      'Content-Type': 'application/octet-stream',
    })).value;
    assert.ok(uploaded.id, 'файлът е качен');
    assert.ok(fs.existsSync(mirrorCopy(A.id, uploaded.id)), 'копието при качване е на мястото си');
    assert.equal(sha256(fs.readFileSync(mirrorCopy(A.id, uploaded.id))), uploaded.sha256, 'копието е байт по байт');

    step = 'копиране в друг портал';
    const copied = await json(`/admin/api/portals/${A.id}/files/${uploaded.id}/transfer`, 'POST', { mode: 'copy', targetPortalId: B.id });
    assert.equal(copied.status, 201, 'копирането минава: ' + JSON.stringify(copied.value));
    const copyId = copied.value.target.fileId;
    assert.ok(fs.existsSync(mirrorCopy(B.id, copyId)), 'огледалото има копие и за ЦЕЛТА');
    assert.equal(sha256(fs.readFileSync(mirrorCopy(B.id, copyId))), uploaded.sha256, 'копието в огледалото е същото съдържание');
    const targetFiles = (await call(`/admin/api/portals/${B.id}`)).value.files;
    assert.ok(targetFiles.some((f) => f.id === copyId), 'целта има записа в регистъра');
    assert.ok(fs.existsSync(mirrorCopy(A.id, uploaded.id)), 'при КОПИРАНЕ оригиналът остава и в огледалото');

    step = 'преместване';
    const moved = await json(`/admin/api/portals/${B.id}/files/${copyId}/transfer`, 'POST', { mode: 'move', targetPortalId: A.id });
    assert.equal(moved.status, 201, 'преместването минава: ' + JSON.stringify(moved.value));
    const movedId = moved.value.target.fileId;
    assert.equal(fs.existsSync(mirrorCopy(B.id, copyId)), false, 'при ПРЕМЕСТВАНЕ копието на източника се маха');
    assert.ok(fs.existsSync(mirrorCopy(A.id, movedId)), 'на целта има копие в огледалото');
    assert.equal(sha256(fs.readFileSync(mirrorCopy(A.id, movedId))), uploaded.sha256, 'байтовете оцеляват и в огледалото');

    console.log('transfer-mirror OK: качване → огледало · копиране → второ копие · преместване → източникът се освобождава (байт по байт)');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error('FAILED at step: ' + step);
  console.error(e);
  process.exit(1);
});
