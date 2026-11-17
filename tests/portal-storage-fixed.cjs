'use strict';
// Папката с файлове на портала е ЗАДАДЕНА ОТ ADD-ON-а, не се избира в панела (0.69.210).
//
// Защо: дотук панелът имаше поле за `storage_root` с подсказка „само под /share или /media“.
// Единственото, което тази свобода даваше на нормалния потребител, беше начин да насочи
// портала към общата папка `/share` — тоест да отдаде чуждите портали — или да остави
// файловете на място, което после не намира. Затова:
//   1. нов портал получава `<корен на порталите>/<slug>` = `/share/hAPI/portals/<slug>`;
//   2. PATCH със `storage_root` се ОТКАЗВА (403), освен при изричния администраторски изход
//      `HAPI_PORTAL_STORAGE_ROOT_EDIT=1`;
//   3. панелът ПОКАЗВА пътя (read-only) и няма input за него.
//
// Тестът мери трите неща на живия сървър (плюс диска), не само присъствието на поле.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const { stopChild } = require('./helpers.cjs');
const paths = require('../hapi_enterprise/paths');

// Логическият корен и host пътят идват от `paths.js` — тестът не строи `<диск>:\share`.
const baseOf = (server) => paths.portalsRoot({ STORAGE_ROOT_OVERRIDE: server.storageRoot() });
const dirOf = (server, storageRoot) => paths.resolveStoragePath(storageRoot, '', { STORAGE_ROOT_OVERRIDE: server.storageRoot() });

(async () => {
  // ── 1. Нов портал: коренът е `/share/hAPI/portals/<slug>` ──────────────────
  const server = await startServer();
  try {
    const base = baseOf(server);
    assert.equal(base, '/share/hAPI/portals', 'коренът по подразбиране е домашната папка на add-on-а: ' + base);
    assert.equal(paths.PORTAL_STORAGE_SUBDIR, 'portals', 'подпапката е с фиксирано име');

    const slug = 'fixed-' + Math.random().toString(16).slice(2, 8);
    const created = await server.api('/admin/api/portals', 'POST', { slug, title: 'Фиксирана папка', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data).slice(0, 160));
    const portal = created.data;
    assert.equal(portal.storage_root, base + '/' + slug, 'порталът получава собствена подпапка на корена на порталите');
    const folder = dirOf(server, portal.storage_root);
    assert.ok(folder.startsWith(dirOf(server, base) + path.sep), 'папката е на диска под корена: ' + folder);

    // ── 2. Същата стойност пак → 200 (нищо не се мести, нищо не се чупи) ──────
    const same = await server.api(`/admin/api/portals/${portal.id}`, 'PATCH', { storage_root: portal.storage_root });
    assert.equal(same.status, 200, 'PATCH със СЪЩИЯ път остава позволен (идемпотентност за стари форми): ' + JSON.stringify(same.data).slice(0, 160));
    assert.equal(same.data.storage_root, portal.storage_root, 'пътят не се е променил');

    // ── 3. Друг път → 403 и записът НЕ се променя ────────────────────────────
    const moved = await server.api(`/admin/api/portals/${portal.id}`, 'PATCH', { storage_root: '/share' });
    assert.equal(moved.status, 403, 'смяната на папката се отказва: ' + JSON.stringify(moved.data).slice(0, 200));
    assert.equal(moved.data && moved.data.status, 403, 'отказът е с ясен статус в тялото');
    assert.match(String(moved.data && moved.data.detail), /HAPI_PORTAL_STORAGE_ROOT_EDIT/, 'отказът назовава изхода за администратор');
    const after = await server.api(`/admin/api/portals/${portal.id}`);
    assert.equal(after.data.storage_root, portal.storage_root, 'след отказатата смяна папката е същата');
    // Другите полета на същия PATCH минават — отказва се САМО папката.
    const titleOnly = await server.api(`/admin/api/portals/${portal.id}`, 'PATCH', { title: 'Ново заглавие' });
    assert.equal(titleOnly.status, 200, 'заглавието се сменя нормално');
    assert.equal(titleOnly.data.title, 'Ново заглавие');

    // ── 4. Панелът: пътят се вижда, но НЕ е поле за писане ───────────────────
    const ui = path.join(__dirname, '..', 'hapi_enterprise', 'ui');
    for (const file of ['portal-control.js', 'files-manager.js']) {
      const src = fs.readFileSync(path.join(ui, file), 'utf8');
      assert.match(src, /data-pf-storage-root/, `${file}: папката се показва (read-only)`);
      assert.doesNotMatch(src, /name="storage_root"/, `${file}: няма input за папката`);
    }
    const control = fs.readFileSync(path.join(ui, 'portal-control.js'), 'utf8');
    assert.doesNotMatch(control, /list="pf-roots-set"/, 'дропдаунът с готови корени е махнат от контролния панел');
    // Стилът съществува, иначе стойността изглежда като счупено поле.
    const css = fs.readFileSync(path.join(ui, 'components.css'), 'utf8');
    assert.match(css, /\.pf-fixed\s*\{/, 'има стил за стойност, която само се показва');
  } finally {
    await stopChild(server.child);
    await server.stop();
  }

  // ── 5. Изричният изход за администратор: с флаг смяната минава ─────────────
  const admin = await startServer({ env: { HAPI_PORTAL_STORAGE_ROOT_EDIT: '1' } });
  try {
    const slug = 'edit-' + Math.random().toString(16).slice(2, 8);
    const created = await admin.api('/admin/api/portals', 'POST', { slug, title: 'С флаг', visibility: 'private' });
    assert.equal(created.status, 201, 'порталът се създава');
    const portal = created.data;
    const res = await admin.api(`/admin/api/portals/${portal.id}`, 'PATCH', { storage_root: '/share/' + slug });
    assert.equal(res.status, 200, 'с HAPI_PORTAL_STORAGE_ROOT_EDIT=1 смяната минава: ' + JSON.stringify(res.data).slice(0, 160));
    assert.equal(res.data.storage_root, '/share/' + slug, 'пътят е новият');
  } finally {
    await stopChild(admin.child);
    await admin.stop();
  }

  console.log('PASS portal-storage-fixed: нов портал → /share/hAPI/portals/<slug> · PATCH на папката → 403 (с изход HAPI_PORTAL_STORAGE_ROOT_EDIT=1) · панелът я показва, но не я редактира');
})();
