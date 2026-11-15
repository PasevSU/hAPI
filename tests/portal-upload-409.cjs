'use strict';
// ПОВТОРНО КАЧВАНЕ НА ПАПКА: 409 НЕ Е ГРЕШКА (0.69.210).
//
// Защо има тест: в живия дневник на браузъра се виждаха десетки
//   POST …/tree/upload → 409 (Conflict)
// и три `net::ERR_FILE_NOT_FOUND`. Първото е нормалният отговор на сървъра, когато файлът
// вече е там (`exists && !overwrite`), но панелът го броеше като „неуспешен“ — човек
// прочиташе „неуспешни 200“ и търси дефект, който го няма. Второто е браузърна грешка
// (файлът е преместен или само в облака) и трябва да се каже с думи, не като `HTTP 0`.
//
// Тестът пада, ако:
//   • 409 се брои като повреда, вместо като „вече съществува“;
//   • `overwrite=1` се праща без изрична отметка (или НЕ се праща с нея);
//   • нечетим файл (заявката не стига до сървъра) не се обяснява с думи;
//   • успешното качване не се отчита.
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');

const PANEL_MODULES = [
  'data.js', 'icons.js', 'report-studio.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'upload-progress.js', 'files-manager.js',
  'directory-panel.js', 'dashboard-panel.js', 'settings-panel.js', 'export-center.js',
  'public-gateway.js', 'visitors-panel.js', 'secret-share.js', 'report-sign.js',
];

(async () => {
  const server = await startServer({ keepData: true });
  try {
    const portal = await server.api('/admin/api/portals', 'POST', { slug: 'upload-409', title: 'Качване', visibility: 'public' });
    assert.equal(portal.status, 201, 'порталът се създава: ' + JSON.stringify(portal.data));
    const portalId = portal.data.id;

    const ui = mountUi(server, { modules: PANEL_MODULES });
    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portalId;
    ui.window.FilesManagerPanel.mount(host);
    await expandPortalBlocks(host, { block: 'folders' });

    // Записваме какво панелът ИСКА (тялото на сесията), преди заявката да тръгне.
    const opened = [];
    const inner = ui.sandbox.fetch;
    const watch = () => {
      ui.sandbox.fetch = (url, init) => {
        const href = typeof url === 'string' ? url : String((url && url.url) || '');
        if (href.endsWith('/uploads') && init && init.method === 'POST' && init.body) {
          opened.push(JSON.parse(String(init.body)));
        }
        return inner(url, init);
      };
    };
    watch();

    const input = host.querySelector('#fm-file-input');
    assert.ok(input, 'панелът има скрит input за файл (fm-file-input)');
    const MTIME = Date.UTC(2024, 2, 3, 4, 5, 6);
    const send = async (name, { unreadable = false, body = 'съдържание' } = {}) => {
      const bytes = Buffer.from(body, 'utf8');
      if (unreadable) {
        ui.sandbox.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
      } else {
        watch();
      }
      ui.clearToasts();
      input.files = [
        {
          name,
          type: 'text/plain',
          webkitRelativePath: '',
          size: bytes.length,
          lastModified: MTIME,
          arrayBuffer: async () => {
            if (unreadable) throw new TypeError('NotReadableError');
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          },
        },
      ];
      input.dispatch('change');
      await waitFor(() => ui.lastToast(), { label: 'съобщение след качване на ' + name, timeout: 20000 });
      return ui.lastToast();
    };

    // ── 1. Първо качване: файлът стига до сървъра ──────────────────────────
    let toast = await send('dokument.txt');
    assert.equal(toast.kind, 'ok', 'първото качване е успешно: ' + toast.message);
    assert.match(toast.message, /Прикачени 1/, 'казва се колко е качено: ' + toast.message);
    assert.equal(opened.at(-1).overwrite, false, 'без отметка НЕ се праща overwrite');
    assert.equal(String(opened.at(-1).sha256).length, 64, 'сесията обявява SHA-256 на файла: ' + opened.at(-1).sha256);
    assert.equal(opened.at(-1).mtime, MTIME, 'датата на промяна пътува със сесията (не се пипа)');

    // ── 2. Същият файл пак: сървърът отговаря 409 ─────────────────────────
    toast = await send('dokument.txt');
    assert.match(toast.message, /вече съществува/, '409 се обяснява като „вече съществува“: ' + toast.message);
    assert.equal(/неуспешни/.test(toast.message), false, '409 НЕ се брои за неуспех: ' + toast.message);

    // ── 3. С отметка „презапиши“: заявката носи overwrite=1 и минава ───────
    const box = host.querySelector('#fm-overwrite');
    assert.ok(box, 'панелът има отметка „презапиши“');
    box.click();
    assert.equal(box.checked, true, 'отметката се включва');
    toast = await send('dokument.txt');
    assert.equal(opened.at(-1).overwrite, true, 'с отметка сесията носи overwrite: true');
    assert.equal(toast.kind, 'ok', 'презаписването минава: ' + toast.message);

    // ── 4. Нечетим файл: заявката не стига до сървъра ─────────────────────
    toast = await send('v-oblakata.pdf', { unreadable: true });
    assert.equal(toast.kind, 'err', 'нечетимият файл е грешка: ' + toast.message);
    assert.match(toast.message, /не можа да прочете/, 'причината е изписана с думи: ' + toast.message);
    assert.equal(/HTTP 0/.test(toast.message), false, 'не се показва „HTTP 0“: ' + toast.message);

    console.log('PASS portal-upload-409: 409 = „вече съществува“ · overwrite само с отметка · нечетим файл с причина · успехът се отчита');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error('FAIL portal-upload-409:', e && e.message);
  process.exit(1);
});
