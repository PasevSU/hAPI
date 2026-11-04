'use strict';
// ЛИНКЪТ КЪМ ПОРТАЛА — ИЗГРАДЕН ОТ ГУИ-ТО И ПРОВЕРЕН, ЧЕ НАИСТИНА ОТВАРЯ ПОРТАЛА.
//
// Изискването: човек не бива да сглобява адреси на ръка. Панелът има бутон
// „Копирай адреса“, който слага в клипборда ЕДИНСТВЕНИЯ адрес на портала; тук се взема
// точно това, което бутонът е копирал, и то се отваря през HTTP.
//
// Тестът пада, ако:
//   • в панела няма бутон „Копирай адреса“ (или не копира нищо);
//   • копираното не е адрес на портала (`/p/<id>` или `/portal.html?...`);
//   • адресът не отваря портал (не 200, не HTML, не съдържа портала);
//   • адресът води към техническа страница (JSON) вместо към портала;
//   • бутонът „Отвори портала“ не отваря портала в панела (същият origin).
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor } = require('./lib/gui-harness.cjs');
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
    // Клипбордът се ползва само в защитен контекст; в браузъра пред портала това е винаги
    // така (HTTPS/Inpress), а в тестовата среда трябва да се заяви изрично.
    ui.window.isSecureContext = true;
    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portalId;
    ui.window.FilesManagerPanel.state.panel = 'actions';
    ui.window.FilesManagerPanel.mount(host);
    await waitFor(() => host.textContent.includes('Контролен панел на портала'), { label: 'контролният панел' });

    const copy = await waitFor(() => host.querySelector('#pf-copy-portal'), { label: 'бутонът „Копирай адреса“' });
    const open = await waitFor(() => host.querySelector('#pf-open-portal'), { label: 'бутонът „Отвори портала“' });

    // ── 2. Копираният адрес идва от ГУИ-ТО ──────────────────────────────────
    copy.click();
    await waitFor(() => ui.copied.length > 0, { label: 'копиран адрес' });
    const link = String(ui.copied[ui.copied.length - 1] || '').trim();
    assert.ok(link, 'бутонът „Копирай адреса“ копира адрес');
    assert.match(link, /\/p\/[0-9a-f]{16,}$|\/portal\.html/, 'копираният адрес е на портала: ' + link);
    assert.equal(/:8099|:18099/.test(link), false, 'адресът не носи служебен порт: ' + link);

    // ── 3. Адресът РЕАЛНО отваря портала ────────────────────────────────────
    const opened = await fetch(link);
    const html = await opened.text();
    assert.equal(opened.status, 200, 'адресът от панела се отваря: ' + link + ' → ' + opened.status);
    assert.match(opened.headers.get('content-type') || '', /text\/html/, 'връща HTML страница, не JSON');
    assert.ok(html.includes('/portal.js'), 'това е истинската страница на портала (зарежда portal.js)');
    assert.ok(html.includes('Портал от панела') || html.includes('link-from-gui'), 'страницата е за ТОЗИ портал');

    // ── 4. „Отвори портала“ отваря портала В ПАНЕЛА (същият origin) ────────
    open.click();
    await waitFor(
      () => ui.window.FilesManagerPanel.state.portalView || host.textContent.includes('← Списък с портали'),
      { label: 'порталът, отворен в панела' },
    );

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
      'PASS gui-open-portal-link: панелът копира ' + link.replace(/^https?:\/\/[^/]+/, '') +
      ' · адресът отваря портала (200 · HTML · portal.js) · „Отвори портала“ го отваря в панела' +
      ' · „Отвори папката“ води до страницата на папката (' + absolute.replace(/^https?:\/\/[^/]+/, '') + ')',
    );
  } finally {
    await stopChild(server.child);
    await server.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
