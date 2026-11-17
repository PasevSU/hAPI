'use strict';
// QR ЗА ВСЕКИ ВЪЗЕЛ: ПОРТАЛ, ПАПКА И ФАЙЛ — САМИ, БЕЗ ОТДЕЛНО ДЕЙСТВИЕ (0.69.210).
//
// Заявката на собственика: „всеки портал трябва да има множество QR — към цялостната папка /
// портала, към подпапка или към файл; всичко това трябва да се създава автоматично“.
// Дотук кодът имаше едно място (затворен DEF-31 „един QR на портал“), а сървърът даваше код
// само за портала и за папка. Тестът пази новия договор:
//   • един маршрут обслужва ВСЕКИ възел: `…/tree/qr.svg?path=/<rel>` (корен, папка, файл);
//   • папка/корен → публичната страница с `?folder=<rel>`; файл → `/file.html:<slug>/<rel>`;
//   • скрита/заключена папка НЕ дава код (иначе кодът води до отказ);
//   • портал без собствена папка (/share, /media) → 403, както при списъка;
//   • трите кода са РАЗЛИЧНИ помежду си (различен адрес → различен код);
//   • сървърът строи SVG-то със същия построител (`qr-svg.js`), не с втори.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');
const qrSvgLib = require(path.join(__dirname, '..', 'hapi_enterprise', 'qr-svg.js'));

const PANEL_MODULES = [
  'data.js', 'icons.js', 'report-studio.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'files-manager.js', 'directory-panel.js',
  'dashboard-panel.js', 'settings-panel.js', 'export-center.js', 'public-gateway.js',
  'visitors-panel.js', 'secret-share.js', 'report-sign.js',
];

