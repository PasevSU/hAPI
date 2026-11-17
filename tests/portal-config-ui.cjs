'use strict';
// БЛОКЪТ „ОПЦИИ“ В ПАНЕЛА (план 23, „Остава“ №2).
//
// Какво пази този тест: човекът вижда опциите на портала на едно място, записва ги през
// ЕДИНСТВЕНИЯ маршрут (PUT …/config с чекпойнт), проверява папката срещу описанието и
// показва самия файл. Текстът минава през речника, а не е зашит в модула (таван 0, DEF-49).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');
const { storageRoot } = require('./helpers.cjs');

const PANEL_MODULES = [
  'data.js', 'icons.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'files-manager.js', 'directory-panel.js',
  'dashboard-panel.js', 'settings-panel.js', 'export-center.js', 'public-gateway.js',
  'visitors-panel.js', 'secret-share.js', 'report-sign.js',
];

(async () => {
  const storage = storageRoot();
  const server = await startServer({ env: { ...storage.env, PORTAL_FOLDER_COPY: 'true' } });
  try {
    const created = await server.api('/admin/api/portals', 'POST', { title: 'Портал с опции', slug: 'p-ui-opcii', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data).slice(0, 200));
    const portal = created.data.portal || created.data;
    const logical = String(portal.storage_root || '').replace(/^\/+/, '');
    const file = path.join(storage.dir, ...logical.split('/').filter(Boolean), 'configuration.yaml');
    assert.ok(fs.existsSync(file), 'описанието е в папката на портала');

    const ui = mountUi(server, { modules: PANEL_MODULES });
    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portal.id;
    ui.window.FilesManagerPanel.mount(host);
    await expandPortalBlocks(host, { block: 'control' });

    // ── 1. Четирите раздела идват от описанието, не от картата ─────────────
    const form = await waitFor(() => host.querySelector('#pf-config-form'), { label: 'блокът „Опции“' });
    assert.equal(form.querySelectorAll('fieldset').length, 4, 'Портал · Достъп · QR · Интерфейс');
    // Тестовият DOM избира първата опция на `<select>`; затова изборът се проверява по
    // `selected` атрибута, а не по `.value` (в браузър двете съвпадат).
    const selectedOf = (name) => {
      const el = form.querySelector(`[name="opt.${name}"] option[selected]`);
      return el ? el.getAttribute('value') : null;
    };
    assert.equal(selectedOf('visibility'), 'public', 'видимостта идва от файла');
    assert.equal(selectedOf('ui_columns'), '3', 'подразбирането за колони е в полето');
    assert.equal(selectedOf('access_mode'), 'free', 'публичният портал е свободен по подразбиране');
    const checkpoint = host.querySelector('[data-pf-options] .hint');
    assert.ok(checkpoint && checkpoint.textContent.length > 0, 'чекпойнтът се вижда');

    // ── 2. Запис през маршрута: 3 → 4 колони ────────────────────────────────
    // Изчакваме датите на рисуване да утихнат (зареждането на описанието рисува втори път) и
    // взимаме ЖИВАТА форма — върху стара възел-референция слушателят вече не е закачен.
    await new Promise((r) => setTimeout(r, 250));
    const live = host.querySelector('#pf-config-form');
    assert.ok(live, 'формата е в документа');
    live.querySelector('[name="opt.ui_columns"]').value = '4';
    live.dispatch('submit');
    await waitFor(() => /^ui_columns: 4$/m.test(fs.readFileSync(file, 'utf8')), { label: 'записаните колони' });
    const saved = await server.api('/admin/api/portals/' + encodeURIComponent(portal.id) + '/config', 'GET');
    assert.equal(saved.data.data.ui_columns, 4, 'сървърът вижда записа');
    assert.ok(saved.data.revision > 1, 'ревизията е вдигната');

    // ── 3. „Провери папката“ минава при съвпадение ──────────────────────────
    await waitFor(() => host.querySelector('#pf-config-verify'), { label: 'бутонът за проверка' });
    host.querySelector('#pf-config-verify').click();
    await waitFor(() => {
      const out = host.querySelector('#pf-config-out');
      return out && /съвпада/.test(out.textContent || '');
    }, { label: 'резултатът от проверката' });

    // ── 4. „Покажи файла“ показва САМИЯ файл ────────────────────────────────
    host.querySelector('#pf-config-show').click();
    const pre = await waitFor(() => {
      const el = host.querySelector('#pf-config-file');
      return el && !el.hidden && /ui_columns: 4/.test(el.textContent || '') ? el : null;
    }, { label: 'разпечатката на файла' });
    assert.match(pre.textContent, /^version: 1$/m, 'текстът е YAML, не JSON');

    console.log(
      'PASS portal-config-ui: четири раздела от описанието · запис през PUT с чекпойнт · ' +
        'проверка на папката · разпечатка на самия файл',
    );
  } finally {
    await server.stop();
    fs.rmSync(storage.dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('FAIL portal-config-ui: ' + error.message);
  process.exitCode = 1;
});
