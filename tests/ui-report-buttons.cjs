'use strict';
// ОТЧЕТ С ЕДНО НАТИСКАНЕ ОТ ТРИТЕ МЕСТА (ADR-0028, стъпка 5).
//
// Защо има тест: обхватът се определя от МЯСТОТО на бутона, а не от формуляр. Ако местата
// пращат грешен обхват, отчетът пак е валиден PDF и никой не разбира, че описва друго.
// Затова тук се проверява през интерфейса, че всеки от трите бутона дава линк, а линкът се
// отваря без токен:
//   1. обектът функции (`#pf-report-portal`) → отчет за ПОРТАЛА;
//   2. редът на папката (`[data-report-folder]`) → отчет за ПАПКАТА;
//   3. редът на регистриран файл (`[data-report-file]`) → отчет за ФАЙЛА (по `fileId`);
//   4. линкът се показва с „копирай“ и се копира без ръчно маркиране.
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');

const MODULES = [
  'data.js', 'icons.js', 'portals.js', 'portal-control.js', 'portal-folders.js', 'portal-files.js',
  'selection.js', 'portal-tree.js', 'files-manager.js', 'directory-panel.js', 'dashboard-panel.js',
  'settings-panel.js', 'export-center.js', 'public-gateway.js', 'visitors-panel.js',
];

(async () => {
  const server = await startServer({ keepData: true });
  try {
    const made = await server.api('/admin/api/portals', 'POST', { slug: 'report-buttons', title: 'Портал с отчети', visibility: 'public' });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const portal = made.data;
    // Папка с файл (за отчета за папка) и регистриран файл (за отчета за файл).
    const folder = await server.api(`/admin/api/portals/${portal.id}/tree/folder`, 'POST', { parent: '', name: 'договори' });
    assert.equal(folder.status, 201, JSON.stringify(folder.data));
    const inFolder = await fetch(server.base + `/admin/api/portals/${portal.id}/tree/upload?path=${encodeURIComponent('договори/анекс.txt')}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + server.token, 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('анекс', 'utf8'),
    });
    assert.equal(inFolder.status, 201, 'файлът в папката: ' + (await inFolder.text()).slice(0, 120));
    const upload = await fetch(server.base + `/admin/api/portals/${portal.id}/files`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + server.token, 'X-File-Name': encodeURIComponent('фактура.txt'), 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('фактура', 'utf8'),
    });
    const file = await upload.json();
    assert.equal(upload.status, 201, 'регистрираният файл: ' + JSON.stringify(file).slice(0, 120));

    const ui = mountUi(server, { modules: MODULES });
    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portal.id;
    ui.window.FilesManagerPanel.mount(host);
    const open = await waitFor(() => host.querySelector('[data-pf-control-tog]'), { label: 'картата на портала' });
    assert.ok(open, 'порталът се отваря');

    // ── 1. Обектът функции: отчет за ПОРТАЛА ────────────────────────────────
    await expandPortalBlocks(host, { block: 'control' });
    const btn = await waitFor(() => host.querySelector('#pf-report-portal'), { label: 'бутона за отчет на портала' });
    btn.click();
    const firstLink = await waitFor(() => {
      const out = ui.window.document.getElementById('pf-report-out');
      const anchor = out ? out.querySelector('a') : null;
      return anchor && String(anchor.getAttribute('href') || '').startsWith('/statik/') ? anchor : null;
    }, { label: 'линка към отчета за портала' });
    const url = firstLink.getAttribute('href');
    assert.match(url, /^\/statik\/[A-Za-z0-9_-]{32}\/report-portal-report-buttons-.+\.pdf$/, 'отчетът е за ПОРТАЛА: ' + url);
    const pdf = await fetch(server.base + url);
    assert.equal(pdf.status, 200, 'линкът се отваря без токен');
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString('latin1'), '%PDF-');

    // „Копирай“ слага СЪЩИЯ адрес в клипборда (иначе линкът се маркира на ръка).
    const copy = ui.window.document.querySelector('[data-report-copy]');
    assert.ok(copy, 'до линка има бутон „копирай“');
    copy.click();
    await waitFor(() => (ui.copied.some((t) => t === url) ? true : null), { label: 'копирания линк' });
    assert.ok(ui.copied.includes(url), 'копираният текст е адресът на отчета');

    // ── 2. Редът на папката: отчет за ПАПКАТА ───────────────────────────────
    await expandPortalBlocks(host, { block: 'folders' });
    const folderBtn = await waitFor(() => host.querySelector('[data-report-folder]'), { label: 'бутона за отчет на папката' });
    folderBtn.click();
    const folderLink = await waitFor(() => {
      const out = ui.window.document.getElementById('pf-report-out');
      const anchor = out ? out.querySelector('a') : null;
      const href = anchor ? String(anchor.getAttribute('href') || '') : '';
      return href.startsWith('/statik/') && href !== url ? anchor : null;
    }, { label: 'линка към отчета за папката' });
    assert.match(folderLink.getAttribute('href'), /report-folder-/, 'отчетът е за ПАПКАТА: ' + folderLink.getAttribute('href'));

    // ── 3. Редът на файла: отчет за ФАЙЛА (по fileId) ───────────────────────
    await expandPortalBlocks(host, { block: 'files' });
    const fileBtn = await waitFor(() => host.querySelector('[data-report-file]'), { label: 'бутона за отчет на файла' });
    fileBtn.click();
    const fileLink = await waitFor(() => {
      const out = ui.window.document.getElementById('pf-report-out');
      const anchor = out ? out.querySelector('a') : null;
      const href = anchor ? String(anchor.getAttribute('href') || '') : '';
      return href.includes('report-selection') ? anchor : null;
    }, { label: 'линка към отчета за файла' });
    const fileUrl = fileLink.getAttribute('href');
    const filePdf = await fetch(server.base + fileUrl);
    assert.equal(filePdf.status, 200, 'отчетът за файла се отваря');
    assert.equal(Buffer.from(await filePdf.arrayBuffer()).subarray(0, 5).toString('latin1'), '%PDF-');

    console.log('PASS ui-report-buttons: портал · папка · файл от мястото на бутона · линк + копиране · PDF без токен');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
