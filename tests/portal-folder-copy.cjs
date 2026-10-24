'use strict';
// Прикачване на файл към портал НЕ бива да създава папка, която човекът не е поискал.
//
// Правилото (0.69.74): файлът се пази в данните на add-on-а; КОПИЕ в папката на портала
// (`storage_root`, напр. /share/<slug>`) се слага само при `portal_folder_copy: true`.
// Файловете в /share се качват през „Папки на портала“ — там, където човекът ги иска.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const { stopChild } = require('./helpers.cjs');

const attach = async (server, portalId, name, text) => {
  const res = await server.authFetch(`${server.base}/admin/api/portals/${portalId}/files`, {
    method: 'POST',
    headers: { 'x-file-name': name, 'content-type': 'text/plain' },
    body: text,
  });
  assert.equal(res.status, 201, 'файлът е прикачен: ' + res.status);
  return res.json();
};

const treeOf = async (server, portalId) => {
  const res = await server.authFetch(`${server.base}/admin/api/portals/${portalId}/tree`);
  assert.equal(res.status, 200, 'дървото отговаря');
  return res.json();
};

// Пътят, който сървърът би създал за `/share/<slug>` на тази платформа.
const shareDir = (slug) => path.resolve('/share', slug);

(async () => {
  // ── 1. По подразбиране: без копие и без създадена папка ─────────────────────
  const first = await startServer();
  const slugA = 'attach-no-folder-' + Math.random().toString(16).slice(2, 8);
  try {
    const portal = await first.api('/admin/api/portals', 'POST', { slug: slugA, title: 'Без папка', visibility: 'private' });
    assert.equal(portal.status, 201, 'порталът е създаден');
    const created = await treeOf(first, portal.data.id);
    assert.equal(created.exists, false, 'създаването на портал НЕ създава папка в хранилището');
    await attach(first, portal.data.id, 'dogovor.txt', 'съдържание');
    const afterAttach = await treeOf(first, portal.data.id);
    assert.equal(afterAttach.exists, false, 'прикачването НЕ създава папка');
    assert.equal(fs.existsSync(shareDir(slugA)), false, 'на диска няма папка ' + shareDir(slugA));
    // Файлът съществува в портала — махането на копието не маха самия файл.
    const files = await first.api(`/admin/api/portals/${portal.data.id}/files`);
    assert.equal(files.data.files.length, 1, 'файлът е в портала');
    const dl = await first.authFetch(`${first.base}/admin/api/portals/${portal.data.id}/files/${files.data.files[0].id}/download`);
    assert.equal(dl.status, 200, 'файлът се сваля от данните на add-on-а');
    assert.equal(await dl.text(), 'съдържание');
  } finally {
    await stopChild(first.child);
    await first.stop();
  }

  // ── 2. С `portal_folder_copy: true`: копие в папката, както преди ────────────
  const second = await startServer({ env: { PORTAL_FOLDER_COPY: '1' } });
  const slugB = 'attach-with-folder-' + Math.random().toString(16).slice(2, 8);
  try {
    const portal = await second.api('/admin/api/portals', 'POST', { slug: slugB, title: 'С папка', visibility: 'private' });
    assert.equal(portal.status, 201);
    await attach(second, portal.data.id, 'dokazatelstvo.txt', 'байтове');
    const tree = await treeOf(second, portal.data.id);
    assert.equal(tree.exists, true, 'с включена опция папката се създава');
    assert.equal(tree.fileCount, 1, 'копието се вижда в папката');
    const view = tree.tree && Array.isArray(tree.tree.files) ? tree.tree.files[0] : null;
    assert.ok(view && view.name === 'dokazatelstvo.txt', 'копието носи истинското име на файла');
  } finally {
    await stopChild(second.child);
    await second.stop();
    // Тестът чисти след себе си, ако е писал в общия /share.
    fs.rmSync(shareDir(slugB), { recursive: true, force: true });
  }

  console.log('portal-folder-copy OK: прикачването не създава папка · с PORTAL_FOLDER_COPY=1 копира');
})().catch((e) => { console.error(e); process.exit(1); });
