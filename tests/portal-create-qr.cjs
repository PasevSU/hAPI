'use strict';
// ПОРТАЛЪТ СЕ СЪЗДАВА С РЕШЕНА ВИДИМОСТ И С ГОТОВ QR (0.69.210).
//
// Защо има тест: формата имаше поле „Видимост“, но панелът не я изпращаше при създаването —
// порталът се създаваше частен и после се обявяваше с втори PATCH. Два записа за едно
// решение и прозорец, в който порталът вече съществува, но още не е такъв, какъвто го иска
// човек. QR кодът пък се появяваше само след натискане на иконата в заглавния ред.
//
// Тестът пада, ако:
//   • POST-ът за създаване не носи избраната видимост (или се праща втори PATCH за нея);
//   • след създаването QR поповерът остане скрит (кодът е готов, но не се вижда);
//   • кодът не е SVG върху адреса на портала;
//   • сървърът върне портала с друга видимост (тогава панелът лъже).
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor } = require('./lib/gui-harness.cjs');

const PANEL_MODULES = [
  'data.js', 'icons.js', 'report-studio.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'files-manager.js', 'directory-panel.js',
  'dashboard-panel.js', 'settings-panel.js', 'export-center.js', 'public-gateway.js',
  'visitors-panel.js', 'report-sign.js',
];

(async () => {
  const server = await startServer({ keepData: true });
  try {
    const ui = mountUi(server, { modules: PANEL_MODULES });
    const host = ui.container();
    const calls = [];
    const inner = ui.sandbox.fetch;
    ui.sandbox.fetch = (url, init) => {
      const href = typeof url === 'string' ? url : String((url && url.url) || '');
      calls.push({ href, method: ((init && init.method) || 'GET').toUpperCase(), body: init && init.body });
      return inner(url, init);
    };
    ui.window.FilesManagerPanel.mount(host);

    const newBtn = await waitFor(() => host.querySelector('#pf-new'), { label: 'бутонът „Нов портал“' });
    newBtn.click();
    const form = await waitFor(() => host.querySelector('.pf-form'), { label: 'формата за нов портал' });

    const set = (name, value) => {
      const el = form.querySelector(`[name="${name}"]`);
      assert.ok(el, 'формата има поле ' + name);
      el.value = value;
    };
    set('slug', 'qr-vednaga');
    set('title', 'QR веднага');
    const vis = form.querySelector('[name="visibility"]');
    assert.ok(vis, 'формата има избор на видимост');
    vis.value = 'public';
    // Изборът е с ЧЕТИМИ етикети, не с „private/public“.
    const labels = [...vis.querySelectorAll('option')].map((o) => o.textContent.trim());
    assert.match(labels.join(' | '), /публичен/, 'опциите са обяснени: ' + labels.join(' | '));
    assert.equal(/^private$/.test(labels[0]), false, 'опцията не е суровата дума „private“: ' + labels[0]);

    host.querySelector('#pf-create').click();

    // ── 1. Създаването носи видимостта в СЪЩИЯ запис ────────────────────────
    const post = await waitFor(
      () => calls.find((c) => c.method === 'POST' && /\/admin\/api\/portals$/.test(c.href) && c.body),
      { label: 'POST за създаване на портал', timeout: 15000 },
    );
    const sent = JSON.parse(post.body);
    assert.equal(sent.visibility, 'public', 'POST-ът носи видимостта: ' + post.body);
    const patches = calls.filter((c) => c.method === 'PATCH' && /\/admin\/api\/portals\/[^/]+$/.test(c.href));
    assert.deepEqual(patches.map((p) => p.body || ''), [], 'няма втори PATCH за видимостта');

    // ── 2. QR кодът е готов и СЕ ВИЖДА веднага — в QR студиото ───────────────
    // 0.69.229: след създаване се отваря глобалният прозорец (един за всички нива), а кодът
    // е в рамката му, с изписан под него адрес.
    const pop = await waitFor(
      () => {
        const el = ui.window.document.getElementById('qs-modal');
        return el && !el.hasAttribute('hidden') && el.querySelector('.qs-frame svg') ? el : null;
      },
      { label: 'видим прозорец на QR студиото със SVG', timeout: 15000 },
    );
    const caption = pop.querySelector('.qs-caption-url');
    const href = caption ? String(caption.textContent || '').trim() : '';
    // Адресът може да е по slug или по id (панелът строи същия адрес, който ползва порталът) —
    // важното е да сочи ИМЕННО този портал, а не общ вход.
    assert.match(href, /\/p\/(qr-vednaga|[0-9a-f]{16,})/, 'кодът води към портала: ' + href);

    // ── 3. Сървърът пази същата видимост ─────────────────────────────────────
    const list = await server.api('/admin/api/portals');
    const created = (list.data.portals || []).find((p) => p.slug === 'qr-vednaga');
    assert.ok(created, 'порталът съществува на сървъра');
    assert.equal(created.visibility, 'public', 'сървърът го пази публичен: ' + created.visibility);

    console.log('PASS portal-create-qr: видимост в един запис · без втори PATCH · QR видим веднага · сървърът пази същото');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error('FAIL portal-create-qr:', e && e.message);
  process.exit(1);
});
