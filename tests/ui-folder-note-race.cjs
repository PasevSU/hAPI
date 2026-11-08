'use strict';
// ЗАПАЗЕНА БЕЛЕЖКА НА ПАПКА НЕ БИВА ДА ИЗЧЕЗВА ОТ ДЪРВОТО (0.69.207).
//
// Намерено при повторния критичен анализ, не от доклад: `J53` в `gui-journeys` падаше
// периодично (2 от 5 пускания) с „изтече времето за бележката в дървото на папките“, макар
// `POST …/tree/comment` да е минал с 200. Причината е състезание:
//
//   1. панелът иска дървото (`GET …/tree`) и чака отговор;
//   2. докато чака, човекът запазва бележка — `POST …/tree/comment` връща НОВИТЕ коментари и
//      панелът ги рисува;
//   3. старият отговор на `GET …/tree` пристига ПО-КЪСНО и презаписва коментарите със
//      състоянието ПРЕДИ записа.
//
// Тогава бележката е запазена на сървъра, но изчезва от екрана до следващо обновяване —
// точно поведението, за което е DEF-18 („съобщава успех, а списъкът е стар“).
//
// Тестът прави състезанието детерминистично: задържа отговора на `GET …/tree` с 1.2 s,
// запазва бележка ПРЕЗ интерфейса, изчаква стария отговор да пристигне и проверява, че
// бележката е още на екрана.
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');

const PANEL_MODULES = [
  'data.js', 'icons.js', 'report-studio.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'files-manager.js', 'directory-panel.js',
  'dashboard-panel.js', 'settings-panel.js', 'export-center.js', 'public-gateway.js',
  'visitors-panel.js', 'secret-share.js', 'report-sign.js',
];

const NOTE = 'Бележка при състезание';

(async () => {
  const server = await startServer({ keepData: true });
  try {
    const created = await server.api('/admin/api/portals', 'POST', {
      slug: 'note-race',
      title: 'Портал за състезанието',
      visibility: 'public',
    });
    assert.equal(created.status, 201, 'порталът е създаден: ' + JSON.stringify(created.data));
    const portalId = created.data.id;
    // Поне един файл, за да има дървото ред на папка (празен портал не рисува ⚙).
    const uploaded = await server.authFetch(server.base + `/admin/api/portals/${portalId}/files`, {
      method: 'POST',
      headers: { 'X-File-Name': 'belezhka.txt' },
      body: 'sadarzhanie',
    });
    assert.equal(uploaded.status, 201, 'файлът е качен: ' + uploaded.status);
    // И една истинска папка на диска — без ред в дървото няма меню „⚙“ за бележката.
    // Името е уникално за пускането: хранилището живее между пусканията.
    const folderName = 'Dokazatelstva-' + String(Date.now()).slice(-6);
    const folder = await server.api(`/admin/api/portals/${portalId}/tree/folder`, 'POST', { parent: '', name: folderName });
    assert.equal(folder.status, 201, 'папката е създадена: ' + JSON.stringify(folder.data));

    const ui = mountUi(server, { modules: PANEL_MODULES });
    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portalId;
    ui.window.FilesManagerPanel.mount(host);
    await expandPortalBlocks(host, { block: 'folders' });
    await waitFor(() => host.querySelector('[data-folder-gear]'), { label: 'редовете на дървото' });

    // ── Състезанието: отговорът на четенето на дървото се задържа ──────────
    const inner = ui.sandbox.fetch;
    let held = 0;
    ui.sandbox.fetch = async (url, init = {}) => {
      const href = typeof url === 'string' ? url : String((url && url.url) || '');
      const method = String((init && init.method) || 'GET').toUpperCase();
      const isTreeRead = method === 'GET' && /\/tree(\?|$)/.test(href);
      const res = await inner(url, init);
      if (isTreeRead && held < 1) {
        held += 1;
        // Отговорът е готов, но пристига при панела ЕДВА след записа на бележката.
        await new Promise((r) => setTimeout(r, 1200));
      }
      return res;
    };

    // Стартираме бавното четене („Прочети папката наново“) …
    const refresh = host.querySelector('#fm-tree-refresh');
    assert.ok(refresh, 'има бутон за повторно четене на дървото');
    refresh.click();
    await waitFor(() => held === 1, { label: 'задържаното четене на дървото' });

    // … и ВЕДНАГА запазваме бележка през менюто ⚙ на корена.
    const gear = host.querySelector('[data-folder-gear]');
    assert.ok(gear, 'има меню ⚙ на папка');
    gear.click();
    const openNote = await waitFor(() => host.querySelector('[data-folder-comment-open]'), { label: '„Бележка“ в менюто' });
    const rel = openNote.getAttribute('data-folder-comment-open');
    openNote.click();
    const box = await waitFor(() => host.querySelector('[data-folder-comment="' + rel + '"]'), { label: 'полето за бележка' });
    box.value = NOTE;
    box.dispatch('input');
    const save = await waitFor(() => host.querySelector('[data-folder-comment-save="' + rel + '"]'), { label: 'бутонът „Запази“' });
    save.click();

    // Бележката се вижда веднага след записа …
    await waitFor(() => new RegExp(NOTE).test(host.textContent || ''), { label: 'бележката веднага след записа', timeout: 8000 });

    // … и трябва да е ТАМ и след като старият отговор на четенето пристигне.
    await new Promise((r) => setTimeout(r, 2000));
    assert.match(
      String(host.textContent || ''),
      new RegExp(NOTE),
      'старият отговор на GET …/tree не бива да трие току-що запазена бележка (състезание „последен печели“)',
    );

    // И сървърът наистина я има — тестът не „пази“ само екрана.
    const tree = await server.api(`/admin/api/portals/${portalId}/tree`, 'GET');
    const notes = (tree.data && tree.data.folderNotes) || {};
    assert.ok(
      Object.values(notes).some((n) => n && n.text === NOTE),
      'бележката е записана на сървъра: ' + JSON.stringify(notes),
    );

    console.log('PASS ui-folder-note-race: старият отговор на дървото не трие запазена бележка');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
