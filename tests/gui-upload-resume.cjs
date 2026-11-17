'use strict';
// ПРЕКЪСВАНЕ И ВЪЗСТАНОВЯВАНЕ НА КАЧВАНЕТО — ПРЕЗ ПАНЕЛА (0.69.214).
//
// Защо има тест: „възстановяване на процеса“ е обещание, което се проверява само ако нещо
// наистина се счупи по средата. Тук мрежата се счупва НАРОЧНО на второто парче, човекът
// вижда прозореца в състояние „прекъснато“, натиска „Продължи“ — и файлът стига до диска със
// същия SHA-256 и същата дата на промяна.
//
// Тестът пада, ако:
//   • прекъсването се брои за край (файл без последните парчета);
//   • „Продължи“ започва отначало или не довършва (липсващ/сгрешен байт);
//   • отказът оставя файл или сесия на сървъра;
//   • датата на промяна се губи;
//   • прогресът стига 100 % преди сървърът да е потвърдил всичко.
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
    const created = await server.api('/admin/api/portals', 'POST', { slug: 'upload-resume', title: 'Възстановяване', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава');
    const portal = created.data;
    const folder = paths.resolveStoragePath(portal.storage_root, '', { STORAGE_ROOT_OVERRIDE: server.storageRoot() });

    const ui = mountUi(server, { modules: PANEL_MODULES });
    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portal.id;
    ui.window.FilesManagerPanel.mount(host);
    await expandPortalBlocks(host, { block: 'folders' });

    // ── Мрежата се чупи нарочно на ВТОРОТО парче (веднъж) ────────────────────
    const inner = ui.sandbox.fetch;
    let broken = 0;
    let breakAt = 1;
    ui.sandbox.fetch = (url, init) => {
      const href = typeof url === 'string' ? url : String((url && url.url) || '');
      const m = /\/uploads\/[0-9a-f]+\/(\d+)$/.exec(href);
      if (m && init && init.method === 'PUT' && Number(m[1]) === breakAt && broken === 0) {
        broken += 1;
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return inner(url, init);
    };

    const input = host.querySelector('#fm-file-input');
    assert.ok(input, 'панелът има скрит input за файл');
    // 2.5 MB = три парчета по 1 MB (сървърът реже на 1 MB, когато клиентът не поиска друго).
    const bytes = crypto.randomBytes(2_500_000);
    const MTIME = Date.UTC(2023, 10, 12, 13, 14, 15);
    const file = {
      name: 'golyam.bin',
      type: 'application/octet-stream',
      webkitRelativePath: '',
      size: bytes.length,
      lastModified: MTIME,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };

    // ── 1. Първи опит: прекъсва на второто парче ─────────────────────────────
    input.files = [file];
    input.dispatch('change');
    const dialog = await waitFor(() => ui.document.body.querySelector('[data-up-backdrop]'), { label: 'прозореца за качване' });
    assert.ok(dialog, 'прозорецът се отваря при качване');
    await waitFor(() => ui.document.body.querySelector('[data-up-item="golyam.bin"][data-state="paused"]'), {
      label: 'състояние „прекъснато“',
      timeout: 30000,
    });
    assert.equal(broken, 1, 'мрежата се счупи точно веднъж');
    const bar = ui.document.body.querySelector('[role="progressbar"]');
    assert.ok(Number(bar.getAttribute('aria-valuenow')) < 100, 'след прекъсване лентата НЕ е на 100: ' + bar.getAttribute('aria-valuenow'));
    assert.equal(ui.lastToast(), null, 'до успешен край няма тост „готово“');
    const partial = fs.existsSync(path.join(folder, 'golyam.bin'));
    assert.equal(partial, false, 'недовършеният файл НЕ е в папката');

    // Сървърът знае какво е пристигнало — това е „възстановяване“, не „отначало“.
    const sessions = await server.api(`/admin/api/portals/${portal.id}/uploads`);
    assert.equal(sessions.status, 200);
    const active = sessions.data.sessions.find((s) => s.path === '/golyam.bin');
    assert.ok(active, 'сесията стои на сървъра: ' + JSON.stringify(sessions.data.sessions));
    assert.equal(active.chunks, 1, 'пристигнало е точно едно парче: ' + active.chunks);
    assert.ok(active.receivedBytes > 0 && active.receivedBytes < bytes.length, 'половината байтове са на сървъра');

    // ── 2. „Продължи“ довършва СЪЩИЯ файл ────────────────────────────────────
    const resumeBtn = ui.document.body.querySelector('[data-up="resume"]');
    assert.ok(resumeBtn, 'прозорецът предлага „Продължи“');
    resumeBtn.click();
    await waitFor(() => ui.lastToast(), { label: 'съобщението след успешно качване', timeout: 40000 });
    assert.equal(ui.lastToast().kind, 'ok', 'след „Продължи“ качването свършва успешно: ' + ui.lastToast().message);
    assert.match(ui.lastToast().message, /Прикачени 1/, 'казва се, че файлът е качен');

    const done = await waitFor(() => ui.document.body.querySelector('[data-up-item="golyam.bin"][data-state="done"]'), { label: 'реда „готово“' });
    assert.ok(done, 'редът на файла е „готово“');
    assert.equal(ui.document.body.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '100', '100 % само след потвърждение от сървъра');

    const abs = path.join(folder, 'golyam.bin');
    assert.ok(fs.existsSync(abs), 'файлът е на диска: ' + abs);
    const disk = fs.readFileSync(abs);
    assert.equal(disk.length, bytes.length, 'размерът съвпада');
    assert.equal(sha256(disk), sha256(bytes), 'SHA-256 на диска съвпада с изчисленото в браузъра');
    assert.equal(Math.floor(fs.statSync(abs).mtimeMs), MTIME, 'датата на промяна е запазена точно');

    const historyFile = path.join(server.dir, 'upload-history', `${portal.id}.jsonl`);
    const lines = fs.readFileSync(historyFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines.length, 1, 'историята има един ред за каченото');
    assert.equal(lines[0].verified, true, 'историята твърди „сверено“');
    assert.equal(lines[0].metadata.mtimePreserved, true, 'и датата е запазена');

    // ── 3. Втори файл: прекъсване и ОТКАЗ не оставя нищо ─────────────────────
    // Преди това се затваря първият прозорец: два модални прозореца едновременно е дефект
    // (вторият „Отказ“ щеше да цъка първия и файлът щеше да остане недовършен).
    const closeFirst = ui.document.body.querySelector('[data-up="close"]');
    assert.ok(closeFirst, 'първият прозорец има „Затвори“');
    closeFirst.click();
    assert.equal(ui.document.body.querySelectorAll('[data-up-backdrop]').length, 0, 'след затваряне не остава фон');

    broken = 0;
    breakAt = 0;
    const other = crypto.randomBytes(1_500_000);
    const second = {
      name: 'otkazan.bin',
      type: 'application/octet-stream',
      webkitRelativePath: '',
      size: other.length,
      lastModified: MTIME,
      arrayBuffer: async () => other.buffer.slice(other.byteOffset, other.byteOffset + other.byteLength),
    };
    input.files = [second];
    input.dispatch('change');
    assert.equal(
      await waitFor(() => ui.document.body.querySelectorAll('[data-up-backdrop]').length === 1, { label: 'един–единствен прозорец' }),
      true,
      'по едно и също време има САМО един прозорец за качване',
    );
    await waitFor(() => ui.document.body.querySelector('[data-up-item="otkazan.bin"][data-state="paused"]'), {
      label: 'второто качване е прекъснато',
      timeout: 30000,
    });
    const cancelBtn = ui.document.body.querySelector('[data-up="cancel"]');
    assert.ok(cancelBtn, 'има „Отказ“');
    cancelBtn.click();
    await waitFor(() => ui.document.body.querySelector('[data-up-item="otkazan.bin"][data-state="cancelled"]'), {
      label: 'реда „отказано“',
      timeout: 20000,
    });
    await waitFor(() => {
      const gone = !fs.existsSync(path.join(folder, 'otkazan.bin'));
      return gone;
    }, { label: 'файлът да не се появи', timeout: 20000 });
    assert.equal(fs.existsSync(path.join(folder, 'otkazan.bin')), false, 'отказаното качване НЕ оставя файл');
    const after = await server.api(`/admin/api/portals/${portal.id}/uploads`);
    assert.equal(
      after.data.sessions.some((s) => s.path === '/otkazan.bin'),
      false,
      'отказаната сесия е изтрита от сървъра: ' + JSON.stringify(after.data.sessions),
    );
    assert.equal(
      fs.readFileSync(historyFile, 'utf8').split('\n').filter(Boolean).length,
      1,
      'отказаното качване НЕ влиза в историята',
    );

    console.log(
      'PASS gui-upload-resume: прекъсване на 2-рото парче → „прекъснато“ под 100 %, файл няма · ' +
        'сесията пази 1 парче на сървъра · „Продължи“ довършва със същия SHA-256 и mtime · ' +
        '„Отказ“ не оставя нито файл, нито сесия, нито ред в историята',
    );
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error('FAIL gui-upload-resume:', e && e.message);
  process.exit(1);
});
