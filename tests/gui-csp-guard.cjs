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
const { startServer, mountUi, waitFor } = require('./lib/gui-harness.cjs');
const { connectSrcOf, isSameOrigin, createCspGuard, KEYSERVER_ORIGIN } = require('./lib/csp.cjs');
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
    // Политиката е затворен списък: `'self'` плюс изрично изброените произходи. Всяко
    // разширяване минава през този тест, тоест не може да се промъкне незабелязано.
    assert.equal(connectSrc[0], "'self'", "connect-src започва със 'self': " + JSON.stringify(connectSrc));
    assert.deepEqual(
      connectSrc.slice(1),
      [KEYSERVER_ORIGIN],
      'единственото изключение извън произхода е ключарницата: ' + JSON.stringify(connectSrc),
    );
    // Харнесът налага същата стойност по подразбиране.
    assert.deepEqual(createCspGuard({ origin: server.base }).allowed, connectSrc, 'тестерът налага същата политика');

    // ── 2. Тестерът ХВАЩА нарушение (контрола на самия тестер) ──────────────────
    assert.equal(isSameOrigin(server.base + '/admin/api/portals', server.base), true, 'същият произход е разрешен');
    assert.equal(isSameOrigin('/admin/api/portals', server.base), true, 'относителният адрес е разрешен');
    assert.equal(isSameOrigin(PUBLIC_BASE + '/api/v1/p/x', server.base), false, 'чужд произход е нарушение');
    const control = createCspGuard({ origin: server.base });
    const blocked = control.wrapFetch(() => Promise.resolve('ok'));
    await assert.rejects(
      () => blocked(PUBLIC_BASE + '/api/v1/p/x'),
      (e) => e.csp === true && /connect-src/.test(e.message),
      'нарочната заявка към чужд произход се отказва като в браузър',
    );
    assert.equal(control.violations.length, 1, 'нарушението се записва');
    assert.equal(control.violations[0].url, PUBLIC_BASE + '/api/v1/p/x', 'записано е точният адрес');

    // ── 3. Панелът минава под политиката ───────────────────────────────────────
    const made = await server.api('/admin/api/portals', 'POST', {
      slug: 'csp-guard', title: 'Портал зад домейн', visibility: 'public',
    });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const ui = mountUi(server, { modules: PANEL_MODULES }); // csp: true по подразбиране
    ui.window.isSecureContext = true;
    ui.window.FilesManagerPanel.state.publicBaseUrl = PUBLIC_BASE;
    const host = ui.container();
    ui.window.FilesManagerPanel.mount(host);
    const openItem = await waitFor(() => host.querySelector('[data-api-open]'), { label: 'менюто на API-то' });
    assert.ok(openItem.dataset.apiOpen.startsWith(PUBLIC_BASE), 'менюто показва публичния адрес');

    openItem.click();
    const shown = await waitFor(
      () => {
        const modal = ui.window.document.getElementById('fm-modal');
        return modal && modal.textContent.includes('csp-guard') ? modal.textContent : null;
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
