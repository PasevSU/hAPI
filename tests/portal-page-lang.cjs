'use strict';
// Публичната страница на ЧУЖД език (PP-14): `?lang=en`, `?lang=de`, избор от посетителя
// и падане към български при непознат език. Проверява се РЕАЛНИЯТ portal.js в DOM —
// не речникът сам по себе си (той има отделен тест).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { createDocument } = require('./lib/dom-stub.cjs');

const CYRILLIC = /[А-Яа-яЁё]/;
const text = (el) => String(el.textContent || '').replace(/\s+/g, ' ').trim();

/** Монтира страницата за даден език (както я отваря браузърът). */
async function mountPage(base, portalId, lang, { savedLang } = {}) {
  // Истинският HTML на страницата — с него идват и data-i18n ключовете.
  const pageHtml = await (await fetch(base + '/p/' + portalId)).text();
  const bodyHtml = pageHtml.slice(pageHtml.indexOf('<body>') + '<body>'.length, pageHtml.indexOf('</body>'));
  const doc = createDocument({ lang: 'bg' });
  doc.body.innerHTML = bodyHtml;
  const store = new Map();
  if (savedLang) store.set('hapi.portalLang', savedLang);
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    _map: store,
  };
  const query = lang ? '?lang=' + encodeURIComponent(lang) : '';
  const location = {
    protocol: 'http:',
    origin: base,
    pathname: '/p/' + portalId,
    href: base + '/p/' + portalId + query,
    search: query,
    hash: '',
  };
  const sandbox = {
    document: doc,
    location,
    localStorage,
    isSecureContext: true,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    TextEncoder,
    TextDecoder,
    Blob: class Blob {
      constructor(parts) { this.parts = parts; this.size = 0 }
    },
    navigator: { clipboard: { writeText: async () => { } } },
    fetch: (url, init) => fetch(typeof url === 'string' && url.startsWith('/') ? base + url : url, init),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // Редът е същият като в portal.html: речникът, после страницата.
  for (const file of ['/portal-i18n.js', '/portal.js']) {
    const res = await fetch(base + file);
    assert.equal(res.status, 200, file + ' се сервира');
    vm.runInContext(await res.text(), sandbox, { filename: file.slice(1) });
  }
  return { doc, sandbox, store };
}

/** Текст на страницата без избора на език (имената на езиците са кирилски по природа). */
const pageText = (doc) =>
  ['main', 'title', 'visibility', 'copy-link', 'copy-id', 'api-link', 'manifest-link', 'foot-note']
    .map((id) => text(doc.getElementById(id)))
    .join(' ');

