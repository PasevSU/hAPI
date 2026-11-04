'use strict';
// ДОГОВОР (0.69.147): страницата на портала има БУТОН към папката на портала.
//
// Порталът е QR кодът, който води до файловете. Затова страницата, която посетителят
// отваря, не бива да е само списък с регистрирани файлове: когато порталът има СОБСТВЕНА
// папка (`/share/<нещо>`), тя се отваря с едно копче — „Отвори папката“.
//
// Проверява се РЕЗУЛТАТЪТ, не изходният код:
//   1. портал със собствена папка → сървърът обявява `data-folders="1"` и `urls.folders`
//      в JSON-а на портала, а готовата страница ПОКАЗВА копчето;
//   2. натискането на копчето води до съдържанието на папката (режим „папка“), без да
//      излиза от страницата и без нито един `<a>`;
//   3. портал в общото хранилище (`/share`) → копчето е СКРИТО: `/tree` там отговаря 403,
//      тоест копче би обещавало врата, която е заключена.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { createDocument } = require('./lib/dom-stub.cjs');

const shareRoot = path.resolve('/share');

/** Монтира живата страница на портала в DOM и връща {doc, location, base}. */
async function mountPortal(base, portalId) {
  const page = await (await fetch(`${base}/p/${portalId}`)).text();
  const bodyHtml = page.slice(page.indexOf('<body>') + '<body>'.length, page.indexOf('</body>'));
  const doc = createDocument({ lang: 'bg' });
  doc.body.innerHTML = bodyHtml;
  const pageUrl = `${base}/p/${portalId}`;
  const location = {
    protocol: 'http:', origin: base, host: '127.0.0.1', pathname: `/p/${portalId}`, search: '', hash: '',
    href: pageUrl, toString: () => pageUrl,
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
    fetch: (url, init) => fetch(typeof url === 'string' && url.startsWith('/') ? base + url : url, init),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(await (await fetch(`${base}/portal-i18n.js`)).text(), sandbox, { filename: 'portal-i18n.js' });
  vm.runInContext(await (await fetch(`${base}/portal.js`)).text(), sandbox, { filename: 'portal.js' });
  return { doc, location, page };
}

(async () => {
  const stamp = Date.now().toString(36);
  const withFolder = 'folderbtn-' + stamp;
  const shared = 'nofolderbtn-' + stamp;
  for (const name of [withFolder, shared]) {
    try { fs.rmSync(path.join(shareRoot, name), { recursive: true, force: true }) } catch { /* заключен файл */ }
  }
  const server = await startServer({ keepData: true });
  const { api, base } = server;
  try {
    // ── 1. Портал със СОБСТВЕНА папка ─────────────────────────────────────────────────
    const created = await api('/admin/api/portals', 'POST', {
      slug: withFolder,
      title: 'Портал с папка',
      visibility: 'public',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const portalId = created.data.id;

    const folder = path.join(shareRoot, withFolder);
    fs.mkdirSync(path.join(folder, 'архив'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'договор.txt'), 'съдържание', 'utf8');

    // Сървърът обявява папката и в JSON-а (URL-ите), и в `#hapi-boot` (за самата страница).
    const payload = await (await fetch(`${base}/api/v1/p/${withFolder}`)).json();
    assert.equal(payload.urls.folders, '1', 'публичният JSON обявява, че порталът има папка');

    const { doc, location } = await mountPortal(base, portalId);
    assert.equal(
      doc.getElementById('hapi-boot').dataset.folders,
      '1',
      'страницата е в режим „папка“ (data-folders="1")',
    );
    // Съдържанието на папката е на страницата — това е, което QR кодът обещава.
    await waitFor(() => doc.getElementById('files').children.length >= 1, { label: 'файлът от папката' });
    assert.ok(
      doc.getElementById('files').textContent.includes('договор.txt'),
      'страницата показва файла от папката: ' + doc.getElementById('files').textContent.slice(0, 160),
    );

    // ── 2. Копчето е ВИДИМО и води до папката ────────────────────────────────────────
    const btn = doc.getElementById('folder-open');
    assert.ok(btn, 'страницата има копче #folder-open');
    assert.equal(btn.hidden, false, 'копчето към папката е видимо за портал със собствена папка');
    assert.match(btn.textContent, /папката/i, 'етикетът казва, че води към папката: ' + btn.textContent.trim());

    const before = location.href;
    btn.click();
    // Натискането НЕ напуска страницата и НЕ създава линк — то показва съдържанието.
    await waitFor(() => doc.getElementById('files').children.length >= 1, { label: 'списъкът остава' });
    assert.equal(location.href, before, 'копчето не сменя адреса');
    assert.equal(doc.body.querySelectorAll('a').length, 0, 'в страницата няма нито един <a>');
    assert.equal(doc.getElementById('doc-info').hidden, true, 'информационният панел остава скрит');

    // ── 3. Портал в ОБЩОТО хранилище → копчето е скрито ──────────────────────────────
    const plain = await api('/admin/api/portals', 'POST', {
      slug: shared,
      title: 'Портал без собствена папка',
      visibility: 'public',
      storage_root: '/share',
    });
    assert.equal(plain.status, 201, JSON.stringify(plain.data));
    const plainPayload = await (await fetch(`${base}/api/v1/p/${shared}`)).json();
    assert.equal(plainPayload.urls.folders, '0', 'общото хранилище не се обявява като папка');

    const plainPage = await mountPortal(base, plain.data.id);
    await waitFor(() => plainPage.doc.getElementById('status').hidden === true, { label: 'страницата се зарежда' });
    assert.equal(
      plainPage.doc.getElementById('folder-open').hidden,
      true,
      'за портал в /share копчето е скрито (там /tree отговаря 403)',
    );
  } finally {
    for (const slug of [withFolder, shared]) {
      try { await api('/admin/api/portals/' + slug, 'DELETE') } catch { /* вече изтрит */ }
      try { fs.rmSync(path.join(shareRoot, slug), { recursive: true, force: true }) } catch { /* заключен файл */ }
    }
    await server.stop();
  }
  console.log(
    'PASS portal-folder-button: копчето „Отвори папката“ е видимо за портал със собствена папка, ' +
    'показва съдържанието без линк, и е скрито за портал в общото хранилище',
  );
})().catch((err) => {
  console.error('FAIL portal-folder-button:', err && err.message ? err.message : err);
  process.exitCode = 1;
});
