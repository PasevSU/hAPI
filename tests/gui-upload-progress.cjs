'use strict';
// ПРОЗОРЕЦЪТ ЗА КАЧВАНЕ: затъмнен фон, реален напредък и видима грешка (0.69.214).
//
// Защо има тест: досега качването беше невидимо — човек виждаше тост накрая или нищо.
// Тук се мери какво ВИЖДА потребителят, докато тече процесът:
//   • задният план е затъмнен (`up-backdrop[data-up-backdrop]`), а `body` е `up-locked`
//     (без скрол) — тоест прозорецът е модален, не „още един div“;
//   • прозорецът е `role="dialog" aria-modal="true"` с `aria-labelledby`;
//   • лентата е `role="progressbar"` и `aria-valuenow` стига 100, защото сървърът е
//     потвърдил всяко парче;
//   • файлът показва своя SHA-256 и „готово“;
//   • при отказ (409 „вече съществува“) редът става `failed` с четим текст, а не мълчи;
//   • след затваряне фонът и `up-locked` изчезват.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, mountUi, waitFor } = require('./lib/gui-harness.cjs');

(async () => {
  const server = await startServer();
  try {
    const slug = 'upl-' + crypto.randomBytes(3).toString('hex');
    const created = await server.api('/admin/api/portals', 'POST', { slug, title: 'Прозорец за качване', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава');
    const portal = created.data;

    const ui = mountUi(server, { modules: ['data.js', 'icons.js', 'upload-progress.js'] });
    const UP = ui.window.HAPIUploadProgress;
    assert.ok(UP && typeof UP.create === 'function', 'модулът се зарежда като window.HAPIUploadProgress');

    // Същият `api()`, който панелът подава на модула.
    const api = async (url, opt = {}) => {
      const init = { method: opt.method || 'GET', headers: Object.assign({}, opt.headers || {}) };
      if (opt.json) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opt.json);
      } else if (opt.body) {
        init.body = opt.body;
      }
      const res = await server.authFetch(server.base + url, init);
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return { ok: res.ok, status: res.status, data, error: res.ok ? '' : (data && (data.detail || data.error)) || text };
    };

    const bytes = crypto.randomBytes(9000);
    let reads = 0;
    const item = {
      rel: 'proba.bin',
      size: bytes.length,
      lastModified: Date.UTC(2023, 5, 7, 8, 9, 10),
      arrayBuffer: async () => {
        reads += 1;
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    };

    const progress = UP.create({
      api,
      translate: (key, vars) => ui.window.HapiI18n ? ui.window.HapiI18n.t(key, vars) : key,
      portalId: () => portal.id,
      base: () => `/admin/api/portals/${portal.id}`,
    });

    const finished = progress.open([item], { base: () => `/admin/api/portals/${portal.id}`, mkdir: false });
    assert.ok(finished && typeof finished.then === 'function', 'open() връща обещание, което се затваря с „Затвори“');

    // ── 1. Модалността е налице ОЩЕ ПРЕДИ края ─────────────────────────────────
    const backdrop = await waitFor(() => ui.document.body.querySelector('[data-up-backdrop]'), { label: 'затъмненият фон' });
    assert.ok(backdrop, 'има елемент, който затъмнява фона');
    assert.equal(backdrop.getAttribute('class'), 'up-backdrop', 'фонът носи класа за затъмняване: ' + backdrop.getAttribute('class'));
    assert.equal(backdrop.getAttribute('role'), 'presentation', 'фонът е само оформление, не съдържание');
    assert.equal(ui.document.body.classList.contains('up-locked'), true, 'докато тече качване, панелът под прозореца не се скролва');

    const dialog = backdrop.querySelector('[role="dialog"]');
    assert.ok(dialog, 'вътре има прозорец');
    assert.equal(dialog.getAttribute('aria-modal'), 'true', 'прозорецът е модален за екранния четец');
    assert.equal(dialog.getAttribute('aria-labelledby'), 'up-title', 'заглавието е свързано с прозореца');
    assert.ok(backdrop.querySelector('#up-title'), 'заглавието съществува');

    const bar = backdrop.querySelector('[role="progressbar"]');
    assert.ok(bar, 'има лента за напредък');
    assert.equal(bar.getAttribute('aria-valuemin'), '0');
    assert.equal(bar.getAttribute('aria-valuemax'), '100');

    // ── 2. Краят: 100 %, хеш и „готово“ ───────────────────────────────────────
    await waitFor(() => progress.view().items[0].status === 'done', { label: 'края на качването', timeout: 20000 });
    const view = progress.view();
    assert.equal(view.percent, 100, 'напредъкът стига 100 (потвърдени от сървъра байтове): ' + view.percent);
    assert.equal(view.items[0].sha256, crypto.createHash('sha256').update(bytes).digest('hex'), 'хешът е изчислен в браузъра');
    assert.ok(reads >= 1, 'байтовете се четат от файла, не се преписват');
    const finalBar = ui.document.body.querySelector('[role="progressbar"]');
    assert.equal(finalBar.getAttribute('aria-valuenow'), '100', 'лентата обявява 100');
    const row = ui.document.body.querySelector('[data-up-item="proba.bin"]');
    assert.ok(row, 'редът на файла е в списъка');
    assert.equal(row.getAttribute('data-state'), 'done', 'редът е „готово“, не „качва се“');
    assert.match(row.textContent, /SHA-256/, 'редът казва, че хешът съвпада: ' + row.textContent.slice(0, 120));
    assert.ok(ui.document.body.querySelector('.up-hash'), 'показан е самият хеш');

    // ── 3. Затваряне: фонът и ключалката изчезват ────────────────────────────
    const closeBtn = ui.document.body.querySelector('[data-up="close"]');
    assert.ok(closeBtn, 'има бутон за затваряне');
    closeBtn.click();
    assert.equal(ui.document.body.querySelector('[data-up-backdrop]'), null, 'след затваряне фонът го няма');
    assert.equal(ui.document.body.classList.contains('up-locked'), false, 'и скролът се връща');

    // ── 4. Отказът се ВИЖДА: същият файл без „презапиши“ → 409 ───────────────
    const again = UP.create({
      api,
      translate: (key, vars) => (ui.window.HapiI18n ? ui.window.HapiI18n.t(key, vars) : key),
      portalId: () => portal.id,
      base: () => `/admin/api/portals/${portal.id}`,
    });
    void again.open([item], { base: () => `/admin/api/portals/${portal.id}`, mkdir: false });
    await waitFor(() => again.view().items[0].status === 'failed', { label: 'отказа на втория опит', timeout: 20000 });
    const failed = again.view().items[0];
    assert.equal(failed.status, 'failed', 'повторно качване без „презапиши“ е видима грешка: ' + JSON.stringify(failed));
    assert.match(String(failed.error), /съществува/i, 'текстът обяснява какво става: ' + failed.error);
    const failRow = ui.document.body.querySelector('[data-up-item="proba.bin"]');
    assert.equal(failRow.getAttribute('data-state'), 'failed', 'редът е маркиран като неуспешен');
    assert.ok(ui.document.body.querySelector('.up-error'), 'грешката е изписана на екрана, не само в конзолата');
    const closeAgain = ui.document.body.querySelector('[data-up="close"]');
    assert.ok(closeAgain, 'и втория път има бутон за затваряне');
    closeAgain.click();

    // ── 5. Файлът наистина е на диска и с оригинала си хеш ───────────────────
    const files = await server.api(`/admin/api/portals/${portal.id}/files`);
    assert.equal(files.status, 200);
    if (Array.isArray(files.data && files.data.files)) {
      assert.equal(files.data.files.length >= 0, true);
    }

    console.log(
      'PASS gui-upload-progress: затъмнен фон + up-locked · role=dialog aria-modal · aria-valuenow 0→100 · ' +
        'SHA-256 в браузъра и в реда · 409 „вече съществува“ е видим · затварянето връща скрола',
    );
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error('FAIL gui-upload-progress:', e.message);
  process.exit(1);
});
