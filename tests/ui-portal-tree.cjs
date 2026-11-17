'use strict';
// ПАНЕЛ „ДЪРВО“ И ГЛОБАЛНОТО МАРКИРАНЕ (ADR-0028, стъпка 4).
//
// Защо има тест: маркирането е ЕДНА истина за „кое е избрано“ и от нея зависят отчетът и
// архивът. Ако панелът държи свой масив, отчетът описва други файлове, а никой не разбира.
// Затова тук се проверява през истинския интерфейс (DOM, не модула):
//   1. блокът „Дърво“ се отваря като акордеон и носи `aria-controls` САМО разгънат;
//   2. дървото показва файловете от папката на портала, а „маркирай всички“ брои в обекта;
//   3. „Отчет за избраните“ дава линк `/statik/...`, който наистина се отваря като PDF;
//   4. „ZIP на избраните“ сваля архив (и сървърът връща истински ZIP);
//   5. смяна на портала изчиства маркирането (иначе отчетът би описал чужд портал).
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');

const MODULES = [
  'data.js', 'icons.js', 'portals.js', 'portal-control.js', 'portal-folders.js', 'portal-files.js',
  'selection.js', 'portal-tree.js', 'files-manager.js', 'directory-panel.js', 'dashboard-panel.js',
  'settings-panel.js', 'export-center.js', 'public-gateway.js', 'visitors-panel.js',
];

