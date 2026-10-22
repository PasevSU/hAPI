'use strict';
// ОРАКУЛ: препращането към папките е ЕДНОЗНАЧНО.
//
// Дефектът до 0.69.19: регистриран в портала файл не пазеше пътя си, а панелът свързваше
// „файл от дървото ↔ файл в портала“ ПО ИМЕ. Затова:
//   • едноименен файл от друга папка „крадеше“ картата (два документа изглеждаха като един);
//   • втори файл със същото име от друга папка не можеше да се регистрира (409).
//
// Проверява се точният резултат:
//   • регистрацията пази `storagePath` и едноименни файлове в РАЗЛИЧНИ папки са различни
//     документи (различни id, различни отпечатъци);
//   • същият път не се регистрира два пъти (409);
//   • свързването в панела е по ПЪТ; по име — само за стар запис без път;
//   • пакетът на папка съдържа само нейните файлове.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { stopChild, freePort } = require('./helpers.cjs');
const fm = require('../hapi_enterprise/ui/files-manager.js');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-folder-refs-'));
  const token = 'folder-refs-token-24-characters-ok';
  const port = await freePort();

  // storage_root винаги е под /share — както е в контейнера.
  const shareBase = path.join(path.parse(os.tmpdir()).root, 'share');
  try {
    fs.mkdirSync(shareBase, { recursive: true });
  } catch (e) {
    console.log(`SKIP portal-folder-refs: ${shareBase} не може да се създаде (${e.code || e.message}) — липсва /share`);
    process.exit(0);
  }
  const storageDir = fs.mkdtempSync(path.join(shareBase, 'hapi-refs-'));
  const storageRoot = '/share/' + path.basename(storageDir);

  // Две папки с ЕДНОИМЕНЕН файл и различно съдържание — точно случаят, който се чупеше.
  fs.mkdirSync(path.join(storageDir, 'A'), { recursive: true });
  fs.mkdirSync(path.join(storageDir, 'B'), { recursive: true });
  fs.writeFileSync(path.join(storageDir, 'A', 'dokument.pdf'), 'съдържание-А');
  fs.writeFileSync(path.join(storageDir, 'B', 'dokument.pdf'), 'съдържание-Б');
  fs.writeFileSync(path.join(storageDir, 'A', 'other.txt'), 'друг');

  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), PUBLIC_GATEWAY_PORT: '0', ADMIN_TOKEN: token },
    cwd: os.tmpdir(),
    stdio: 'ignore',
  });
  const base = 'http://127.0.0.1:' + port;
  const call = async (p, method = 'GET', payload, auth = true) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(auth ? { Authorization: 'Bearer ' + token } : {}), ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const type = res.headers.get('content-type') || '';
    const value = type.includes('application/json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, value };
  };

  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await call('/health', 'GET', undefined, false)).status === 200) { ready = true; break } } catch { /* още стартира */ }
      await new Promise((r) => setTimeout(r, 40));
    }
    assert(ready, 'сървърът не стартира');

    const portal = (await call('/admin/api/portals', 'POST', { slug: 'refs', title: 'Папки', storage_root: storageRoot })).value;
    const portalId = portal.id;

    // ── 1. Регистрация: пътят се пази, едноименните файлове са различни документи ──────
    const regA = await call(`/admin/api/portals/${portalId}/tree/register`, 'POST', { path: '/A/dokument.pdf' });
    assert.equal(regA.status, 201, JSON.stringify(regA.value));
    assert.equal(regA.value.storagePath, '/A/dokument.pdf', 'регистрираният файл пази пътя си');
    assert.equal(regA.value.name, 'dokument.pdf');
    assert.equal(regA.value.sha256, sha256('съдържание-А'), 'отпечатъкът е на файла от А');

    const regB = await call(`/admin/api/portals/${portalId}/tree/register`, 'POST', { path: '/B/dokument.pdf' });
    assert.equal(regB.status, 201, 'едноименен файл от ДРУГА папка е нов документ: ' + JSON.stringify(regB.value));
    assert.equal(regB.value.storagePath, '/B/dokument.pdf');
    assert.notEqual(regB.value.id, regA.value.id, 'двамата имат различни id');
    assert.equal(regB.value.sha256, sha256('съдържание-Б'), 'отпечатъкът е на файла от Б');

    const dup = await call(`/admin/api/portals/${portalId}/tree/register`, 'POST', { path: '/A/dokument.pdf' });
    assert.equal(dup.status, 409, 'същият път не се регистрира два пъти');

    const stored = (await call(`/admin/api/portals/${portalId}`)).value;
    assert.deepEqual(stored.files.map((f) => f.storagePath).sort(), ['/A/dokument.pdf', '/B/dokument.pdf'], 'порталът помни и двата пътя');

    const regOther = await call(`/admin/api/portals/${portalId}/tree/register`, 'POST', { path: '/A/other.txt' });
    assert.equal(regOther.status, 201);
    const files = (await call(`/admin/api/portals/${portalId}`)).value.files;

    // ── 2. Дървото: всяка папка показва СВОИТЕ файлове ────────────────────────────────
    await call(`/admin/api/portals/${portalId}`, 'PATCH', { visibility: 'public' });
    const folderB = await call(`/api/v1/p/refs/tree?path=/B`, 'GET', undefined, false);
    assert.equal(folderB.status, 200, JSON.stringify(folderB.value));
    assert.deepEqual(folderB.value.files.map((f) => f.path), ['/B/dokument.pdf'], 'Б съдържа само своя файл');

    // ── 3. Свързването в панела: по ПЪТ, не по име ────────────────────────────────────
    const treeB = [{ name: 'dokument.pdf', path: 'B/dokument.pdf', size: 12, modifiedAt: '2026-10-22T10:00:00Z' }];
    const bound = fm.bindFolderFiles(treeB, files);
    assert.equal(bound.entries.length, 1);
    assert.equal(bound.entries[0].id, regB.value.id, 'панелът показва файла от Б, не едноименния от А');
    assert.equal(bound.entries[0].storagePath, '/B/dokument.pdf');
    assert.equal(bound.entries[0].storage, undefined, 'това е регистриран файл, не „само на диска“');

    // Стар запис без `storagePath` (преди 0.69.20) се свързва по име — за обратна съвместимост.
    const legacy = [{ id: 'legacy1', name: 'dokument.pdf', size: 5 }];
    const legacyBound = fm.bindFolderFiles([{ name: 'dokument.pdf', path: 'A/dokument.pdf', size: 5 }], legacy);
    assert.equal(legacyBound.entries[0].id, 'legacy1', 'запис без път се разпознава по име');

    // Файл на диска без регистрация излиза като „хранилище“, а не като карта на портала.
    const unregistered = fm.bindFolderFiles([{ name: 'nov.pdf', path: 'A/nov.pdf', size: 3 }], files);
    assert.equal(unregistered.entries[0].id, '');
    assert.equal(unregistered.entries[0].storage, true);

    // Регистриран файл от Б не бива да „изчезва“ и не бива да се показва в А.
    const treeA = [{ name: 'dokument.pdf', path: 'A/dokument.pdf', size: 12 }, { name: 'other.txt', path: 'A/other.txt', size: 4 }];
    const boundA = fm.bindFolderFiles(treeA, files);
    assert.deepEqual(boundA.entries.map((e) => e.id).sort(), [regA.value.id, regOther.value.id].sort(), 'А показва своите два файла');

    // ── 4. Пакетът на папка съдържа само нейните файлове ──────────────────────────────
    const pkg = await call('/admin/api/packages', 'POST', { portalId, storagePath: '/B' });
    assert.equal(pkg.status, 201, JSON.stringify(pkg.value));
    assert.equal(pkg.value.storageFiles, 1, 'в пакета на Б влиза точно един файл');
    const zip = Buffer.from((await call(`/admin/api/packages/${pkg.value.id}/download`)).value);
    assert.ok(zip.includes('storage/B/dokument.pdf'), 'пътят в пакета е пълният');
    assert.equal(zip.includes('storage/A/'), false, 'файловете на А не влизат в пакета на Б');

    console.log(
      'PASS portal-folder-refs: storagePath пази се · едноименни файлове в А и Б са различни документи · ' +
      'същият път е 409 · панелът свързва по път (по име само за стари записи) · пакетът на папка е само нейният'
    );
  } finally {
    await stopChild(child).catch(() => { });
    try { fs.rmSync(storageDir, { recursive: true, force: true }); } catch { /* Windows може да държи файла още */ }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* същото */ }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