(async () => {
  const server = await startServer();
  const base = server.base;
  const token = server.token;
  const api = async (p, method = 'GET', body) => {
    const res = await fetch(base + p, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.text() };
  };
  const put = async (p, bytes) => {
    const res = await fetch(base + p, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: bytes });
    return res.status;
  };
  const qr = async (slug, rel) => {
    const res = await fetch(base + `/api/v1/p/${slug}/tree/qr.svg?path=${encodeURIComponent('/' + rel)}`);
    return { status: res.status, type: res.headers.get('Content-Type') || '', body: res.status === 200 ? await res.text() : '' };
  };

  try {
    // ── Портал със собствена папка: файл в корена и вложена папка с файл ──────
    const made = await api('/admin/api/portals', 'POST', { slug: 'qr-levels', title: 'QR нива', visibility: 'public' });
    assert.equal(made.status, 201, 'порталът се създава: ' + made.data);
    const { id } = JSON.parse(made.data);
    assert.equal(await put(`/admin/api/portals/${id}/tree/upload?path=${encodeURIComponent('/koren.txt')}&mkdir=1`, 'a'), 201);
    assert.equal(await put(`/admin/api/portals/${id}/tree/upload?path=${encodeURIComponent('/Dogovori/vatreshno.txt')}&mkdir=1`, 'b'), 201);

    // ── 1. Корен, папка и файл дават код ─────────────────────────────────────
    const root = await qr('qr-levels', '');
    const folder = await qr('qr-levels', 'Dogovori');
    const file = await qr('qr-levels', 'Dogovori/vatreshno.txt');
    for (const [label, res] of [['корен', root], ['папка', folder], ['файл', file]]) {
      assert.equal(res.status, 200, `кодът за ${label} се дава: ` + res.status);
      assert.match(res.type, /image\/svg\+xml/, `кодът за ${label} е SVG: ` + res.type);
      assert.match(res.body, /<svg/, `кодът за ${label} съдържа SVG`);
    }

    // ── 2. Различни адреси → различни кодове ─────────────────────────────────
    assert.notEqual(root.body, folder.body, 'коренът и папката НЕ бива да имат един и същ код');
    assert.notEqual(folder.body, file.body, 'папката и файлът НЕ бива да имат един и същ код');

    // ── 3. Адресът в кода е ПУБЛИЧНАТА страница, не API-то ───────────────────
    const folderTarget = `${base}/p/${id}?folder=${encodeURIComponent('Dogovori').replace(/%2F/g, '/')}`;
    assert.equal(folder.body, qrSvgLib.svg(folderTarget), 'кодът на папката сочи страницата с ?folder=' + folderTarget);
    const fileTarget = `${base}/file.html:qr-levels/${['Dogovori', 'vatreshno.txt'].map(encodeURIComponent).join('/')}`;
    assert.equal(file.body, qrSvgLib.svg(fileTarget), 'кодът на файла сочи страницата на файла: ' + fileTarget);

    // ── 4. Скрита / заключена папка не дава код ──────────────────────────────
    const hidden = await api(`/admin/api/portals/${id}/tree/folder`, 'PATCH', { path: 'Dogovori', visible: false });
    assert.equal(hidden.status, 200, 'флагът „скрита“ се записва: ' + hidden.data);
    const hiddenQr = await qr('qr-levels', 'Dogovori');
    assert.equal(hiddenQr.status, 404, 'скрита папка не дава код: ' + hiddenQr.status);

    // ── 5. Портал без собствена папка → 403 (същото като списъка) ────────────
    const shared = await api('/admin/api/portals', 'POST', { slug: 'qr-levels-shared', title: 'Обща', visibility: 'public', storage_root: '/share' });
    assert.equal(shared.status, 201, 'порталът с общ корен се създава: ' + shared.data);
    const sharedQr = await qr('qr-levels-shared', '');
    assert.equal(sharedQr.status, 403, 'общият /share не се публикува: ' + sharedQr.status);

    // ── 6. Непознат път → 404, а не код към нищото ───────────────────────────
    const missing = await qr('qr-levels', 'Nyama-takava');
    assert.equal(missing.status, 404, 'липсващият път е 404: ' + missing.status);

    // ── 7. Панелът: кодът за всяко ниво се появява САМ, без отделно действие ──
    // Порталът от горните стъпки има файл в корена и папка с файл; отваряме блока „Папки
    // на портала“ и искаме ред за ВСЯКО ниво, чието изображение идва от сървъра.
    const ui = mountUi(server, { modules: PANEL_MODULES });
  const host = ui.container();
  ui.window.FilesManagerPanel.state.openPortal = id;
  ui.window.FilesManagerPanel.mount(host);
  await expandPortalBlocks(host, { block: 'folders' });
  // 0.69.229: нивата НЕ се рисуват в блока с папките — те са в глобалното QR студио, което
  // отваря брошката в главата на картата. Искаме ред за ВСЯКО ниво: корен, подпапка и файл.
  const qrBtn = await waitFor(() => host.querySelector('[data-qr-portal]'), { label: 'QR бутонът на картата', timeout: 15000 });
  qrBtn.click();
  const studio = await waitFor(() => ui.window.document.getElementById('qs-modal'), { label: 'прозореца на студиото', timeout: 15000 });
  studio.querySelector('[data-qs-tab="levels"]').click();
  const rows = await waitFor(
    () => {
      const found = [...studio.querySelectorAll('[data-qs-level]')];
      return found.length >= 3 ? found : null;
    },
    { label: 'QR редове за всяко ниво', timeout: 15000 },
  );
  assert.ok(rows.length >= 3, 'има ред за всяко ниво: ' + rows.length);
  // Всяко ниво носи ГОТОВ публичен адрес, а не администраторски път.
    const captions = rows.map((r) => String((r.querySelector('.qs-card[data-url]') || { getAttribute: () => '' }).getAttribute('data-url') || '').trim());
  assert.ok(captions.every((c) => /\/p\/|file\.html/.test(c)), 'всяко ниво носи публичен адрес: ' + captions.join(' | '));
  assert.equal(captions.some((c) => /admin\/api/.test(c)), false, 'нивата не сочат към административния API');
  assert.equal(new Set(captions).size >= 3, true, 'трите нива имат РАЗЛИЧНИ адреси');
  assert.ok(captions.some((c) => c.includes('folder=')), 'адресът на папката носи ?folder=');
  // Сървърният договор остава: кодът за всяко ниво се дава от tree/qr.svg с подписа.
  const manager = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', 'files-manager.js'), 'utf8');
  assert.match(manager, /\/tree\/qr\.svg\?\$\{qs\}/, 'кодът на ниво идва от сървъра (tree/qr.svg)');
  assert.match(manager, /const own = accessOf\(p\)\.query/, 'подписът влиза в адреса на кода');
  console.log('PASS portal-qr-levels: код за корен, папка и файл · различни адреси · публичната страница, не API · скрито → 404 · общ корен → 403 · панелът ги рисува сам');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error('FAIL portal-qr-levels:', e && e.message);
  process.exit(1);
});