(async () => {
  const server = await startServer();
  // 0.69.78: порталът получава СОБСТВЕНА папка `/share/<slug>`. Остатъци от предишен
  // пуск (или от паралелен тест) карат страницата да покаже файловете на ПАПКАТА
  // вместо регистрираните два → чистенето тук прави броя им предвидим.
  const shareDir = path.resolve('/share', 'lang-demo');
  try { fs.rmSync(shareDir, { recursive: true, force: true }) } catch { /* заключен файл на Windows */ }
  try {
    const portal = (await server.api('/admin/api/portals', 'POST', { slug: 'lang-demo', title: 'Report Portal' })).data;
    assert.equal((await server.api('/admin/api/portals/' + portal.id, 'PATCH', { visibility: 'public' })).status, 200);
    for (const name of ['dogovor.pdf', 'prilozhenie.docx']) {
      const res = await server.authFetch(server.base + '/admin/api/portals/' + portal.id + '/files', {
        method: 'POST',
        headers: { 'x-file-name': name, 'content-type': 'text/plain', 'x-file-encrypt': '0' },
        body: 'съдържание',
      });
      assert.equal(res.status, 201);
    }

    console.log('· ?lang=en — страницата е на английски, не на български');
    {
      const { doc } = await mountPage(server.base, portal.id, 'en');
      await waitFor(() => doc.getElementById('files').children.length === 2, { label: 'двата файла', timeout: 30000 });
      assert.equal(doc.documentElement.getAttribute('lang'), 'en', '<html lang="en">');
      assert.equal(doc.getElementById('lang').value, 'en', 'изборът показва английски');
      const summary = text(doc.getElementById('summary'));
      assert.match(summary, /complete set of 2 documents/, 'резюмето е на английски: ' + summary);
      assert.match(summary, /total size of/, 'обемът е назован: ' + summary);
      assert.match(text(doc.getElementById('files-title')), /Documents/, 'заглавието на списъка е английско');
      assert.match(text(doc.getElementById('summary-title')), /What this portal contains/);
      assert.match(text(doc.getElementById('qr-title')), /QR code/);
      assert.match(text(doc.getElementById('copy-link')), /Copy address/);
      assert.match(text(doc.getElementById('visibility')), /Portal for/, 'порталът се назовава по вид');
      const body = pageText(doc);
      if (CYRILLIC.test(body)) {
        const found = [];
        const walk = (node) => {
          for (const child of node.children || []) {
            const own = String(child.textContent || '');
            if (CYRILLIC.test(own) && (!child.children || child.children.length === 0)) {
              found.push((child.id ? '#' + child.id : child.tagName || '?') + ' → ' + own.slice(0, 80));
            }
            walk(child);
          }
        };
        walk(doc.getElementById('main'));
        assert.fail('останала кирилица в съдържанието: ' + JSON.stringify(found.slice(0, 6)));
      }
    }

    console.log('· ?lang=de — немски, с правилно множествено число');
    {
      const { doc } = await mountPage(server.base, portal.id, 'de');
      await waitFor(() => doc.getElementById('files').children.length === 2, { label: 'двата файла (de)', timeout: 30000 });
      assert.equal(doc.documentElement.getAttribute('lang'), 'de');
      const summary = text(doc.getElementById('summary'));
      assert.match(summary, /vollständiger Satz von 2 Dokumente/, 'резюмето е на немски: ' + summary);
      assert.match(text(doc.getElementById('count')), /^2 Dokumente$/, 'броячът е на немски: ' + text(doc.getElementById('count')));
      assert.equal(CYRILLIC.test(pageText(doc)), false, 'немската страница е без кирилица');
    }

    console.log('· непознат език пада към български, а не към празна страница');
    {
      const { doc } = await mountPage(server.base, portal.id, 'fr');
      await waitFor(() => doc.getElementById('files').children.length === 2, { label: 'двата файла (fr→bg)', timeout: 30000 });
      assert.equal(doc.documentElement.getAttribute('lang'), 'bg', 'fr не се приема');
      assert.match(text(doc.getElementById('summary')), /цялостен набор от 2 документа/, 'страницата е на български: ' + text(doc.getElementById('summary')));
    }

    console.log('· изборът на език работи веднага и се запазва');
    {
      const { doc, store } = await mountPage(server.base, portal.id, 'bg');
      await waitFor(() => doc.getElementById('files').children.length === 2, { label: 'двата файла (bg)', timeout: 30000 });
      assert.match(text(doc.getElementById('summary')), /цялостен набор/, 'начално е български');
      const select = doc.getElementById('lang');
      select.value = 'en';
      select.dispatch('change');
      assert.equal(doc.documentElement.getAttribute('lang'), 'en', 'езикът се сменя без презареждане');
      assert.match(text(doc.getElementById('summary')), /complete set of 2 documents/, 'текстовете са преизчислени: ' + text(doc.getElementById('summary')));
      assert.equal(store.get('hapi.portalLang'), 'en', 'изборът се запазва за следващото отваряне');
      assert.equal(doc.getElementById('lang').value, 'en', 'изборът остава избран');
      // Смяна на втори език — без натрупване на преводи един върху друг.
      select.value = 'de';
      select.dispatch('change');
      assert.equal(doc.documentElement.getAttribute('lang'), 'de');
      assert.match(text(doc.getElementById('summary')), /vollständiger Satz/, 'вторият избор също работи');
      assert.equal(text(doc.getElementById('summary')).includes('complete set'), false, 'английският не е останал');
    }

    console.log('· запазеният избор се прилага при следващо отваряне без ?lang');
    {
      const { doc } = await mountPage(server.base, portal.id, '', { savedLang: 'de' });
      await waitFor(() => doc.getElementById('files').children.length === 2, { label: 'двата файла (запазен de)', timeout: 30000 });
      assert.equal(doc.documentElement.getAttribute('lang'), 'de', 'запазеният език печели пред подразбирането');
      assert.match(text(doc.getElementById('files-title')), /Dokumente/, 'списъкът е на немски');
    }

    console.log('PASS portal-page-lang: ?lang=en/de · избор от посетителя без презареждане · запазен избор · непознат език → български · без остатъчна кирилица');
  } finally {
    await server.stop().catch(() => { });
    try { fs.rmSync(shareDir, { recursive: true, force: true }) } catch { /* Linux */ }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
