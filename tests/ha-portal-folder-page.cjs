'use strict';
// СТРАНИЦАТА НА ПОРТАЛА, КОЯТО ИНТЕГРАЦИЯТА СЕРВИРА (0.69.147) — с РАБОТЕЩА папка.
//
// Интеграцията има собствен изглед `/api/hapi_enterprise/portal/<slug>` (изискван от
// `ha-integration-flow.cjs`). Порталът е QR кодът, който води до файловете, затова и тази
// страница има бутон „Отвори папката“ — и той трябва НАИСТИНА да показва папката.
//
// Тук страницата се монтира срещу ЖИВ сървър: заявките ѝ (`/api/hapi_enterprise/v1/p/<slug>/…`)
// се пренасочват към истинското API на add-on-а (`/api/v1/p/<slug>/…`), тоест преценява се
// поведението на самата страница — профил, списък, режим „папка“, връщане назад.
//
// Пада, ако:
//   • бутонът е видим за портал БЕЗ собствена папка (там `/tree` отговаря 403);
//   • натискането не показва файловете от папката;
//   • връщането не възстановява регистрираните файлове;
//   • ключът на портала попадне в адрес (договорът: само фрагмент/заглавие).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { createDocument } = require('./lib/dom-stub.cjs');

const ROOT = path.join(__dirname, '..');
const INT = path.join(ROOT, 'custom_components', 'hapi_enterprise');
const shareRoot = path.resolve('/share');

/** Монтира страницата на интеграцията; заявките ѝ отиват в истинското API на add-on-а. */
function mountIntegrationPortal(server, slug) {
  const doc = createDocument({ lang: 'bg' });
  doc.body.innerHTML = fs
    .readFileSync(path.join(INT, 'portal.html'), 'utf8')
    .replace(/^[\s\S]*<body>/, '')
    .replace(/<\/body>[\s\S]*$/, '');
  const origin = server.base;
  const location = {
    protocol: 'http:', origin, host: '127.0.0.1',
    pathname: '/api/hapi_enterprise/portal/' + slug,
    search: '', hash: '',
    href: origin + '/api/hapi_enterprise/portal/' + slug,
  };
  // Мостът на интеграцията: `/api/hapi_enterprise/v1/…` → `/api/v1/…` на add-on-а.
  const bridge = (url, init = {}) => {
    const target = String(url).replace('/api/hapi_enterprise/v1/', '/api/v1/');
    return server.authFetch(origin + target, init);
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
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Blob: class Blob {
      constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; this.size = 0 }
      async arrayBuffer() { return new ArrayBuffer(0) }
    },
    crypto: require('node:crypto').webcrypto,
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: (url, init) => (String(url).startsWith('/') ? bridge(url, init) : fetch(url, init)),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(INT, 'portal.js'), 'utf8'), sandbox, { filename: 'portal.js' });
  return { doc, location };
}

(async () => {
  const stamp = Date.now().toString(36);
  const withFolder = 'hafolder-' + stamp;
  const shared = 'hashared-' + stamp;
  for (const name of [withFolder, shared]) {
    try { fs.rmSync(path.join(shareRoot, name), { recursive: true, force: true }) } catch { /* заключен */ }
  }
  const server = await startServer({ keepData: true });
  try {
    // ── 1. Портал със СОБСТВЕНА папка ────────────────────────────────────────────────
    const made = await server.api('/admin/api/portals', 'POST', {
      slug: withFolder,
      title: 'Портал на интеграцията',
      visibility: 'public',
    });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const folder = path.join(shareRoot, withFolder);
    fs.mkdirSync(path.join(folder, 'архив'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'протокол.txt'), 'съдържание', 'utf8');

    const page = mountIntegrationPortal(server, withFolder);
    // Страницата първо показва портала (той няма регистрирани файлове), после — папката.
    await waitFor(() => page.doc.getElementById('title').textContent === 'Портал на интеграцията', {
      label: 'заглавието на портала',
    });
    const btn = page.doc.getElementById('folder-open');
    assert.ok(btn, 'страницата има копче #folder-open');
    assert.equal(btn.hidden, false, 'копчето е видимо: сървърът обявява собствена папка (urls.folders=1)');

    btn.click();
    await waitFor(
      () => page.doc.getElementById('files').textContent.includes('протокол.txt'),
      { label: 'съдържанието на папката' },
    );
    const shown = page.doc.getElementById('files').textContent;
    assert.ok(shown.includes('архив'), 'показва и подпапката: ' + shown.slice(0, 160));
    assert.match(btn.textContent, /Регистрирани файлове/, 'копчето казва как се връща назад: ' + btn.textContent.trim());
    assert.match(page.doc.getElementById('files-title').textContent, /^Папка/, 'заглавието казва, че това е папката');
    assert.equal(page.doc.body.querySelectorAll('a').length, 0, 'в страницата няма нито един <a>');
    assert.equal(
      /token=|\?key=/.test(page.location.href),
      false,
      'ключът не влиза в адреса: ' + page.location.href,
    );

    // ── 2. Връщане към регистрираните файлове ───────────────────────────────────────
    btn.click();
    await waitFor(
      () => !page.doc.getElementById('files').textContent.includes('протокол.txt'),
      { label: 'връщане към регистрираните файлове' },
    );
    assert.match(btn.textContent, /Отвори папката/, 'копчето пак води към папката: ' + btn.textContent.trim());

    // ── 3. Портал в ОБЩОТО хранилище → копчето е скрито ─────────────────────────────
    const plain = await server.api('/admin/api/portals', 'POST', {
      slug: shared,
      title: 'Портал без собствена папка',
      visibility: 'public',
      storage_root: '/share',
    });
    assert.equal(plain.status, 201, JSON.stringify(plain.data));
    const plainPage = mountIntegrationPortal(server, shared);
    await waitFor(() => plainPage.doc.getElementById('title').textContent === 'Портал без собствена папка', {
      label: 'вторият портал',
    });
    assert.equal(
      plainPage.doc.getElementById('folder-open').hidden,
      true,
      'за портал в /share копчето е скрито (/tree там отговаря 403)',
    );

    console.log(
      'PASS ha-portal-folder-page: интеграционната страница показва „Отвори папката“ само за портал със собствена папка, ' +
      'натискането води до истинските файлове (протокол.txt, архив) и връща към регистрираните — без <a> и без ключ в адреса',
    );
  } finally {
    for (const slug of [withFolder, shared]) {
      try { await server.api('/admin/api/portals/' + slug, 'DELETE') } catch { /* вече изтрит */ }
      try { fs.rmSync(path.join(shareRoot, slug), { recursive: true, force: true }) } catch { /* заключен */ }
    }
    await server.stop();
  }
})().catch((err) => {
  console.error('FAIL ha-portal-folder-page:', err && err.message ? err.message : err);
  process.exitCode = 1;
});
