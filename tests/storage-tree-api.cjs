'use strict';
// Папките на портала: дърво през административното API, собствен API (api.json + QR)
// за всяка папка и защита срещу публикуване на целия /share.
const { stopChild } = require('./helpers.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-tree-api-'));
  const port = 21300 + Math.floor(Math.random() * 3000);
  const token = 'storage-tree-test-token-24-chars';
  // storage_root винаги е под /share — в теста това е <root>/share/<уникална>.
  const shareBase = path.join(path.parse(os.tmpdir()).root, 'share');
  const storageDir = path.join(shareBase, `hapi-tree-${process.pid}-${Math.random().toString(16).slice(2, 8)}`);
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: token },
    // Работната папка е на системния диск, за да сочи "/share" към <root>/share.
    cwd: os.tmpdir(),
    stdio: 'ignore',
  });
  const json = { 'Content-Type': 'application/json' };
  const call = async (p, method = 'GET', data, auth = true, headers = {}) => {
    const r = await fetch('http://127.0.0.1:' + port + p, {
      method,
      headers: { ...(auth ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      body: data,
    });
    const type = r.headers.get('content-type') || '';
    const value = type.includes('application/json') ? await r.json() : await r.arrayBuffer();
    return { status: r.status, value, headers: r.headers };
  };
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try {
        if ((await call('/health')).status === 200) { ready = true; break; }
      } catch {}
      await new Promise((r) => setTimeout(r, 30));
    }
    assert(ready, 'сървърът трябва да стартира');

    // 1. Папка с подпапки на диска (скрит файл не бива да влиза в дървото).
    fs.mkdirSync(path.join(storageDir, 'sub', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(storageDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(storageDir, 'readme.txt'), 'hello');
    fs.writeFileSync(path.join(storageDir, 'docs', 'a.pdf'), 'PDF-A');
    fs.writeFileSync(path.join(storageDir, 'sub', 'notes.md'), '# notes');
    fs.writeFileSync(path.join(storageDir, 'sub', 'deep', 'data.csv'), 'a,b\n1,2');
    fs.writeFileSync(path.join(storageDir, '.hidden'), 'скрит');
    const storageRoot = '/share/' + path.basename(storageDir);

    const portal = (await call('/admin/api/portals', 'POST', JSON.stringify({ slug: 'tree', title: 'Дърво', storage_root: storageRoot }), true, json)).value;
    const tree = await call(`/admin/api/portals/${portal.id}/tree`);
    assert.equal(tree.status, 200, JSON.stringify(tree.value));
    assert.equal(tree.value.storageRoot, storageRoot);
    assert.equal(tree.value.exists, true);
    assert.equal(tree.value.folderCount, 3, 'docs + sub + sub/deep');
    assert.equal(tree.value.fileCount, 4);
    assert.equal(tree.value.truncated, false);
    assert.deepEqual(tree.value.tree.folders.map((f) => f.name), ['docs', 'sub']);
    const sub = tree.value.tree.folders[1];
    assert.equal(sub.path, 'sub');
    assert.equal(sub.folderCount, 1);
    assert.equal(sub.fileCount, 2);
    assert.deepEqual(sub.folders[0].files.map((f) => f.name), ['data.csv']);
    assert.deepEqual(tree.value.tree.files.map((f) => f.name), ['readme.txt']);
    assert.equal(tree.value.tree.files.some((f) => f.name === '.hidden'), false, 'скритите файлове се пропускат');
    assert.equal(tree.value.tree.folders[0].files[0].path, 'docs/a.pdf', 'пътят е относителен');

    // 2. api.json за папка (административен канал) — собствен адрес на папката.
    const folder = await call(`/admin/api/portals/${portal.id}/tree/api.json?path=/sub`);
    assert.equal(folder.status, 200, JSON.stringify(folder.value));
    assert.equal(folder.value.kind, 'storage-folder');
    assert.equal(folder.value.folder.path, '/sub');
    assert.equal(folder.value.folder.folderCount, 1);
    assert.equal(folder.value.folder.fileCount, 2);
    assert.match(folder.value.apiUrl, /\/admin\/api\/portals\/[^/]+\/tree\?path=%2Fsub$/);
    assert.equal(folder.value.folders.length, 1);
    assert.match(folder.value.folders[0].apiUrl, /path=%2Fsub%2Fdeep$/);
    assert.deepEqual(folder.value.files.map((f) => f.path), ['/sub/notes.md']);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/api.json?path=/nope`)).status, 404);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/api.json?path=/../etc`)).status, 400);

    // 3. Публичен API на папките (порталът е публичен) — същите данни, без дискови път.
    assert.equal((await call(`/admin/api/portals/${portal.id}`, 'PATCH', JSON.stringify({ visibility: 'public' }), true, json)).status, 200);
    const pub = await call('/api/v1/p/tree/tree?path=/sub', 'GET', undefined, false);
    assert.equal(pub.status, 200, JSON.stringify(pub.value));
    assert.equal(pub.value.folder.path, '/sub');
    assert.equal(pub.value.folder.name, 'sub');
    assert.deepEqual(pub.value.files.map((f) => f.path), ['/sub/notes.md']);
    assert.match(pub.value.apiUrl, /\/api\/v1\/p\/tree\/tree\?path=%2Fsub$/);
    assert.equal(pub.value.storageRoot, undefined, 'дисковият път не се показва публично');

    const pubApi = await call('/api/v1/p/tree/tree/api.json?path=/', 'GET', undefined, false);
    assert.equal(pubApi.status, 200);
    assert.equal(pubApi.value.kind, 'storage-folder');
    assert.ok(pubApi.value.folders.some((f) => f.apiUrl.includes('path=%2Fsub')), 'всяка папка носи собствен адрес');
    assert.equal((await call('/api/v1/p/tree/tree/qr.svg?path=/sub', 'GET', undefined, false)).status, 200);

    // 4. Защита: коренът /share не се публикува като API на папка.
    const rootPortal = (await call('/admin/api/portals', 'POST', JSON.stringify({ slug: 'root', title: 'Целият /share', storage_root: '/share' }), true, json)).value;
    await call(`/admin/api/portals/${rootPortal.id}`, 'PATCH', JSON.stringify({ visibility: 'public' }), true, json);
    assert.equal((await call('/api/v1/p/root/tree', 'GET', undefined, false)).status, 403);
    assert.equal((await call('/api/v1/p/root/tree/api.json', 'GET', undefined, false)).status, 403);
    // …но административно дървото работи и за /share (това е кабинетът).
    const rootTree = await call(`/admin/api/portals/${rootPortal.id}/tree`);
    assert.equal(rootTree.status, 200);

    // 5. Права: без токен административното дърво е недостъпно.
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree`, 'GET', undefined, false)).status, 401);

    // 6. Нова папка: създава се на диска и се вижда веднага (и когато е празна).
    const made = await call(`/admin/api/portals/${portal.id}/tree/folder`, 'POST', JSON.stringify({ parent: 'docs', name: 'Нова папка' }), true, json);
    assert.equal(made.status, 201, JSON.stringify(made.value));
    assert.equal(made.value.path, '/docs/Нова папка');
    assert.equal(made.value.parent, '/docs');
    assert.equal(fs.existsSync(path.join(storageDir, 'docs', 'Нова папка')), true, 'папката е създадена на диска');
    const withEmpty = await call(`/admin/api/portals/${portal.id}/tree`);
    assert.equal(withEmpty.value.folderCount, 4, 'празната папка също се брои');
    const docsNode = withEmpty.value.tree.folders.find((f) => f.name === 'docs');
    assert.ok(docsNode.folders.some((f) => f.name === 'Нова папка'), 'празната папка е в дървото');
    assert.equal(docsNode.folders.find((f) => f.name === 'Нова папка').fileCount, 0);

    // Невалидни имена и дубликати се отказват; изход извън папката на портала — също.
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/folder`, 'POST', JSON.stringify({ parent: '', name: '..' }), true, json)).status, 400);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/folder`, 'POST', JSON.stringify({ parent: '', name: 'a/b' }), true, json)).status, 400);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/folder`, 'POST', JSON.stringify({ parent: 'docs', name: 'Нова папка' }), true, json)).status, 409);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/folder`, 'POST', JSON.stringify({ parent: 'nope', name: 'x' }), true, json)).status, 404);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/folder`, 'POST', JSON.stringify({ parent: '', name: 'x' }), false, json)).status, 401);

    // 7. Коментар към папка: пази се към портала и идва с дървото; празен го изтрива.
    const note = await call(`/admin/api/portals/${portal.id}/tree/comment`, 'POST', JSON.stringify({ path: 'docs', comment: 'Доказателства по делото' }), true, json);
    assert.equal(note.status, 200, JSON.stringify(note.value));
    assert.equal(note.value.notes['/docs'].text, 'Доказателства по делото');
    assert.ok(note.value.notes['/docs'].at, 'има време на записа');
    const treeWithNote = await call(`/admin/api/portals/${portal.id}/tree`);
    assert.equal(treeWithNote.value.folderNotes['/docs'].text, 'Доказателства по делото');
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/comment`, 'POST', JSON.stringify({ path: '/../etc', comment: 'x' }), true, json)).status, 400);
    const cleared = await call(`/admin/api/portals/${portal.id}/tree/comment`, 'POST', JSON.stringify({ path: 'docs', comment: '' }), true, json);
    assert.deepEqual(cleared.value.notes, {});

    // 8. Прикачване на файл в папката на портала (тялото е съдържанието, пътят е ?path=).
    const up = await call(`/admin/api/portals/${portal.id}/tree/upload?path=${encodeURIComponent('/docs/new/file.txt')}`, 'POST', 'съдържание', true, { 'Content-Type': 'text/plain' });
    assert.equal(up.status, 201, JSON.stringify(up.value));
    assert.equal(up.value.path, '/docs/new/file.txt');
    assert.equal(up.value.size, Buffer.byteLength('съдържание'));
    assert.equal(fs.readFileSync(path.join(storageDir, 'docs', 'new', 'file.txt'), 'utf8'), 'съдържание', 'файлът е записан на диска');
    // Повторно качване без overwrite → 409; с overwrite → 201.
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/upload?path=${encodeURIComponent('/docs/new/file.txt')}`, 'POST', 'друго', true, { 'Content-Type': 'text/plain' })).status, 409);
    const over = await call(`/admin/api/portals/${portal.id}/tree/upload?path=${encodeURIComponent('/docs/new/file.txt')}&overwrite=1`, 'POST', 'ново', true, { 'Content-Type': 'text/plain' });
    assert.equal(over.status, 201);
    assert.equal(over.value.overwritten, true);
    // Невалидни пътища, скрити имена и изход от дървото.
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/upload?path=${encodeURIComponent('/../evil.txt')}`, 'POST', 'x', true, { 'Content-Type': 'text/plain' })).status, 400);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/upload?path=`, 'POST', 'x', true, { 'Content-Type': 'text/plain' })).status, 400);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/upload?path=${encodeURIComponent('/.hidden.txt')}`, 'POST', 'x', true, { 'Content-Type': 'text/plain' })).status, 400);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/upload?path=${encodeURIComponent('/docs/empty.txt')}`, 'POST', '', true, { 'Content-Type': 'text/plain' })).status, 400);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/upload?path=${encodeURIComponent('/docs/x.txt')}`, 'POST', 'x', false, { 'Content-Type': 'text/plain' })).status, 401);

    // 9. Флагове на папка: видима / медийна / заключване (PATCH, пазят се към портала).
    const flag = await call(`/admin/api/portals/${portal.id}/tree/folder`, 'PATCH', JSON.stringify({ path: '/docs', media: true, locked: true }), true, json);
    assert.equal(flag.status, 200, JSON.stringify(flag.value));
    assert.deepEqual(flag.value, { path: '/docs', visible: true, media: true, locked: true });
    const withFlags = await call(`/admin/api/portals/${portal.id}/tree`);
    assert.deepEqual(withFlags.value.folderMeta['/docs'], { visible: true, media: true, locked: true });
    assert.equal(withFlags.value.folderMeta['/sub'], undefined, 'по подразбиране няма запис');
    // Заключената папка не приема качване (и нейните подпапки също).
    const lockedUp = await call(`/admin/api/portals/${portal.id}/tree/upload?path=${encodeURIComponent('/docs/new/x.txt')}`, 'POST', 'x', true, { 'Content-Type': 'text/plain' });
    assert.equal(lockedUp.status, 409);
    assert.match(lockedUp.value.error, /заключена/);
    // Връщане към подразбирането изтрива записа.
    const reset = await call(`/admin/api/portals/${portal.id}/tree/folder`, 'PATCH', JSON.stringify({ path: '/docs', media: false, locked: false, visible: true }), true, json);
    assert.deepEqual(reset.value, { path: '/docs', visible: true, media: false, locked: false });
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree`)).value.folderMeta['/docs'], undefined);
    // Невалидни стойности.
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/folder`, 'PATCH', JSON.stringify({ path: '/docs', visible: 'да' }), true, json)).status, 400);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/folder`, 'PATCH', JSON.stringify({ path: '/../etc', visible: false }), true, json)).status, 400);

    // 10. Пакет само на една папка (storagePath) и ясна грешка за празна/липсваща.
    const folderPkg = await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id, storagePath: '/sub' }), true, json);
    assert.equal(folderPkg.status, 201, JSON.stringify(folderPkg.value));
    assert.equal(folderPkg.value.files, 2, 'notes.md + deep/data.csv');
    assert.equal(folderPkg.value.storageFiles, 2);
    const zipFolder = Buffer.from((await call(`/admin/api/packages/${folderPkg.value.id}/download`)).value);
    assert.ok(zipFolder.includes('storage/sub/deep/data.csv'), 'пътят в пакета остава пълен');
    assert.equal(zipFolder.includes('storage/readme.txt'), false, 'файловете извън папката не влизат');
    const emptyPkg = await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id, storagePath: '/nope' }), true, json);
    assert.equal(emptyPkg.status, 404);
    assert.match(emptyPkg.value.error, /празна или липсва/);
    assert.equal((await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id, storagePath: '/../etc' }), true, json)).status, 400);

    // 11. Регистриране на файл от диска: получава id, SHA-256, размер и влиза в портала.
    fs.writeFileSync(path.join(storageDir, 'docs', 'register-me.txt'), 'за регистриране');
    const reg = await call(`/admin/api/portals/${portal.id}/tree/register`, 'POST', JSON.stringify({ path: '/docs/register-me.txt' }), true, json);
    assert.equal(reg.status, 201, JSON.stringify(reg.value));
    assert.equal(reg.value.name, 'register-me.txt');
    assert.equal(reg.value.size, Buffer.byteLength('за регистриране'));
    assert.equal(reg.value.sha256, require('node:crypto').createHash('sha256').update('за регистриране').digest('hex'));
    assert.match(reg.value.id, /^[a-z0-9]+$/, 'файлът има id в портала');
    assert.equal(reg.value.version, 1, 'новорегистрираният файл е версия 1');
    const withReg = await call(`/admin/api/portals/${portal.id}`);
    assert.ok(withReg.value.files.some((f) => f.id === reg.value.id), 'файлът е в портала');
    // Повторно регистриране на същото име → 409; липсващ файл → 404; изход от дървото → 400.
    fs.writeFileSync(path.join(storageDir, 'docs', 'register-me.txt'), 'пак');
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/register`, 'POST', JSON.stringify({ path: '/docs/register-me.txt' }), true, json)).status, 409);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/register`, 'POST', JSON.stringify({ path: '/docs/missing.txt' }), true, json)).status, 404);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/register`, 'POST', JSON.stringify({ path: '/../etc/passwd' }), true, json)).status, 400);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/register`, 'POST', JSON.stringify({ path: '/docs' }), true, json)).status, 400);
    assert.equal((await call(`/admin/api/portals/${portal.id}/tree/register`, 'POST', JSON.stringify({ path: '/docs/register-me.txt' }), false, json)).status, 401);

    console.log('storage-tree-api OK');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
