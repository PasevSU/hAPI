'use strict';
// ПАНЕЛЪТ „СПОДЕЛИ“ НА ФАЙЛ — адресът се зарежда, не се издава наново и изтеглянето работи.
//
// Докладван дефект: „не се зарежда първоначалният и винаги иска нов, а изтеглянето не работи“.
// Причината беше в самия панел:
//   • адресът се издаваше като СТРАНИЧЕН ЕФЕКТ на рисуването, а модалът не се опресняваше —
//     полето оставаше „издава се…“ и човек натискаше „Нов ключ“;
//   • кешът пазеше само адреса, без край на валидността, и всяко отваряне издаваше нов;
//   • бутонът „Изтегли“ в ъгъла на прозореца чака прегледано съдържание, което панелът няма —
//     тоест за този панел той не правеше нищо.
//
// Тестът пада, ако:
//   • при отваряне на „Сподели“ в полето няма подписан адрес (или той не се отваря);
//   • при повторно отваряне адресът е друг (издава се нов вместо да се ползва същият);
//   • „Нов адрес“ не издава нов;
//   • „Изтегли файла“ не пуска заявка за изтегляне;
//   • панелът показва ключ за FREE файл или казва „X-Portal-Key“ вместо „X-File-Key“.
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');
const { stopChild } = require('./helpers.cjs');

const PANEL_MODULES = [
  'data.js', 'icons.js', 'report-studio.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'files-manager.js', 'directory-panel.js',
  'dashboard-panel.js', 'settings-panel.js', 'export-center.js', 'public-gateway.js',
  'visitors-panel.js', 'secret-share.js', 'report-sign.js',
];

const CONTENT = 'podpisan-adees-ot-panela';

