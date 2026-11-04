'use strict';
// ВЕРИГАТА НА ЦЕЛИЯ ПРОДУКТ, ПРОВЕРЕНА ОТ КРАЯ ДО КРАЯ (0.69.147):
//
//   QR кодът  →  страницата, която той отваря  →  бутонът „Отвори папката“  →  файловете
//
// Изискването на човека: „порталът е QR кодът, който води до файловете“ и трябва да има
// БУТОН, който да го свърже с папката. Затова тук не се гледа изходният код, а се взема
// ТОЧНО адресът, който се печата в QR кода (`qrTarget` от `/admin/api/portals/<id>/api-info`),
// отваря се през HTTP и се проверява какво вижда посетителят.
//
// Тестът пада, ако:
//   • `qrTarget` не е страница (не 200 / не HTML), или сочи към API/JSON вместо портала;
//   • страницата, която QR кодът отваря, няма бутон `#folder-open`;
//   • натискането на бутона не показва файловете, които са РЕАЛНО в папката на портала;
//   • в страницата се появи `<a>` (порталът дава информация и бутони, не линкове).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { createDocument } = require('./lib/dom-stub.cjs');

const shareRoot = path.resolve('/share');

/** Монтира живата страница (адреса, който носи QR кодът) в DOM. */
async function mountAt(target) {
  const page = await fetch(target);
  assert.equal(page.status, 200, 'адресът от QR кода се отваря: ' + target + ' → ' + page.status);
  const html = await page.text();
  const bodyHtml = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
  const doc = createDocument({ lang: 'bg' });
  doc.body.innerHTML = bodyHtml;
  const url = new URL(target);
  const location = {
    protocol: url.protocol, origin: url.origin, host: url.host, pathname: url.pathname,
    search: url.search, hash: url.hash, href: target, toString: () => target,
  };
  const sandbox = {
    document: doc,
    location,
    isSecureContext: true,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    TextEncoder,
    TextDecoder,
    Blob: class Blob { constructor(parts) { this.parts = parts; this.size = 0 } },
    crypto: require('node:crypto').webcrypto,
    navigator: { clipboard: { writeText: async () => { } } },
    fetch: (u, init) => fetch(typeof u === 'string' && u.startsWith('/') ? url.origin + u : u, init),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(await (await fetch(url.origin + '/portal-i18n.js')).text(), sandbox, { filename: 'portal-i18n.js' });
  vm.runInContext(await (await fetch(url.origin + '/portal.js')).text(), sandbox, { filename: 'portal.js' });
  return { doc, location, html };
}

(async () => {
  const slug = 'qr-folder-' + Date.now().toString(36);
  const folder = path.join(shareRoot, slug);
  try { fs.rmSync(folder, { recursive: true, force: true }) } catch { /* заключен файл */ }
  const server = await startServer({ keepData: true });
  try {
    const created = await server.api('/admin/api/portals', 'POST', {
      slug,
      title: 'Портал от QR кода',
      visibility: 'public',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const portalId = created.data.id;

    // Истинските файлове на диска — това, до което QR кодът трябва да води.
    fs.mkdirSync(path.join(folder, 'архив'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'договор-2026.txt'), 'истинско съдържание', 'utf8');
    fs.writeFileSync(path.join(folder, 'архив', 'старо.txt'), 'стар файл', 'utf8');

    // ── 1. Какво точно е напечатано в QR кода ────────────────────────────────────────
    const info = await server.api(`/admin/api/portals/${portalId}/api-info`, 'GET');
    assert.equal(info.status, 200, JSON.stringify(info.data));
    const target = String(info.data.qrTarget || '');
    assert.ok(target, 'има адрес, който влиза в QR кода');
    assert.equal(/\/api\//.test(target), false, 'QR кодът НЕ води до JSON API: ' + target);
    assert.match(target, /\/p\/[0-9a-f]{16,}$/, 'QR кодът води до страницата на портала: ' + target);
    assert.match(String(info.data.qr || ''), /<svg/i, 'QR кодът е картинка (SVG), която се печата');

    // ── 2. Страницата, която QR кодът отваря, има бутон към папката ───────────────────
    const opened = await mountAt(target);
    assert.match(opened.html, /<button[^>]*id="folder-open"/, 'страницата има БУТОН „Отвори папката“');
    assert.equal(opened.doc.getElementById('hapi-boot').dataset.folders, '1', 'страницата знае, че порталът има папка');

    // Съдържанието на папката е това, което посетителят вижда (режим „папка“).
    await waitFor(
      () => opened.doc.getElementById('files').textContent.includes('договор-2026.txt'),
      { label: 'файлът от папката на страницата' },
    );

    // ── 3. Натискането на бутона води до СЪЩИТЕ файлове, без линк и без нов адрес ─────
    const btn = opened.doc.getElementById('folder-open');
    assert.equal(btn.hidden, false, 'бутонът е видим за портал със собствена папка');
    const before = opened.location.href;
    btn.click();
    await waitFor(
      () => opened.doc.getElementById('files').children.length > 0,
      { label: 'списъкът след натискането' },
    );
    const shown = opened.doc.getElementById('files').textContent;
    assert.ok(shown.includes('договор-2026.txt'), 'бутонът показва файла от папката: ' + shown.slice(0, 160));
    assert.ok(shown.includes('архив'), 'и подпапката: ' + shown.slice(0, 200));
    assert.equal(opened.location.href, before, 'натискането не сменя адреса');
    assert.equal(opened.doc.body.querySelectorAll('a').length, 0, 'в страницата няма нито един <a>');

    // ── 4. Същата папка, видяна през договора на API-то ──────────────────────────────
    const apiUrl = String(info.data.apiUrl || '');
    assert.ok(apiUrl, 'има адрес на API-то на портала');
    const tree = await fetch(apiUrl + '/tree?path=/');
    assert.equal(tree.status, 200, 'договорът за папката отговаря: ' + apiUrl + '/tree');
    const treeJson = await tree.json();
    const names = (treeJson.files || []).map((f) => f.name);
    assert.ok(names.includes('договор-2026.txt'), 'папката през API-то съдържа същия файл: ' + names.join(', '));
    assert.ok(
      (treeJson.folders || []).some((f) => f.name === 'архив'),
      'и подпапката: ' + JSON.stringify((treeJson.folders || []).map((f) => f.name)),
    );

    console.log(
      'PASS qr-leads-to-folder: QR кодът (' + target.replace(/^https?:\/\/[^/]+/, '') + ') отваря страницата с бутон ' +
      '„Отвори папката“, който показва истинските файлове от папката (' + names.join(', ') + ') без нито един <a>',
    );
  } finally {
    try { await server.api('/admin/api/portals/' + slug, 'DELETE') } catch { /* вече изтрит */ }
    try { fs.rmSync(folder, { recursive: true, force: true }) } catch { /* заключен файл */ }
    await server.stop();
  }
})().catch((err) => {
  console.error('FAIL qr-leads-to-folder:', err && err.message ? err.message : err);
  process.exitCode = 1;
});
