'use strict';
// ДЕБЪГИНГ: автоматично разпознаване на обектите и прилагане на законите върху ЖИВИЯ DOM.
//
// Защо този тест е различен от `files-manager.cjs` и `ui-spacing.cjs`: те гледат изходния
// код („има ли `var(--sp-3)` в този блок“). Тук се проверява самият инструмент за дебъгинг:
//   • разпознава ли обектите по договора (карта, контрола, поле, табелка, контейнер);
//   • прилага ли ВСЕКИ закон и връща ли причина, когато законът е нарушен;
//   • мълчи ли напълно, когато дебъгингът е изключен (иначе инструментът тежи на панела).
//
// Тестът пада, ако инструментът „познава“ обект, без да приложи закон; ако пропусне
// нарочно поставено нарушение; или ако тръгне без разрешение.
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');
const { stopChild } = require('./helpers.cjs');

const PANEL_MODULES = [
  'data.js', 'icons.js', 'debug-objects.js', 'report-studio.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'files-manager.js', 'directory-panel.js',
  'dashboard-panel.js', 'settings-panel.js', 'export-center.js', 'public-gateway.js',
  'visitors-panel.js', 'secret-share.js', 'report-sign.js',
];

(async () => {
  const server = await startServer({ keepData: true });
  try {
    // ── 1. Инструментът МЪЛЧИ, когато дебъгингът е изключен ───────────────────
    const off = mountUi(server, { modules: PANEL_MODULES });
    assert.ok(off.window.HapiDebugObjects, 'модулът се зарежда в панела');
    assert.equal(off.window.HapiDebugObjects.isDebug(), false, 'без флаг дебъгингът е изключен');
    assert.equal(off.window.HapiDebugObjects.enable(), null, 'без флаг enable() не прави нищо');
    assert.equal(off.toasts.length, 0, 'инструментът не пише на екрана без флаг');

    // ── 2. Живият панел: обектите се разпознават по договора ─────────────────
    const ui = mountUi(server, { modules: PANEL_MODULES });
    // Дебъгингът се включва ТУК, преди монтирането — както го прави човек с `?debug=1`.
    ui.window.HAPI_DEBUG = true;
    assert.equal(ui.window.HapiDebugObjects.isDebug(), true, 'флагът включва дебъгинга');

    const portal = await server.api('/admin/api/portals', 'POST', { slug: 'debug-objects', title: 'Портал за дебъгинг', visibility: 'public' });
    assert.equal(portal.status, 201, 'порталът е създаден: ' + JSON.stringify(portal.data));
    const uploaded = await server.authFetch(server.base + `/admin/api/portals/${portal.data.id}/files`, {
      method: 'POST',
      headers: { 'X-File-Name': 'obekt-za-debug.txt' },
      body: 'съдържание за дебъгинга',
    });
    assert.ok((await uploaded.json()).id, 'файлът е качен');

    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portal.data.id;
    ui.window.FilesManagerPanel.state.panel = 'actions';
    ui.window.FilesManagerPanel.mount(host);
    await expandPortalBlocks(host);
    await waitFor(() => host.querySelector('[data-file-gear]'), { label: 'файлът в списъка' });

    const live = ui.window.HapiDebugObjects.scan(host);
    assert.ok(live.objects.length >= 5, 'разпознати са поне 5 обекта: ' + live.objects.length);
    const kinds = Object.keys(live.summary.byKind);
    for (const kind of ['card', 'checkbox', 'control']) {
      assert.ok(kinds.includes(kind), 'разпознат е обект „' + kind + '“: ' + kinds.join(', '));
    }
    // Всеки разпознат обект носи самоличност и измерени отстояния — иначе отчетът е гол.
    for (const object of live.objects) {
      assert.ok(object.kind && object.id, 'обектът има вид и самоличност: ' + JSON.stringify({ kind: object.kind, id: object.id }));
      assert.equal(typeof object.spacing, 'object', 'за обекта са снети отстоянията');
      assert.ok(ui.window.HapiDebugObjects.LAWS.some((law) => law.kinds.includes(object.kind)), 'за вида „' + object.kind + '“ има поне един закон');
    }
    // Отчетът е валиден дори когато няма нарушения — и не се представя за „проверено“, ако
    // законът не е могъл да се измери (без размери/стилове в тестов DOM).
    assert.equal(typeof live.violations.length, 'number', 'нарушенията са списък');
    for (const violation of live.violations) {
      assert.ok(violation.law && violation.title && violation.kind && violation.object && violation.detail, 'нарушението е описано: ' + JSON.stringify(violation));
    }

    // ── 3. Всеки закон ХВАЩА нарочно нарушение ───────────────────────────────
    const planted = ui.document.createElement('div');
    planted.innerHTML = `
      <section class="panel" id="planted-panel">
        <article class="fm-file" id="planted-card">
          <button type="button" id="planted-silent"></button>
          <input type="checkbox" id="planted-check" aria-label="Избор" />
          <div class="field" id="planted-field"></div>
        </article>
      </section>`;
    // Оформление „на място“ (законът no-inline-layout) + нечетни отстояния (spacing-grid) +
    // асиметрия ляво/дясно (symmetry). Задава се през `style`, както го прави скрипт.
    const card = planted.querySelector('#planted-card');
    card.style.paddingTop = '3px';
    card.style.paddingRight = '8px';
    card.style.paddingBottom = '4px';
    card.style.paddingLeft = '4px';
    const found = ui.window.HapiDebugObjects.scan(planted);
    const laws = found.violations.map((v) => v.law);
    for (const law of ['spacing-grid', 'symmetry', 'no-inline-layout', 'named']) {
      assert.ok(laws.includes(law), 'законът „' + law + '“ хваща нарушението: ' + (laws.join(', ') || 'нищо'));
    }
    const spacingViolation = found.violations.find((v) => v.law === 'spacing-grid');
    assert.match(spacingViolation.detail, /3px/, 'нарушението носи СТОЙНОСТТА, не общо оплакване: ' + spacingViolation.detail);
    const symmetryViolation = found.violations.find((v) => v.law === 'symmetry');
    assert.match(symmetryViolation.detail, /ляво/, 'асиметрията е описана с посоки: ' + symmetryViolation.detail);
    const namedViolation = found.violations.find((v) => v.law === 'named');
    assert.equal(namedViolation.object, '#planted-silent', 'посочен е ТОЧНО безименният бутон: ' + namedViolation.object);

    // ── 4. Отчетът се чете и от човек (конзола), без да чупи панела ──────────
    const said = [];
    const originalLog = ui.window.console.log;
    ui.window.console.log = (line) => said.push(String(line));
    try {
      ui.window.HapiDebugObjects.report(found);
    } finally {
      ui.window.console.log = originalLog;
    }
    assert.ok(said.length >= 2, 'отчетът има заглавен ред и подробности: ' + said.length);
    assert.match(said[0], /HapiDebugObjects: \d+ обекта · \d+ нарушения/, 'заглавният ред казва брой обекти и нарушения: ' + said[0]);
    assert.ok(said.some((line) => /закон spacing-grid/.test(line)), 'отчетът групира по закон: ' + said.slice(0, 4).join(' | '));

    console.log(
      'PASS gui-debug-objects: ' + live.objects.length + ' обекта в живия панел (' + kinds.sort().join(', ') + ') · ' +
      ui.window.HapiDebugObjects.LAWS.length + ' закона · ' + laws.length + ' хванати нарушения на нарочно поставените · ' +
      'без флаг инструментът мълчи',
    );
  } finally {
    await stopChild(server.child);
    await server.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