(async () => {
  const server = await startServer({ keepData: true });
  try {
    // ── Портал и FREE файл през API-то (както при качване от панела) ────────
    const portal = await server.api('/admin/api/portals', 'POST', { slug: 'share-pane', title: 'Панел Сподели', visibility: 'public' });
    assert.equal(portal.status, 201, 'порталът е създаден: ' + JSON.stringify(portal.data));
    const portalId = portal.data.id;
    const uploaded = await server.authFetch(server.base + `/admin/api/portals/${portalId}/files`, {
      method: 'POST',
      headers: { 'X-File-Name': 'dogovor.txt' },
      body: CONTENT,
    });
    const file = await uploaded.json();
    assert.ok(file.id, 'файлът е качен: ' + JSON.stringify(file));

    // ── Панелът: отваря се порталът и се чака списъкът с файлове ────────────
    const ui = mountUi(server, { modules: PANEL_MODULES });
    const host = ui.container();
    // Броим заявките: колко пъти панелът ИСКА нов подписан адрес и кога тегли файла.
    const calls = [];
    const inner = ui.sandbox.fetch;
    ui.sandbox.fetch = (url, init) => {
      const href = typeof url === 'string' ? url : String((url && url.url) || '');
      calls.push(href);
      return inner(url, init);
    };
    ui.window.FilesManagerPanel.state.openPortal = portalId;
    ui.window.FilesManagerPanel.mount(host);
    // Блоковете (контролен панел, папки, файлове) са сгънати по подразбиране — разгъват се
    // със същите заглавия, които човек натиска, преди да стигне до файла.
    await expandPortalBlocks(host);
    await waitFor(() => host.querySelector('[data-file-gear]'), { label: 'файлът в списъка' });

    /** Отваря „Сподели“ от менюто ⚙ на файла — същият път като с мишка. */
    const openShare = async () => {
      host.querySelector('[data-file-gear]').click();
      const item = await waitFor(() => host.querySelector('[data-file-act="share"]'), { label: 'действието „Сподели“' });
      item.click();
      const modal = await waitFor(
        () => {
          const m = ui.document.getElementById('fm-modal');
          return m && !m.hidden && /Подписан адрес за изтегляне/.test(m.textContent || '') ? m : null;
        },
        { label: 'панелът „Сподели“' },
      );
      const signedUrl = () =>
        [...modal.querySelectorAll('input')].map((el) => String(el.value || '')).find((v) => /\/download\?expires=\d+&sig=[0-9a-f]+/.test(v)) || '';
      await waitFor(signedUrl, { label: 'подписаният адрес в полето' });
      return { modal, signedUrl };
    };

    // ── 1. Първоначалният адрес СЕ ЗАРЕЖДА и се отваря без вход ────────────
    const first = await openShare();
    const address = first.signedUrl();
    const opened = await fetch(address);
    assert.equal(opened.status, 200, 'първоначалният адрес се отваря без токен: ' + address + ' → ' + opened.status);
    assert.equal(await opened.text(), CONTENT, 'по адреса идва СЪДЪРЖАНИЕТО на файла');
    assert.ok(first.modal.querySelector('#fm-share-download'), 'има бутон „Изтегли файла“');
    assert.equal(first.modal.querySelector('#fm-create-key'), null, 'за FREE файл не се предлага ключ');
    assert.equal(/X-Portal-Key/.test(first.modal.textContent), false, 'не подвежда с X-Portal-Key');
    assert.equal(/издава се…/.test(first.modal.textContent), false, 'полето не остава на „издава се…“');
    const issuedOnce = calls.filter((c) => /\/signed-url$/.test(c)).length;
    assert.equal(issuedOnce, 1, 'адресът се издава точно веднъж, а не при всяко рисуване: ' + issuedOnce);

    // ── 2. Повторно отваряне ползва СЪЩИЯ адрес, а не иска нов ─────────────
    first.modal.querySelector('#fm-modal-close').click();
    const second = await openShare();
    assert.equal(second.signedUrl(), address, 'второто отваряне показва същия адрес');
    assert.equal(
      calls.filter((c) => /\/signed-url$/.test(c)).length,
      1,
      'повторното отваряне не издава нов адрес',
    );

    // ── 3. „Нов адрес“ издава друг и той също се отваря ────────────────────
    // Подписът е HMAC върху (портал, файл, expires) — в СЪЩАТА секунда със същия TTL излиза
    // същият адрес. Затова се изчаква секундната граница, преди да се иска нов.
    const waitSecond = () => new Promise((r) => setTimeout(r, 1100));
    await waitSecond();
    second.modal.querySelector('#fm-new-link').click();
    const renewed = await waitFor(
      () => {
        const now = second.signedUrl();
        return now && now !== address ? now : null;
      },
      { label: 'новият подписан адрес' },
    );
    assert.equal(calls.filter((c) => /\/signed-url$/.test(c)).length, 2, '„Нов адрес“ издава точно един нов адрес');
    const reopened = await fetch(renewed);
    assert.equal(reopened.status, 200, 'новият адрес се отваря: ' + reopened.status);
    await reopened.arrayBuffer();

    // ── 4. „Изтегли файла“ РЕАЛНО тегли (администраторският път) ───────────
    const before = calls.filter((c) => /\/download$/.test(c)).length;
    ui.clearToasts();
    second.modal.querySelector('#fm-share-download').click();
    await waitFor(() => (ui.lastToast() && ui.lastToast().kind === 'ok') || null, { label: 'съобщението за изтегляне' });
    assert.match(ui.lastToast().message, /Изтеглянето започна/, 'изтеглянето започва: ' + ui.lastToast().message);
    const after = calls.filter((c) => /\/download$/.test(c)).length;
    assert.equal(after, before + 1, 'натискането пуска точно една заявка за изтегляне');

    // ── 5. „Изтегли“ в заглавната лента на ПАНЕЛ тегли същия файл ────────
    // Докладвано: бутонът се вижда в панела („Действия · файл.pdf“), но не прави нищо —
    // в панел няма прегледано съдържание (`modalBlob`) и `onclick` беше `null`.
    second.modal.querySelector('#fm-modal-close').click();
    host.querySelector('[data-file-gear]').click();
    const accessItem = await waitFor(() => host.querySelector('[data-file-act="access"]'), { label: 'действието „Достъп“' });
    accessItem.click();
    const panel = await waitFor(
      () => {
        const m = ui.document.getElementById('fm-modal');
        return m && !m.hidden && /Достъп/.test(m.textContent || '') ? m : null;
      },
      { label: 'панелът „Достъп“' },
    );
    const headerDownload = await waitFor(
      () => {
        const b = panel.querySelector('#fm-modal-dl');
        return b && b.getAttribute('hidden') === null ? b : null;
      },
      { label: 'бутонът „Изтегли“ в заглавната лента' },
    );
    const beforeHeader = calls.filter((c) => /\/download$/.test(c)).length;
    ui.clearToasts();
    headerDownload.click();
    await waitFor(() => (ui.lastToast() && ui.lastToast().kind === 'ok') || null, { label: 'съобщението от заглавния бутон' });
    assert.match(ui.lastToast().message, /Изтеглянето започна/, 'заглавният бутон тегли: ' + ui.lastToast().message);
    assert.equal(
      calls.filter((c) => /\/download$/.test(c)).length,
      beforeHeader + 1,
      'заглавният бутон пуска точно една заявка за изтегляне',
    );

    console.log('PASS gui-file-share: адресът се зарежда при отваряне · ползва се повторно · „Нов адрес“ издава друг · „Изтегли файла“ тегли · „Изтегли“ в заглавната лента на панел тегли');
  } finally {
    await stopChild(server.child);
    await server.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
