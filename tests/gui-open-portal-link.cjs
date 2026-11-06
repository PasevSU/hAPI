'use strict';
// ЛИНКЪТ КЪМ ПОРТАЛА — ИЗГРАДЕН ОТ ГУИ-ТО И ПРОВЕРЕН, ЧЕ НАИСТИНА ОТВАРЯ ПОРТАЛА.
//
// Изискването: човек не бива да сглобява адреси на ръка. Панелът дава входа с бутон
// „Отвори портала“ и с QR кода (двойно щракване); тук се взема адресът, който кодът носи,
// и той се отваря през HTTP.
//
// Тестът пада, ако:
//   • в картата няма QR код с адрес (или адресът не е на портала);
//   • адресът не отваря портал (не 200, не HTML, не съдържа портала);
//   • адресът води към техническа страница (JSON) вместо към портала;
//   • бутонът „Отвори портала“ не отваря СЪЩИЯ адрес (същият origin).
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');
const { stopChild } = require('./helpers.cjs');

const PANEL_MODULES = [
  'data.js', 'icons.js', 'report-studio.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'files-manager.js', 'directory-panel.js',
  'dashboard-panel.js', 'settings-panel.js', 'export-center.js', 'public-gateway.js',
  'visitors-panel.js', 'secret-share.js', 'report-sign.js',
];

(async () => {
  const server = await startServer({ keepData: true });
  try {
    const made = await server.api('/admin/api/portals', 'POST', {
      slug: 'link-from-gui',
      title: 'Портал от панела',
      visibility: 'public',
    });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const portalId = made.data.id;

    // ── 1. Панелът: порталът е отворен, бутоните са налице ──────────────────
    const ui = mountUi(server, { modules: PANEL_MODULES });
    // В браузъра пред портала (HTTPS/Ingress) контекстът винаги е защитен — заявява се и тук.
    ui.window.isSecureContext = true;
    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portalId;
    ui.window.FilesManagerPanel.state.panel = 'actions';
    ui.window.FilesManagerPanel.mount(host);
    await waitFor(() => host.textContent.includes('Контролен панел на портала'), { label: 'контролният панел' });
    // Блоковете са сгънати по подразбиране — разгъваме ги с истинските им заглавия.
    await expandPortalBlocks(host);

    const qrBox = await waitFor(() => host.querySelector('#pf-portal-qr'), { label: 'QR кодът на портала' });
    const open = await waitFor(() => host.querySelector('#pf-open-portal'), { label: 'бутонът „Отвори портала“' });

    // ── 2. Адресът идва от ГУИ-ТО — от самия QR код ────────────────────────
    const link = String(qrBox.getAttribute('data-portal-url') || '').trim();
    assert.ok(link, 'QR кодът носи адрес');
    assert.match(link, /\/p\/[0-9a-f]{16,}/, 'адресът е на портала: ' + link);
    assert.equal(/:8099|:18099/.test(link), false, 'адресът не носи служебен порт: ' + link);

    // ── 3. Адресът РЕАЛНО отваря портала ────────────────────────────────────
    const opened = await fetch(link);
    const html = await opened.text();
    assert.equal(opened.status, 200, 'адресът от панела се отваря: ' + link + ' → ' + opened.status);
    assert.match(opened.headers.get('content-type') || '', /text\/html/, 'връща HTML страница, не JSON');
    assert.ok(html.includes('/portal.js'), 'това е истинската страница на портала (зарежда portal.js)');
    assert.ok(html.includes('Портал от панела') || html.includes('link-from-gui'), 'страницата е за ТОЗИ портал');

    // ── 4. „Отвори портала“ отваря СЪЩИЯ адрес в СЪЩИЯ раздел ──────────────
    open.click();
    await waitFor(() => /\/p\/[0-9a-f]{16,}/.test(String(ui.window.location.href)), { label: 'адресът след „Отвори портала“' });
    assert.equal(String(ui.window.location.href), link, 'бутонът отваря адреса от кода');

    // ── 5. „Отвори папката“ — ГУИ-то води до СТРАНИЦАТА С ФАЙЛОВЕТЕ ────────────
    // Порталът е QR кодът, който води до файловете. Затова панелът има и бутон към
    // папката на портала — и адресът, който той строи, трябва наистина да се отваря.
    const folderBtn = await waitFor(() => host.querySelector('#pf-open-folder'), { label: 'бутонът „Отвори папката“' });
    assert.equal(folderBtn.dataset.openFolder, 'link-from-gui', 'бутонът носи slug-а на портала');
    folderBtn.click();
    const target = await waitFor(
      () => (/portal\.html\?folder=/.test(String(ui.window.location.href)) ? String(ui.window.location.href) : null),
      { label: 'адресът на папката от панела' },
    );
    // Панелът живее в `/ui/`, затова адресът е относителен (`../portal.html?…`).
    const absolute = server.base + '/' + target.replace(/^\.\.\//, '');
    const folderPage = await fetch(absolute);
    const folderHtml = await folderPage.text();
    assert.equal(folderPage.status, 200, 'страницата на папката се отваря: ' + absolute + ' → ' + folderPage.status);
    assert.match(folderPage.headers.get('content-type') || '', /text\/html/, 'това е страница, не JSON');
    assert.ok(folderHtml.includes('Портал от панела'), 'страницата е за ТОЗИ портал: ' + absolute);
    assert.equal(/\/admin\//.test(absolute), false, 'адресът не води до административния API');

    console.log(
      'PASS gui-open-portal-link: QR кодът носи ' + link.replace(/^https?:\/\/[^/]+/, '') +
      ' · адресът отваря портала (200 · HTML · portal.js) · „Отвори портала“ го отваря в същия раздел' +
      ' · „Отвори папката“ води до страницата на папката (' + absolute.replace(/^https?:\/\/[^/]+/, '') + ')',
    );
  } finally {
    await stopChild(server.child);
    await server.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
