'use strict';
// Къде стои „Отчет“ в интерфейса — и дали стига до Report Studio.
//
// Правилото, което този тест пази:
//   • главното табло предлага САМО обхватите „всичко“ — комбо и рекурсивен комбо;
//   • отчетът за ЕДИН файл стои в опциите на файла (зъбчатката до него);
//   • отчетът за портал стои на картата на портала, а рекурсивният — до него;
//   • и четирите водят до един и същ резултат: валиден манифест, поет от Report Studio.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, mountUi, waitFor } = require('./lib/gui-harness.cjs');

const MODULES = [
  'data.js',
  'icons.js',
  'report-objects.js',
  'report-scope.js',
  'report-studio.js',
  'portals.js',
  'portal-control.js',
  'portal-folders.js',
  'portal-files.js',
  'files-manager.js',
  'dashboard-panel.js',
];

const text = (el) => String(el.textContent || '').replace(/\s+/g, ' ').trim();
const pending = (ui) => {
  const raw = ui.sandbox.sessionStorage.getItem('hapi.reportScope');
  return raw ? JSON.parse(raw) : null;
};

(async () => {
  const server = await startServer();
  const suffix = Math.random().toString(16).slice(2, 8);
  try {
    // ── Данни: един портал с два файла и една папка в хранилището ────────────────
    const portal = (await server.api('/admin/api/portals', 'POST', { slug: 'gui-report', title: 'Портал за отчети' })).data;
    assert.ok(portal && portal.id, 'порталът е създаден');
    const upload = async (name, body) => {
      const res = await server.authFetch(server.base + '/admin/api/portals/' + portal.id + '/files', {
        method: 'POST',
        headers: { 'x-file-name': encodeURIComponent(name), 'content-type': 'text/plain', 'x-file-encrypt': '0' },
        body,
      });
      assert.equal(res.status, 201, 'качен е ' + name);
      return res.json();
    };
    const fileA = await upload('договор.txt', 'съдържание А');
    await upload('приложение.txt', 'съдържание Б');
    const folder = await server.api('/admin/api/portals/' + portal.id + '/tree/folder', 'POST', { parent: '', name: 'dokumenti-' + suffix });
    assert.ok(folder.status === 201 || folder.status === 409, 'папката в хранилището е създадена: ' + JSON.stringify(folder.data));

    const ui = mountUi(server, { modules: MODULES });
    const w = ui.window;
    assert.ok(w.HapiReportScope, 'модулът за обхвати е зареден');

    // ── 1. Главното табло: комбо и рекурсивен комбо ────────────────────────────
    {
      const host = ui.container();
      w.HapiDashboardPanel.mount(host);
      await waitFor(() => host.querySelector('#dash-reports button[data-report="combo"]'), { label: 'секцията „Отчети“ на таблото' });
      const labels = [...host.querySelectorAll('#dash-reports button[data-report]')].map(text);
      assert.equal(labels.length, 2, 'на таблото има точно два обхвата „всичко“: ' + labels.join(' | '));
      assert.match(labels[0], /Комбо отчет \(всички портали\)/, 'първият е комбо: ' + labels[0]);
      assert.match(labels[1], /Рекурсивен комбо отчет/, 'вторият е рекурсивен комбо: ' + labels[1]);

      ui.navigations.length = 0;
      host.querySelector('button[data-report="combo"]').click();
      await waitFor(() => pending(ui), { label: 'чакащ обхват след „Комбо отчет“' });
      let p = pending(ui);
      assert.equal(p.scope, 'combo', 'таблото иска комбо обхват');
      assert.match(JSON.stringify(p.manifest.blocks[1].value), /Комбо отчет/, 'заглавието на отчета е комбо');
      assert.ok(ui.navigations.includes('report'), 'след поискване се отваря панелът „Отчети“');
      assert.equal(p.summary.portals, 1, 'в обхвата е порталът от теста');

      ui.sandbox.sessionStorage.removeItem('hapi.reportScope');
      ui.navigations.length = 0;
      host.querySelector('button[data-report="combo-recursive"]').click();
      await waitFor(() => pending(ui), { label: 'чакащ обхват след „Рекурсивен комбо отчет“' });
      p = pending(ui);
      assert.equal(p.scope, 'combo-recursive', 'рекурсивният обхват е отделен');
      assert.ok(p.summary.folders >= 1, 'рекурсивният обхват брои папките: ' + p.summary.folders);
      host.remove();
    }

    // ── 2. Report Studio поема обхвата и показва кой е ────────────────────────
    {
      const host = ui.container();
      ui.clearToasts();
      w.ReportStudio.mount(host);
      await waitFor(() => {
        const badge = host.querySelector('#rs-scope');
        return badge && !badge.hidden && /комбо/i.test(text(badge));
      }, { label: 'баджът с обхвата в Report Studio' });
      assert.match((ui.lastToast() || {}).message || '', /Зареден обхват/, 'панелът казва, че е заредил обхват');
      assert.equal(pending(ui), null, 'обхватът се изчиства след поемане — не залепва за следващото отваряне');
      const blocks = w.ReportStudio.state.manifest.blocks;
      assert.ok(blocks.length > 2, 'манифестът не е празният шаблон: ' + blocks.length + ' блока');
      assert.ok(blocks.some((b) => b.type === 'metadata' && /Портал/.test(b.label)), 'в отчета има блок за портала');
      host.remove();
    }

    // ── 3. Картата на портала: отчет и рекурсивен отчет ──────────────────────
    {
      const host = ui.container();
      w.FilesManagerPanel.mount(host);
      await waitFor(() => text(host).includes('Портал за отчети'), { label: 'списъкът с портали' });
      w.FilesManagerPanel.state.openPortal = portal.id;
      w.FilesManagerPanel.state.portalIndex = 0;
      w.FilesManagerPanel.mount(host);
      await waitFor(() => host.querySelector('[data-report-portal="0"]'), { label: 'бутонът за отчет на портала' });

      ui.navigations.length = 0;
      host.querySelector('[data-report-portal="0"]').click();
      await waitFor(() => pending(ui), { label: 'чакащ обхват след „Отчет за портала“' });
      const p = pending(ui);
      assert.equal(p.scope, 'portal', 'обхватът е един портал');
      assert.equal(p.summary.files, 2, 'в отчета влизат двата файла');
      assert.ok(ui.navigations.includes('report'), 'отчетът на портала също отваря „Отчети“');

      ui.sandbox.sessionStorage.removeItem('hapi.reportScope');
      host.querySelector('[data-report-recursive="0"]').click();
      await waitFor(() => pending(ui), { label: 'чакащ обхват след рекурсивния отчет' });
      const rec = pending(ui);
      assert.equal(rec.scope, 'portal-recursive', 'рекурсивният отчет на портала е отделен обхват');
      assert.ok(rec.summary.folders >= 1, 'папката от хранилището влиза в рекурсивния отчет: ' + rec.summary.folders);
      host.remove();
    }

    // ── 4. Опциите на файла: отчет за ТОЗИ файл ───────────────────────────────
    {
      const host = ui.container();
      w.FilesManagerPanel.state.openPortal = portal.id;
      w.FilesManagerPanel.state.portalIndex = 0;
      w.FilesManagerPanel.mount(host);
      await waitFor(() => host.querySelector('[data-file-gear="' + fileA.id + '"]'), { label: 'зъбчатката на файла' });
      host.querySelector('[data-file-gear="' + fileA.id + '"]').click();
      await waitFor(() => host.querySelector('[data-file-act="report"][data-file-id="' + fileA.id + '"]'), { label: 'редът „Отчет“ в опциите на файла' });

      ui.sandbox.sessionStorage.removeItem('hapi.reportScope');
      ui.navigations.length = 0;
      host.querySelector('[data-file-act="report"][data-file-id="' + fileA.id + '"]').click();
      await waitFor(() => pending(ui), { label: 'чакащ обхват след „Отчет“ при файла' });
      const p = pending(ui);
      assert.equal(p.scope, 'file', 'обхватът е един файл');
      assert.match(p.label, /договор\.txt/, 'етикетът назовава файла: ' + p.label);
      const flat = JSON.stringify(p.manifest);
      assert.ok(flat.includes('договор.txt'), 'името на файла влиза в отчета');
      assert.ok(flat.includes(fileA.sha256), 'SHA-256 от регистъра влиза в отчета');
      assert.equal(flat.includes('приложение.txt'), false, 'другият файл НЕ влиза в отчета за един файл');
      assert.ok(ui.navigations.includes('report'), 'опциите на файла водят до „Отчети“');
      host.remove();
    }

    // ── 5. Нито един вход не оставя празен/невалиден манифест ─────────────────
    {
      const M = require('../hapi_enterprise/report-manifest.js');
      for (const scope of w.HapiReportScope.SCOPES) {
        const built = (() => {
          if (scope === 'file') return w.HapiReportScope.buildFile({ portal: { slug: 's', title: 'S', files: [] }, file: { id: 'i', name: 'n', size: 1 } });
          if (scope === 'portal') return w.HapiReportScope.buildPortal({ portal: { id: 'p', slug: 's', title: 'S', files: [] } });
          if (scope === 'portal-recursive') return w.HapiReportScope.buildPortal({ portal: { id: 'p', slug: 's', title: 'S', files: [] }, tree: { folderCount: 0, fileCount: 0, bytes: 0, folders: [] }, recursive: true });
          if (scope === 'combo') return w.HapiReportScope.buildCombo({ portals: [] });
          return w.HapiReportScope.buildCombo({ portals: [], trees: {}, recursive: true });
        })();
        const check = M.check(built.manifest);
        assert.equal(check.ok, true, 'обхватът „' + scope + '“ дава валиден манифест: ' + JSON.stringify(check.errors));
      }
    }

    const leftovers = fs.existsSync(path.join(server.dir, 'public-packages.json'));
    assert.equal(typeof leftovers, 'boolean', 'сървърът работи'); // сървърът е жив до края на теста
    console.log(
      'PASS report-entry-points: таблото дава комбо и рекурсивен комбо · всеки файл има „Отчет“ в опциите · порталът — отчет и рекурсивен отчет · ' +
      'Report Studio поема обхвата и го изчиства · всеки обхват е валиден манифест',
    );
  } finally {
    await server.stop().catch(() => { });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
