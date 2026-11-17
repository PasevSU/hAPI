'use strict';
// СКРИТИЯТ ФАЙЛ СЕ ВИЖДА В ПАНЕЛА (0.69.209).
//
// Защо има тест: флагът `listed` съществуваше само като чекбокс „обяви“ с подсказка при
// посочване. Човек, който е качил файл и не го вижда на страницата, към която води QR кодът,
// нямаше как да разбере защо — състоянието се четеше само от отметката. Сега редът носи
// табелка „скрит“ с обяснение, а текстът минава през речника (`portal.files.hidden*`, BG/EN/DE).
//
// Тестът пада, ако:
//   • скритият файл няма табелка в картата си (или я има при видимия файл);
//   • табелката не изчезне, след като файлът бъде обявен от чекбокса;
//   • сървърът вече НЕ крие скрития файл от публичния списък (тогава табелката лъже).
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');

const PANEL_MODULES = [
  'data.js', 'icons.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'files-manager.js', 'directory-panel.js',
  'dashboard-panel.js', 'settings-panel.js', 'export-center.js', 'public-gateway.js',
  'visitors-panel.js', 'secret-share.js', 'report-sign.js',
];

(async () => {
  const server = await startServer({ keepData: true });
  try {
    const portal = await server.api('/admin/api/portals', 'POST', { slug: 'hidden-flag', title: 'Скрит файл', visibility: 'public' });
    assert.equal(portal.status, 201, 'порталът се създава: ' + JSON.stringify(portal.data));
    const portalId = portal.data.id;

    const upload = async (name) => {
      const res = await server.authFetch(server.base + `/admin/api/portals/${portalId}/files`, {
        method: 'POST',
        headers: { 'X-File-Name': name },
        body: 'съдържание на ' + name,
      });
      const body = await res.json();
      assert.ok(body.id, 'файлът е качен: ' + name);
      return body.id;
    };
    await upload('viden.txt');
    const hiddenId = await upload('skrit.txt');

    // Скриваме единия файл през СЪЩИЯ маршрут, който ползва чекбоксът „обяви“.
    const patched = await server.api(`/admin/api/portals/${portalId}/files/${hiddenId}/metadata`, 'PATCH', { listed: false });
    assert.equal(patched.status, 200, 'флагът се сменя: ' + JSON.stringify(patched.data));

    // Серверната истина: скритият файл НЕ е в публичния списък.
    const pub = await (await fetch(server.base + '/api/v1/p/hidden-flag/files')).json();
    const names = (pub.files || []).map((f) => f.name);
    assert.equal(names.includes('skrit.txt'), false, 'скритият файл не се обявява публично: ' + names.join(','));
    assert.equal(names.includes('viden.txt'), true, 'видимият файл остава в списъка: ' + names.join(','));

    const ui = mountUi(server, { modules: PANEL_MODULES });
    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portalId;
    ui.window.FilesManagerPanel.mount(host);
    await expandPortalBlocks(host, { block: 'files' });

    const rowFor = (name) => {
      const rows = [...host.querySelectorAll('article.fm-file')];
      return rows.find((r) => (r.textContent || '').includes(name)) || null;
    };
    await waitFor(() => rowFor('skrit.txt') && rowFor('viden.txt'), { label: 'двата файла в списъка' });

    const hiddenRow = rowFor('skrit.txt');
    const visibleRow = rowFor('viden.txt');
    const chips = (row) => [...row.querySelectorAll('.state-chip')].map((el) => el.textContent.trim());
    assert.deepEqual(chips(hiddenRow), ['Скрит'], 'скритият файл носи ТОЧНО ЕДНА табелка: ' + chips(hiddenRow).join(' | '));
    const title = [...hiddenRow.querySelectorAll('.state-chip')].map((el) => el.getAttribute('title') || '').join(' ');
    assert.match(title, /НЕ се вижда/, 'табелката обяснява ЗАЩО: ' + title);
    assert.deepEqual(chips(visibleRow), [], 'видимият файл не носи табелка: ' + chips(visibleRow).join(' | '));

    // Обявяване от чекбокса: табелката трябва да изчезне, а файлът — да влезе в публичния списък.
    const box = hiddenRow.querySelector('[data-file-listed]');
    assert.ok(box, 'редът има чекбокс „обяви“');
    box.click();
    await waitFor(() => chips(rowFor('skrit.txt')).length === 0, { label: 'табелката изчезва след обявяване' });
    const pub2 = await (await fetch(server.base + '/api/v1/p/hidden-flag/files')).json();
    assert.equal((pub2.files || []).map((f) => f.name).includes('skrit.txt'), true, 'след обявяването файлът е в публичния списък');

    console.log('PASS portal-hidden-flag: скритият файл носи ЕДНА маркировка · подсказката обяснява защо · табелката следва флага · сървърът го крие');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error('FAIL portal-hidden-flag:', e && e.message);
  process.exit(1);
});
