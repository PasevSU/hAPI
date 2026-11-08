'use strict';
// ДОГОВОР (0.69.148): панелът НЕ тегли ПУБЛИЧНИЯ адрес от чужд произход.
//
// Човекът видя в конзолата на своя Home Assistant:
//
//   files-manager.js:2781 Connecting to 'https://pasev.asuscomm.com/api/v1/p/newportal2c'
//   violates the following Content Security Policy directive: "connect-src 'self'".
//
// Причината: `api.json` съдържа ПУБЛИЧНИЯ адрес (`https://<домейн>/api/v1/p/…`), а панелът
// се отваря на произхода на Home Assistant (или на add-on-а). `fetch` към другия произход
// се блокира от `connect-src 'self'` — тоест „Отвори“ и „Изтегли“ в менюто на API-то не
// работеха, макар адресът да е верен и да се копира правилно.
//
// Тук се проверява РЕЗУЛТАТЪТ: менюто ПОКАЗВА публичния адрес, а заявката, която панелът
// прави при натискане, отива на СЪЩИЯ път на произхода на панела.
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');
const { stopChild } = require('./helpers.cjs');

const PANEL_MODULES = [
  'data.js', 'icons.js', 'report-studio.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'files-manager.js', 'directory-panel.js',
  'dashboard-panel.js', 'settings-panel.js', 'export-center.js', 'public-gateway.js',
  'visitors-panel.js', 'secret-share.js', 'report-sign.js',
];

const PUBLIC_BASE = 'https://pasev.asuscomm.com';

(async () => {
  const server = await startServer({ keepData: true });
  try {
    const made = await server.api('/admin/api/portals', 'POST', {
      slug: 'csp-same-origin',
      title: 'Портал зад домейн',
      visibility: 'public',
    });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const folder = await server.api(`/admin/api/portals/${made.data.id}/tree/folder`, 'POST', { parent: '', name: 'документи-' + Date.now().toString(36) });
    assert.equal(folder.status, 201, 'папката за менюто се създава: ' + JSON.stringify(folder.data));

    const ui = mountUi(server, { modules: PANEL_MODULES });
    ui.window.isSecureContext = true;
    // Публичният адрес е зададен в настройките на add-on-а — точно както при човека.
    ui.window.FilesManagerPanel.state.publicBaseUrl = PUBLIC_BASE;
    const host = ui.container();
    ui.window.FilesManagerPanel.mount(host);

    const openCard = await waitFor(() => host.querySelector('[data-open-portal]'), { label: 'картата на портала' });
    openCard.click();
    const qrBtn = await waitFor(() => host.querySelector('[data-qr-portal]'), { label: 'QR бутонът на портала' });
    qrBtn.click();
    const qrLink = await waitFor(() => host.querySelector('.pf-qr-pop-link'), { label: 'връзката върху QR кода' });
    assert.ok(
      String(qrLink.getAttribute('href') || '').startsWith(PUBLIC_BASE),
      'QR кодът ПОКАЗВА публичния адрес (той се сканира и се дава на получателя)',
    );
    // Менюто на ПАПКАТА (единственото останало меню с адрес) носи същия публичен адрес.
    await expandPortalBlocks(host, { block: 'folders' });
    await waitFor(() => host.querySelector('[data-folder-gear]'), { label: 'папката в дървото' });
    const folderToggle = await waitFor(() => host.querySelector('[data-folder]'), { label: 'папката за отваряне' });
    folderToggle.click();
    const openItem = await waitFor(() => host.querySelector('[data-api-open]'), { label: 'менюто на папката' });
    const shownUrl = openItem.dataset.apiOpen;
    assert.ok(
      shownUrl.startsWith(PUBLIC_BASE),
      'менюто ПОКАЗВА публичния адрес (той се копира и се дава на получателя): ' + shownUrl,
    );

    // Всичко, което панелът поиска, се записва.
    const calls = [];
    const realFetch = ui.window.fetch;
    ui.window.fetch = (url, init) => {
      calls.push(String(url));
      return realFetch(url, init);
    };

    openItem.click();
    await waitFor(() => calls.length > 0, { label: 'заявката на панела' });

    const target = calls[0];
    assert.equal(
      target.includes(PUBLIC_BASE),
      false,
      'панелът НЕ тегли от публичния домейн (CSP connect-src \'self\' го блокира): ' + target,
    );
    // Относителен път: браузърът го праща към произхода на ДОКУМЕНТА — точно това иска
    // `connect-src 'self'`. Затова тук няма никакъв произход.
    assert.ok(
      target === '/api/v1/p/csp-same-origin/tree/api.json?path=%2F' || target.startsWith(server.base + '/api/v1/p/csp-same-origin/tree/api.json'),
      'заявката е относителна към произхода на панела: ' + target,
    );
    assert.match(target, /\/api\/v1\/p\/csp-same-origin\/tree\/api\.json/, 'и отива на СЪЩИЯ път на папката: ' + target);

    // Заявката наистина връща данните — тоест „Отвори“ показва нещо, а не грешка.
    const shown = await waitFor(
      () => {
        const modal = ui.window.document.getElementById('fm-modal');
        const text = modal ? modal.textContent : '';
        return text.includes('документи') ? text : null;
      },
      { label: 'съдържанието в изскачащия прозорец' },
    );
    assert.ok(shown.length > 0, 'прозорецът показва api.json, а не съобщение за грешка');

    console.log(
      'PASS gui-csp-same-origin: менюто показва ' + shownUrl.replace(/^https?:\/\/[^/]+/, '') +
      ' на ' + PUBLIC_BASE + ', а заявката отива на произхода на панела (' +
      target.replace(/^https?:\/\/[^/]+/, '') + ') — без нарушение на connect-src',
    );
  } finally {
    await stopChild(server.child);
    await server.stop();
  }
})().catch((e) => { console.error('FAIL gui-csp-same-origin:', e && e.message ? e.message : e); process.exit(1); });
