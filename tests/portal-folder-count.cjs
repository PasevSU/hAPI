'use strict';
// БРОЯТ В РЕЖИМ „ПАПКА“ Е ДОГОВОР (0.69.209).
//
// Защо има тест: страницата на портал със СОБСТВЕНА папка се отваря направо в папката.
// Дотук редът с броя казваше „1 файл“ за ЕДНА ПАПКА, а картата с числата казваше 0 —
// посетителят четеше „файловете не са се заредили“, макар да са в подпапка. Тестът иска:
//   1. файловете и папките се броят РАЗДЕЛНО;
//   2. картата с числата брои СЪЩОТО, което е в списъка (диск + регистрирани извън папката);
//   3. когато файловете са само в подпапки, страницата го КАЗВА.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { createDocument } = require('./lib/dom-stub.cjs');

/** Монтира истинската страница на портала с истинския portal.js (както я вижда посетителят). */
async function mountPortal(base, pagePath, token) {
  const html = await (await fetch(base + pagePath)).text();
  assert.equal(html.includes('id="files"'), true, 'страницата има списък с файлове');
  const bodyHtml = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
  const doc = createDocument({ lang: 'bg' });
  doc.body.innerHTML = bodyHtml;
  const errors = [];
  const pageUrl = base + pagePath;
  const location = {
    protocol: 'http:', origin: base, host: '127.0.0.1', pathname: pagePath,
    search: pagePath.includes('?') ? pagePath.slice(pagePath.indexOf('?')) : '', hash: '',
    href: pageUrl, toString: () => pageUrl,
  };
  const sandbox = {
    document: doc,
    location,
    isSecureContext: true,
    console: { log() { }, warn() { }, error: (...a) => errors.push(a.join(' ')) },
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, TextEncoder, TextDecoder,
    Blob: class { constructor(parts) { this.parts = parts; this.size = 0 } },
    crypto: require('node:crypto').webcrypto,
    navigator: { clipboard: { writeText: async () => { } } },
    fetch: (url, init) => fetch(typeof url === 'string' && url.startsWith('/') ? base + url : url, init),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(await (await fetch(base + '/portal-i18n.js')).text(), sandbox, { filename: 'portal-i18n.js' });
  vm.runInContext(await (await fetch(base + '/portal.js')).text(), sandbox, { filename: 'portal.js' });
  void token;
  return { doc, errors };
}

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
    const text = await res.text();
    return { status: res.status, data: JSON.parse(text) };
  };
  const put = async (p, data) => {
    const res = await fetch(base + p, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: data,
    });
    return { status: res.status, data: await res.text() };
  };

  // ── 1. Портал със собствена папка: регистриран файл + файл В ПОДПАПКА ──────────
  const one = await api('/admin/api/portals', 'POST', { slug: 'count-one', title: 'С папка', visibility: 'public', storageRoot: '/share/count-one' });
  assert.equal(one.status, 201, 'порталът се създава: ' + JSON.stringify(one.data));
  const registered = await fetch(`${base}/admin/api/portals/${one.data.id}/files`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'X-File-Name': 'registriran.txt' },
    body: 'hello',
  });
  assert.equal(registered.status, 201, 'регистрираният файл се качва');
  const nested = await put(`/admin/api/portals/${one.data.id}/tree/upload?path=${encodeURIComponent('/Документи/vapreki.txt')}&mkdir=1`, 'hello');
  assert.equal(nested.status, 201, 'файлът в подпапката се качва: ' + nested.data.slice(0, 120));

  const a = await mountPortal(base, '/p/count-one');
  await waitFor(() => a.doc.getElementById('files').children.length >= 2, { label: 'два реда в списъка', timeout: 15000 });

  const countText = a.doc.getElementById('count').textContent;
  // Съществителното следва съдържанието („1 файл“, „1 документ“) — важното е числото и редът.
  assert.match(countText, /^1 (файл|документ|снимка|архив|медиен файл)/, '#count казва колко ФАЙЛА има: ' + countText);
  assert.match(countText, /папки: 1/, '#count разделя папките от файловете: ' + countText);
  assert.equal(a.doc.getElementById('stat-files').textContent, '1', 'картата брои същите файлове като списъка');
  assert.equal(a.doc.getElementById('stat-folders').textContent, '1', 'картата брои папките');
  assert.equal(a.doc.getElementById('status').textContent, '', 'щом има файл, статусът мълчи');
  assert.deepEqual(a.errors, [], 'страницата се зарежда без грешки');

  // ── 2. Само подпапки: страницата КАЗВА къде са файловете ───────────────────────
  const two = await api('/admin/api/portals', 'POST', { slug: 'count-two', title: 'Само папки', visibility: 'public', storageRoot: '/share/count-two' });
  assert.equal(two.status, 201);
  const onlySub = await put(`/admin/api/portals/${two.data.id}/tree/upload?path=${encodeURIComponent('/Архив/x.txt')}&mkdir=1`, 'hello');
  assert.equal(onlySub.status, 201);

  const b = await mountPortal(base, '/p/count-two');
  await waitFor(() => b.doc.getElementById('files').children.length >= 1, { label: 'реда на папката', timeout: 15000 });
  const countB = b.doc.getElementById('count').textContent;
  assert.match(countB, /0 файла/, 'броят файлове е нула на това ниво: ' + countB);
  assert.match(countB, /папки: 1/, 'но папката се брои: ' + countB);
  assert.match(
    b.doc.getElementById('status').textContent,
    /подпапките/,
    'страницата казва, че файловете са в подпапките: ' + b.doc.getElementById('status').textContent,
  );
  assert.equal(b.doc.getElementById('stat-files').textContent, '0', 'картата не лъже за файлове');
  assert.equal(b.doc.getElementById('stat-folders').textContent, '1');
  assert.deepEqual(b.errors, [], 'страницата се зарежда без грешки');

  await server.stop();
  console.log('PASS portal-folder-count: файлове и папки се броят разделно · картата = списъкът · подпапките се обясняват');
})().catch((e) => {
  console.error('FAIL portal-folder-count:', e && e.message);
  process.exit(1);
});
