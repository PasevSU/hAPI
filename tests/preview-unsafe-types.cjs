'use strict';
// SVG/HTML НЕ СЕ РИСУВАТ В ПАНЕЛА — и това се проверява на живо (0.69.216).
//
// Дефектът (намерен при сегментирания анализ): прегледът слагаше blob адрес в `<iframe>` за
// всеки тип, различен от текст. Blob адресът наследява произхода на панела, тоест качен SVG
// със `<script>` вътре се изпълнява в същия произход и стига до `sessionStorage` с
// администраторския токен. Сървърът също сервираше `image/svg+xml` inline без политика.
//
// Тестът мери три неща на живо:
//   1. сървърът слага `Content-Security-Policy` на inline SVG (директното отваряне е безопасно);
//   2. PNG/PDF продължават да се сервират inline (поправката не чупи нормалния преглед);
//   3. панелът НЕ създава iframe за SVG, а показва съобщение и предлага изтегляне.
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');

const PANEL_MODULES = [
  'data.js', 'icons.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'upload-progress.js', 'files-manager.js',
  'directory-panel.js', 'dashboard-panel.js', 'settings-panel.js', 'export-center.js',
  'public-gateway.js', 'visitors-panel.js', 'secret-share.js', 'report-sign.js',
];

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>hAPI</text></svg>';
// Най-малкият валиден PNG (1×1) — за да се види, че нормалният преглед работи.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

(async () => {
  const server = await startServer();
  try {
    const created = await server.api('/admin/api/portals', 'POST', { slug: 'preview-sink', title: 'Преглед', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава');
    const portal = created.data;

    const upload = async (name, bytes) => {
      const res = await server.authFetch(`${server.base}/admin/api/portals/${portal.id}/files`, {
        method: 'POST',
        headers: { 'X-File-Name': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' },
        body: bytes,
      });
      const text = await res.text();
      assert.equal(res.status, 201, `качването на ${name} минава: ` + text.slice(0, 160));
      return JSON.parse(text);
    };
    const svgFile = await upload('dokument.svg', Buffer.from(SVG, 'utf8'));
    const pngFile = await upload('karta.png', PNG);

    // ── 1. Inline SVG носи политика, която забранява скрипт ──────────────────
    const svgRes = await server.authFetch(`${server.base}/admin/api/portals/${portal.id}/files/${svgFile.id}/preview`);
    assert.equal(svgRes.status, 200, 'SVG прегледът се дава');
    assert.equal(svgRes.headers.get('content-type'), 'image/svg+xml', 'SVG е inline, не файл за сваляне');
    const csp = svgRes.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'none'/, 'SVG носи CSP с default-src none: ' + (csp || '(липсва)'));
    assert.doesNotMatch(csp, /script-src[^;]*(unsafe-inline|'self'|\*)/, 'политиката не разрешава скрипт: ' + csp);
    assert.match(csp, /frame-ancestors 'self'/, 'и не се вгражда от чужд произход');
    await svgRes.arrayBuffer();

    // ── 2. Нормалните типове не са засегнати ────────────────────────────────
    const pngRes = await server.authFetch(`${server.base}/admin/api/portals/${portal.id}/files/${pngFile.id}/preview`);
    assert.equal(pngRes.status, 200, 'PNG прегледът минава');
    assert.equal(pngRes.headers.get('content-type'), 'image/png', 'PNG е inline с правилния тип');
    await pngRes.arrayBuffer();

    // ── 3. Панелът: SVG не влиза в iframe, а казва защо ────────────────────
    const ui = mountUi(server, { modules: PANEL_MODULES });
    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portal.id;
    ui.window.FilesManagerPanel.mount(host);
    await expandPortalBlocks(host, { block: 'files' });

    // Действието се пуска ПРЕЗ ИНТЕРФЕЙСА: редът на файла се отваря (линкът с името), а после
    // се цъка „Преглед“ в панела на действията — същият път като с мишка.
    const openLink = await waitFor(
      () => host.querySelector(`[data-open-file="${svgFile.id}"]`),
      { label: 'редът на SVG файла в списъка', timeout: 15000 },
    );
    assert.ok(openLink, 'списъкът има ред за SVG файла');
    openLink.click();
    const button = await waitFor(() => host.querySelector('[data-act="preview"]'), { label: 'плочката „Преглед“', timeout: 15000 });
    assert.ok(button, 'панелът на избрания файл има „Преглед“');
    button.click();
    await waitFor(() => ui.document.body.querySelector('#fm-modal-body p.hint'), { label: 'съобщението в прозореца', timeout: 15000 });
    const modal = ui.document.body.querySelector('#fm-modal-body');
    assert.ok(!modal.querySelector('iframe'), 'за SVG НЕ се създава iframe (blob в същия произход = XSS)');
    assert.match(
      String(modal.textContent || ''),
      /SVG, HTML и XML/,
      'съобщението обяснява защо не се показва: ' + String(modal.textContent || '').slice(0, 120),
    );
    const dl = ui.document.body.querySelector('#fm-modal-dl');
    assert.ok(dl, 'остава възможност за изтегляне');

    console.log(
      'PASS preview-unsafe-types: inline SVG с CSP (default-src none, без script-src) · PNG inline както преди · ' +
        'панелът не вгражда SVG в iframe, а показва причина и предлага изтегляне',
    );
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error('FAIL preview-unsafe-types:', e && e.message);
  process.exit(1);
});
