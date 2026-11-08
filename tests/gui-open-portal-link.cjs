'use strict';
// ЛИНКЪТ КЪМ ПОРТАЛА — ИЗГРАДЕН ОТ ГУИ-ТО И ПРОВЕРЕН, ЧЕ НАИСТИНА ОТВАРЯ ПОРТАЛА.
//
// Изискването: човек не бива да сглобява адреси на ръка. Панелът дава входа с бутона за QR
// код в главата на картата (горе вдясно); самият код е връзка (`<a href>`), тук се взема
// нейният адрес и той се отваря през HTTP.
//
// Тестът пада, ако:
//   • в картата няма бутон за QR код (или панелчето не се отваря);
//   • кодът не е връзка или адресът не е на портала;
//   • адресът не отваря портал (не 200, не HTML, не съдържа портала);
//   • адресът води към техническа страница (JSON) вместо към портала.
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

    const qrBtn = await waitFor(() => host.querySelector('[data-qr-portal]'), { label: 'QR бутонът в главата на картата' });
    qrBtn.click();
    const qrLink = await waitFor(() => host.querySelector('.pf-qr-pop-link'), { label: 'връзката върху QR кода' });

    // ── 2. Адресът идва от ГУИ-ТО — от самата връзка върху QR кода ────────────
    const link = String(qrLink.getAttribute('href') || '').trim();
    assert.ok(link, 'QR кодът е връзка с адрес');
    assert.match(link, /\/p\/[0-9a-f]{16,}/, 'адресът е на портала: ' + link);
    assert.equal(/:8099|:18099/.test(link), false, 'адресът не носи служебен порт: ' + link);

    // ── 3. Адресът РЕАЛНО отваря портала ────────────────────────────────────
    const opened = await fetch(link);
    const html = await opened.text();
    assert.equal(opened.status, 200, 'адресът от панела се отваря: ' + link + ' → ' + opened.status);
    assert.match(opened.headers.get('content-type') || '', /text\/html/, 'връща HTML страница, не JSON');
    assert.ok(html.includes('/portal.js'), 'това е истинската страница на портала (зарежда portal.js)');
    assert.ok(html.includes('Портал от панела') || html.includes('link-from-gui'), 'страницата е за ТОЗИ портал');

    // ── 4. Панелът вече НЕ предлага „Отвори папката“/„Отвори портала“ — входът е ЕДИН ──
    // Дотук тук стояха два отделни бутона към портала и папката, които водеха до различни
    // адреси. Сега входът е само връзката върху QR кода, за да няма два пътя към едно място.
    for (const id of ['pf-open-folder', 'pf-open-portal', 'pf-portal-qr']) {
      assert.equal(host.querySelector('#' + id), null, `в картата няма #${id}`);
    }

    console.log(
      'PASS gui-open-portal-link: QR кодът е връзка с ' + link.replace(/^https?:\/\/[^/]+/, '') +
      ' · адресът отваря портала (200 · HTML · portal.js) · входът е един',
    );
  } finally {
    await stopChild(server.child);
    await server.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
