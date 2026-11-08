'use strict';
// ТЕСТЕРЪТ НА ТЕСТЕРА (0.69.149).
//
// Поводът: човекът видя в конзолата на своя Home Assistant
//   Connecting to 'https://pasev.asuscomm.com/api/v1/p/newportal2c' violates "connect-src 'self'"
// а всичките ми GUI тестове бяха зелени — защото вървят в DOM без браузър, тоест БЕЗ политика.
// Тест, който не налага политиката, не може да хване нарушение на политиката.
//
// Тук се проверяват ТРИ неща, в този ред:
//   1. политиката, която харнесът налага, съвпада с ИСТИНСКАТА заглавка на add-on-а
//      (`/ui/index.html` → `connect-src 'self'`) — тоест тестерът не измисля правила;
//   2. тестерът ХВАЩА нарушение: нарочна заявка към чужд произход се отказва и се записва
//      (ако това не работи, тестът е декорация);
//   3. панелът минава под политиката: менюто на API-то показва ПУБЛИЧНИЯ адрес, а заявката
//      отива на произхода на панела — нула нарушения.
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');
const { connectSrcOf, isSameOrigin, createCspGuard } = require('./lib/csp.cjs');
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
    // ── 1. Политиката е ИСТИНСКАТА, не измислена ────────────────────────────────
    const page = await fetch(server.base + '/ui/index.html');
    assert.equal(page.status, 200, 'панелът се сервира');
    const header = page.headers.get('content-security-policy') || '';
    assert.ok(header, 'панелът има Content-Security-Policy');
    const connectSrc = connectSrcOf(header);
    assert.deepEqual(connectSrc, ["'self'"], 'connect-src е точно \'self\': ' + JSON.stringify(connectSrc));
    // Харнесът налага същата стойност по подразбиране.
    assert.deepEqual(createCspGuard({ origin: server.base }).allowed, ["'self'"], 'тестерът налага същата политика');

    // ── 2. Тестерът ХВАЩА нарушение (контрола на самия тестер) ──────────────────
    assert.equal(isSameOrigin(server.base + '/admin/api/portals', server.base), true, 'същият произход е разрешен');
    assert.equal(isSameOrigin('/admin/api/portals', server.base), true, 'относителният адрес е разрешен');
    assert.equal(isSameOrigin(PUBLIC_BASE + '/api/v1/p/x', server.base), false, 'чужд произход е нарушение');
    const control = createCspGuard({ origin: server.base });
    const blocked = control.wrapFetch(() => Promise.resolve('ok'));
    await assert.rejects(
      () => blocked(PUBLIC_BASE + '/api/v1/p/x'),
      (e) => e.csp === true && /connect-src 'self'/.test(e.message),
      'нарочната заявка към чужд произход се отказва като в браузър',
    );
    assert.equal(control.violations.length, 1, 'нарушението се записва');
    assert.equal(control.violations[0].url, PUBLIC_BASE + '/api/v1/p/x', 'записано е точният адрес');

    // ── 3. Панелът минава под политиката ───────────────────────────────────────
    const made = await server.api('/admin/api/portals', 'POST', {
      slug: 'csp-guard', title: 'Портал зад домейн', visibility: 'public',
    });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const folder = await server.api(`/admin/api/portals/${made.data.id}/tree/folder`, 'POST', { parent: '', name: 'документи-' + Date.now().toString(36) });
    assert.equal(folder.status, 201, 'папката за менюто се създава: ' + JSON.stringify(folder.data));
    const ui = mountUi(server, { modules: PANEL_MODULES }); // csp: true по подразбиране
    ui.window.isSecureContext = true;
    ui.window.FilesManagerPanel.state.publicBaseUrl = PUBLIC_BASE;
    const host = ui.container();
    ui.window.FilesManagerPanel.mount(host);
    // 0.69.199: адресът вече не се показва като табелка/поле — носи го QR кодът (връзка в
    // главата на картата), който трябва да е строен върху ПУБЛИЧНИЯ адрес (не върху Ingress).
    const openCard = await waitFor(() => host.querySelector('[data-open-portal]'), { label: 'картата на портала' });
    openCard.click();
    const qrBtn = await waitFor(() => host.querySelector('[data-qr-portal]'), { label: 'QR бутонът на портала' });
    qrBtn.click();
    const qrLink = await waitFor(() => host.querySelector('.pf-qr-pop-link'), { label: 'връзката върху QR кода' });
    const qrUrl = String(qrLink.getAttribute('href') || '');
    assert.ok(qrUrl.startsWith(PUBLIC_BASE), 'QR кодът носи публичния адрес: ' + qrUrl);
    // Менюто на ПАПКАТА показва същия публичен адрес, а заявката отива на произхода на
    // панела — точно това пази `sameOrigin()`.
    await expandPortalBlocks(host);
    await waitFor(() => host.querySelector('[data-folder-gear]'), { label: 'папката в дървото' });
    const folderToggle = await waitFor(() => host.querySelector('[data-folder]'), { label: 'папката за отваряне' });
    folderToggle.click();
    const openItem = await waitFor(() => host.querySelector('[data-api-open]'), { label: 'менюто на папката' });
    assert.ok(openItem.dataset.apiOpen.startsWith(PUBLIC_BASE), 'менюто показва публичния адрес');

    openItem.click();
    const shown = await waitFor(
      () => {
        const modal = ui.window.document.getElementById('fm-modal');
        return modal && modal.textContent.includes('документи') ? modal.textContent : null;
      },
      { label: 'съдържанието в прозореца' },
    );
    assert.ok(shown.length > 0, 'прозорецът показва api.json');
    assert.deepEqual(ui.cspViolations(), [], 'НУЛА нарушения на connect-src: ' + JSON.stringify(ui.cspViolations()));

    // ── 4. И следващите действия на панела остават под политиката ────────────────
    // Всяка заявка, която панелът направи оттук нататък, пак минава през тестера; ако
    // някъде се появи адрес от чужд произход, `ui.cspViolations()` веднага ще го покаже.
    assert.equal(typeof ui.rawFetch, 'function', 'контролният fetch е наличен за тестовете');
    assert.deepEqual(ui.cspViolations(), [], 'и след отварянето няма нарушения');

    console.log(
      'PASS gui-csp-guard: политиката е истинската (' + connectSrc.join(' ') + ') · тестерът хваща нарочно ' +
      'нарушение (' + control.violations[0].url.replace(/^https?:\/\/[^/]+/, '') + ') · панелът минава с 0 нарушения',
    );
  } finally {
    await stopChild(server.child);
    await server.stop();
  }
})().catch((e) => { console.error('FAIL gui-csp-guard:', e && e.message ? e.message : e); process.exit(1); });
