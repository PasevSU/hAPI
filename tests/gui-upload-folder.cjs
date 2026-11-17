'use strict';
// ЦЯЛА ПАПКА ПРЕЗ ПАНЕЛА: структура, дати, история и ЧЕСТЕН напредък (0.69.214).
//
// Защо има тест: „качи папка“ е сценарият, при който човек очаква да види същата подредба на
// сървъра, същите дати на файловете и следа кога какво е качено. Дотук това се проверяваше
// само на парче (един файл) и само на сървъра.
//
// Тестът пада, ако:
//   • подпапките не се създадат (или файловете паднат в корена);
//   • някой файл не е с точните байтове (SHA-256) или загуби датата си на промяна;
//   • историята не съдържа по ред на файл;
//   • лентата стига 100 % преди сървърът да е потвърдил всички файлове („фалшив прогрес“);
//   • прозорецът не изброява всички файлове на опашката.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');
const paths = require('../hapi_enterprise/paths');

const PANEL_MODULES = [
  'data.js', 'icons.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'upload-progress.js', 'files-manager.js',
  'directory-panel.js', 'dashboard-panel.js', 'settings-panel.js', 'export-center.js',
  'public-gateway.js', 'visitors-panel.js', 'secret-share.js', 'report-sign.js',
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  const server = await startServer({ keepData: true });
  try {
    const created = await server.api('/admin/api/portals', 'POST', { slug: 'upload-folder', title: 'Цяла папка', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава');
    const portal = created.data;
    const root = paths.resolveStoragePath(portal.storage_root, '', { STORAGE_ROOT_OVERRIDE: server.storageRoot() });

    const ui = mountUi(server, { modules: PANEL_MODULES });
    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portal.id;
    ui.window.FilesManagerPanel.mount(host);
    await expandPortalBlocks(host, { block: 'folders' });

    // Три файла в две нива: коренът на избраната папка и подпапка в нея.
    const plan = [
      { rel: 'Papka/a.txt', body: 'първи файл', mtime: Date.UTC(2022, 0, 2, 3, 4, 5) },
      { rel: 'Papka/pod/b.bin', body: crypto.randomBytes(1400).toString('latin1'), mtime: Date.UTC(2022, 1, 3, 4, 5, 6) },
      { rel: 'Papka/c.txt', body: 'трети файл', mtime: Date.UTC(2022, 2, 4, 5, 6, 7) },
    ];
    const files = plan.map((item) => {
      const bytes = Buffer.from(item.body, 'latin1');
      return {
        name: item.rel.split('/').pop(),
        type: 'application/octet-stream',
        webkitRelativePath: item.rel,
        size: bytes.length,
        lastModified: item.mtime,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    });

    const dirInput = host.querySelector('#fm-dir-input');
    assert.ok(dirInput, 'панелът има скрит input за цяла папка');
    dirInput.files = files;
    dirInput.dispatch('change');

    const backdrop = await waitFor(() => ui.document.body.querySelector('[data-up-backdrop]'), { label: 'прозореца за качване' });
    assert.ok(backdrop, 'прозорецът се отваря');

    // Прозорецът изрежда ВСИЧКИ файлове на опашката, не само текущия.
    const rows = backdrop.querySelectorAll('[data-up-item]');
    assert.equal(rows.length, 3, 'три реда за три файла: ' + rows.length);

    // ── Честен напредък: снимаме стойностите, докато тече ───────────────────
    const samples = [];
    let finished = false;
    const watch = (async () => {
      while (!finished) {
        const bar = ui.document.body.querySelector('[role="progressbar"]');
        if (bar) samples.push(Number(bar.getAttribute('aria-valuenow')));
        await new Promise((r) => setTimeout(r, 20));
      }
    })();

    await waitFor(() => ui.lastToast(), { label: 'съобщението след качване на папката', timeout: 40000 });
    finished = true;
    await watch;
    assert.equal(ui.lastToast().kind, 'ok', 'качването на папката е успешно: ' + ui.lastToast().message);
    assert.match(ui.lastToast().message, /Прикачени 3/, 'казва се, че са качени три файла: ' + ui.lastToast().message);

    const finalBar = ui.document.body.querySelector('[role="progressbar"]');
    assert.equal(finalBar.getAttribute('aria-valuenow'), '100', 'накрая лентата е на 100');
    assert.ok(samples.length >= 3, 'има междинни измервания: ' + samples.length);
    const beforeEnd = samples.slice(0, -1);
    assert.ok(
      beforeEnd.some((v) => v > 0 && v < 100),
      'напредъкът минава през междинни стойности, не скача от 0 на 100: ' + samples.join(','),
    );
    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i] >= samples[i - 1], 'напредъкът не се връща назад: ' + samples.join(','));
    }

    // ── Структура: файловете са в подпапките, с точните байтове и дати ───────
    for (const item of plan) {
      const abs = path.join(root, ...item.rel.split('/'));
      assert.ok(fs.existsSync(abs), 'файлът е на мястото си: ' + item.rel);
      const bytes = Buffer.from(item.body, 'latin1');
      const disk = fs.readFileSync(abs);
      assert.equal(sha256(disk), sha256(bytes), 'байтовете съвпадат: ' + item.rel);
      assert.equal(Math.floor(fs.statSync(abs).mtimeMs), item.mtime, 'датата на промяна е запазена: ' + item.rel);
    }
    assert.equal(fs.existsSync(path.join(root, 'a.txt')), false, 'нищо не е изсипано в корена на папката');

    // ── История: един ред на файл, всичките „сверени“ ────────────────────────
    const history = path.join(server.dir, 'upload-history', `${portal.id}.jsonl`);
    const entries = fs.readFileSync(history, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(entries.length, 3, 'три реда за три файла: ' + entries.length);
    for (const item of plan) {
      const hit = entries.find((e) => e.path === '/' + item.rel);
      assert.ok(hit, 'историята помни ' + item.rel);
      assert.equal(hit.verified, true, 'редът е сверен: ' + item.rel);
      assert.equal(hit.metadata.mtimePreserved, true, 'и датата е запазена: ' + item.rel);
      assert.equal(hit.size, Buffer.byteLength(item.body, 'latin1'), 'размерът в историята е верен: ' + item.rel);
    }
    const viaApi = await server.api(`/admin/api/portals/${portal.id}/uploads`);
    assert.equal(viaApi.status, 200);
    assert.equal(viaApi.data.entries.length, 3, 'историята се чете и през API (за панела): ' + viaApi.data.entries.length);
    assert.deepEqual(viaApi.data.sessions, [], 'няма висящи сесии след успешно качване');

    console.log(
      'PASS gui-upload-folder: 3 файла в 2 нива · структурата е запазена · SHA-256 и mtime точни · ' +
        `история 3 реда (през файл и API) · прогресът е междинен и монотонен: ${samples.slice(0, 5).join(',')}…`,
    );
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error('FAIL gui-upload-folder:', e && e.message);
  process.exit(1);
});