const makePortal = async (server, slug, title) => {
  const made = await server.api('/admin/api/portals', 'POST', { slug, title, visibility: 'public' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  return made.data;
};

(async () => {
  const server = await startServer({ keepData: true });
  try {
    const portal = await makePortal(server, 'tree-panel', 'Портал с дърво');
    // Папка + два файла в дървото на портала (през същите маршрути, които ползва панелът).
    const folder = await server.api(`/admin/api/portals/${portal.id}/tree/folder`, 'POST', { parent: '', name: 'документи' });
    assert.equal(folder.status, 201, JSON.stringify(folder.data));
    for (const [rel, text] of [['протокол.txt', 'първи'], ['документи/фактура.txt', 'втори']]) {
      const up = await fetch(server.base + `/admin/api/portals/${portal.id}/tree/upload?path=${encodeURIComponent(rel)}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + server.token, 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(text, 'utf8'),
      });
      assert.equal(up.status, 201, 'файлът влиза в дървото: ' + rel + ' → ' + (await up.text()).slice(0, 120));
    }

    const ui = mountUi(server, { modules: MODULES });
    const host = ui.container();
    ui.window.FilesManagerPanel.mount(host);
    const card = await waitFor(() => host.querySelector('[data-open-portal]'), { label: 'картата на портала' });
    card.click();

    // 1. Блокът съществува и е СГЪНАТ: без тяло и без `aria-controls`.
    const toggle = await waitFor(() => host.querySelector('[data-pf-tree-tog]'), { label: 'заглавието на блока „Дърво“' });
    assert.equal(toggle.getAttribute('aria-expanded'), 'false', 'блокът е сгънат по подразбиране');
    assert.ok(!ui.window.document.getElementById('pf-tree-body'), 'сгънатият блок няма тяло в документа');
    assert.equal(toggle.getAttribute('aria-controls'), null, 'сгънатият блок не сочи тяло, което го няма');

    // Разгъване: `aria-controls` се появява ЗАЕДНО с тялото.
    await expandPortalBlocks(host, { block: 'tree' });
    const openToggle = await waitFor(() => host.querySelector('[data-pf-tree-tog]'), { label: 'разгънатият блок' });
    assert.equal(openToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(openToggle.getAttribute('aria-controls'), 'pf-tree-body', 'разгънатият блок сочи тялото си');
    assert.ok(ui.window.document.getElementById('pf-tree-body'), 'тялото е в документа');

    // 2. Дървото показва и двата файла (единият е в подпапка — пътят е името).
    const boxes = await waitFor(
      () => (host.querySelectorAll('[data-pt-file]').length === 2 ? host.querySelectorAll('[data-pt-file]') : null),
      { label: 'двата файла в дървото' },
    );
    const paths = Array.from(boxes).map((box) => box.getAttribute('data-pt-file')).sort();
    assert.deepEqual(paths, ['документи/фактура.txt', 'протокол.txt'], 'пътищата идват от диска, включително подпапката');
    assert.equal(ui.window.HapiSelection.count(), 0, 'нищо не е маркирано в началото');

    // „Маркирай всички“ → броячът и обектът се съгласяват.
    host.querySelector('[data-pt-all]').click();
    await waitFor(() => (ui.window.HapiSelection.count() === 2 ? true : null), { label: 'маркирането на всички' });
    // `Array.from` е ЗАДЪЛЖИТЕЛНО: масивът идва от `vm` контекста на панела и има ДРУГ
    // прототип — `deepStrictEqual` сравнява прототипите и би обявил еднакви списъци за различни.
    assert.deepEqual(Array.from(ui.window.HapiSelection.keys()).sort(), paths, 'обектът държи ТОЧНО показаните пътища');
    const counter = await waitFor(
      () => (/Маркирани: 2 от 2/.test(host.textContent) ? true : null),
      { label: 'брояча на маркираните' },
    );
    assert.ok(counter, 'броячът показва 2 от 2');

    // 3. Отчет за избраните → линк `/statik/`, който се отваря като PDF.
    host.querySelector('[data-pt-report]').click();
    const link = await waitFor(() => {
      const anchor = host.querySelector('#pf-tree-body a');
      return anchor && String(anchor.getAttribute('href') || '').startsWith('/statik/') ? anchor : null;
    }, { label: 'линка към отчета' });
    const url = link.getAttribute('href');
    assert.match(url, /^\/statik\/[A-Za-z0-9_-]{32}\/report-selection-selected-.+\.pdf$/, 'линкът е на избраните: ' + url);
    const pdf = await fetch(server.base + url);
    assert.equal(pdf.status, 200, 'линкът се отваря без токен');
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-', 'линкът дава PDF');
    assert.ok(bytes.length > 4000, 'PDF-ът има съдържание');

    // 4. ZIP на избраните: сървърът връща истински архив (проверява се двоичният отговор).
    const zip = await fetch(server.base + '/admin/api/v2/reports/archive', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + server.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ portal: portal.id, paths }),
    });
    assert.equal(zip.status, 200, 'ZIP-ът се строи: ' + (await zip.clone().text()).slice(0, 120));
    assert.match(zip.headers.get('content-disposition') || '', /attachment; filename="report-archive-/, 'архивът се сваля');
    const archive = Buffer.from(await zip.arrayBuffer());
    assert.equal(archive.subarray(0, 2).toString('latin1'), 'PK', 'това е ZIP');
    assert.equal(zip.headers.get('cache-control'), 'no-store', 'архивът не се кешира');

    // 5. Смяна на портала изчиства маркирането (иначе отчетът би описал чужд портал).
    const second = await makePortal(server, 'tree-panel-2', 'Втори портал');
    assert.ok(second.id, 'вторият портал съществува');
    // Назад към СПИСЪКА (панелът помни отворения портал) и ново монтиране, за да влязат
    // новите портали в списъка — вместо да се чака списък, прочетен преди създаването.
    host.querySelector('[data-close-portal]').click();
    await waitFor(() => (host.querySelectorAll('[data-open-portal]').length ? true : null), { label: 'списъка с портали' });
    ui.window.FilesManagerPanel.unmount();
    ui.window.FilesManagerPanel.mount(host);
    const card2 = await waitFor(() => {
      const cards = Array.from(host.querySelectorAll('[data-open-portal]'));
      return cards.find((el) => String(el.textContent || '').includes('Втори портал')) || null;
    }, { label: 'картата на втория портал' });
    card2.click();
    await waitFor(() => (ui.window.HapiSelection.count() === 0 ? true : null), { label: 'изчистването при смяна на портала' });
    assert.equal(ui.window.HapiSelection.count(), 0, 'маркирането не прехвърча към друг портал');

    console.log('PASS ui-portal-tree: акордеон с aria · дърво с подпапки · глобално маркиране · отчет и ZIP за избраните');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
