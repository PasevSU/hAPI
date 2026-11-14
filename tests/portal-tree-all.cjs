'use strict';
// „ПОКАЖИ ВСИЧКО“ НА ПУБЛИЧНАТА СТРАНИЦА (0.69.209).
//
// Защо има тест: дотук страницата на портал със собствена папка показваше САМО текущото
// ниво — за да видиш какво има в портала, трябваше да влизаш папка по папка. Сега има един
// бутон, който разгъва ВСИЧКИ папки и файлове; тестът пази, че:
//   1. бутонът се появява само когато има дърво (портал със собствена папка);
//   2. след натискане в списъка са файловете от ВСИЧКИ нива, групирани по папка;
//   3. броячът и картата с числата казват същото, което е в списъка;
//   4. второто натискане връща текущото ниво.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { createDocument } = require('./lib/dom-stub.cjs');

async function mountPortal(base, pagePath) {
  const html = await (await fetch(base + pagePath)).text();
  const bodyHtml = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
  const doc = createDocument({ lang: 'bg' });
  doc.body.innerHTML = bodyHtml;
  const errors = [];
  const pageUrl = base + pagePath;
  const location = {
    protocol: 'http:', origin: base, host: '127.0.0.1', pathname: pagePath, search: '', hash: '',
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
    return { status: res.status, data: await res.text() };
  };
  const put = async (p, bytes) => {
    const res = await fetch(base + p, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: bytes });
    return res.status;
  };

  const made = await api('/admin/api/portals', 'POST', { slug: 'tree-all', title: 'Цялото дърво', visibility: 'public' });
  assert.equal(made.status, 201, 'порталът се създава');
  const { id } = JSON.parse(made.data);
  assert.equal(await put(`/admin/api/portals/${id}/tree/upload?path=${encodeURIComponent('/a.txt')}&mkdir=1`, 'a'), 201);
  assert.equal(await put(`/admin/api/portals/${id}/tree/upload?path=${encodeURIComponent('/Документи/b.txt')}&mkdir=1`, 'b'), 201);
  assert.equal(await put(`/admin/api/portals/${id}/tree/upload?path=${encodeURIComponent('/Документи/Под/c.txt')}&mkdir=1`, 'c'), 201);

  const { doc, errors } = await mountPortal(base, '/p/tree-all');
  const rows = () => doc.getElementById('files').children.length;
  const text = () => doc.getElementById('files').textContent;

  await waitFor(() => rows() > 0, { label: 'първоначален списък', timeout: 15000 });
  const button = doc.getElementById('tree-all');
  assert.ok(button, 'страницата има бутон „Покажи всичко“');
  assert.equal(button.hidden, false, 'бутонът се вижда при портал със собствена папка');
  // Текущото ниво: един файл в корена + една подпапка.
  assert.equal(text().includes('a.txt'), true, 'коренният файл се вижда');

  button.click();
  await waitFor(() => doc.getElementById('count').textContent.startsWith('3 '), { label: 'три файла наведнъж', timeout: 15000 });

  const all = text();
  for (const name of ['a.txt', 'b.txt', 'c.txt']) assert.ok(all.includes(name), 'в „покажи всичко“ има ' + name + ': ' + all.slice(0, 120));
  assert.ok(all.includes('/Документи'), 'групите са по папки');
  assert.ok(all.includes('/Документи/Под'), 'вложената папка също е група');
  assert.equal(doc.getElementById('stat-files').textContent, '3', 'картата брои същото, което е в списъка');
  assert.match(button.textContent, /Само тази папка/, 'бутонът сменя надписа си');

  button.click();
  await waitFor(() => doc.getElementById('count').textContent.startsWith('1 '), { label: 'обратно на ниво', timeout: 15000 });
  assert.equal(doc.getElementById('files').textContent.includes('c.txt'), false, 'в нивото на корена няма вложени файлове');
  assert.match(button.textContent, /Покажи всичко/, 'надписът се връща');

  assert.deepEqual(errors, [], 'страницата се зарежда без грешки');
  await server.stop();
  console.log('PASS portal-tree-all: бутон само при собствена папка · всички нива наведнъж · брояч = карта · връщане към ниво');
})().catch((e) => {
  console.error('FAIL portal-tree-all:', e && e.message);
  process.exit(1);
});
