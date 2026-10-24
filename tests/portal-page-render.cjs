'use strict';
// ОРАКУЛ (поведенчески): страницата НАИСТИНА рисува договора — id, резюме с брой файлове,
// изписан адрес за изтегляне и работещ линк „Изтегли“.
//
// За разлика от `portal-page-contract.cjs` (който проверява сървъра и текста на кода),
// тук `portal.js` се изпълнява срещу ЖИВ сървър в тестов DOM. Така „показва N файла“ се
// проверява на резултата, а не на регулярен израз в изходния файл.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { createDocument } = require('./lib/dom-stub.cjs');

(async () => {
  const server = await startServer({ keepData: true });
  const { api, authFetch, base } = server;
  try {
    const created = await api('/admin/api/portals', 'POST', {
      slug: 'render-demo',
      title: 'Документи по дело 2026-114',
      description: 'Пълен набор от доказателства.',
      visibility: 'public',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const portalId = created.data.id;

    const upload = async (name, text) => {
      const res = await authFetch(`${base}/admin/api/portals/${portalId}/files`, {
        method: 'POST',
        headers: { 'X-File-Name': encodeURIComponent(name), 'Content-Type': 'text/plain' },
        body: text,
      });
      return res.json();
    };
    const free = await upload('dogovor.txt', 'свободен');
    const keyed = await upload('akt.pdf', 'с ключ');
    const blocked = await upload('arhiv.zip', 'забранен');
    await api(`/admin/api/portals/${portalId}/files/${keyed.id}/access`, 'PATCH', { mode: 'KEY_REQUIRED', listed: true, reason: 'тест: ключ' });
    await api(`/admin/api/portals/${portalId}/files/${blocked.id}/access`, 'PATCH', { mode: 'DISABLED', listed: true, reason: 'тест: недостъпен' });

    // ── Монтиране: истинският HTML на страницата + истинският portal.js ───────────────
    const html = await (await fetch(`${base}/p/${portalId}`)).text();
    const bodyHtml = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
    // Адресите идват от сървъра през `#hapi-boot` (data-base/data-api) — затова
    // \"бут\" е част от body и се монтира заедно с останалата страница.
    assert.ok(/id="hapi-boot"[^>]*data-api="\/api\/v1\/p\/render-demo"/.test(html), 'сървърът подава пътя на API-то на страницата');
    assert.ok(/id="hapi-boot"[^>]*data-base="http:\/\/127\.0\.0\.1:\d+"/.test(html), 'сървърът подава базовия адрес на страницата');
    const doc = createDocument({ lang: 'bg' });
    doc.body.innerHTML = bodyHtml;

    const copied = [];
    const pageUrl = `${base}/p/${portalId}`;
    const location = {
      protocol: 'http:', origin: base, host: '127.0.0.1', pathname: `/p/${portalId}`, search: '', hash: '',
      href: pageUrl, toString: () => pageUrl,
    };
    const sandbox = {
      document: doc,
      location,
      // `copy()` ползва clipboard API само в сигурен контекст; иначе пада към textarea.
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
      navigator: { clipboard: { writeText: async (text) => { copied.push(String(text)) } } },
      fetch: (url, init) => fetch(typeof url === 'string' && url.startsWith('/') ? base + url : url, init),
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    // Редът е като в portal.html: първо речникът, после страницата.
    vm.runInContext(await (await fetch(`${base}/portal-i18n.js`)).text(), sandbox, { filename: 'portal-i18n.js' });
    vm.runInContext(await (await fetch(`${base}/portal.js`)).text(), sandbox, { filename: 'portal.js' });

    await waitFor(() => doc.getElementById('files').children.length === 3, { label: 'три файла в списъка' });

    // ── PP-01: идентификаторът е изписан и се копира ─────────────────────────────────
    const idEl = doc.getElementById('portal-id');
    assert.equal(idEl.textContent, portalId, 'страницата показва id на портала');
    doc.getElementById('copy-id').click();
    await waitFor(() => copied.includes(portalId), { label: 'копиране на id' });

    // ── PP-03/PP-06: резюме с брой файлове и обем ────────────────────────────────────
    const summary = doc.getElementById('summary').textContent;
    assert.match(summary, /цялостен набор от 3 файла/, 'резюмето назовава целия набор: ' + summary);
    assert.match(summary, /общ обем/, 'резюмето казва обема');
    const chips = doc.getElementById('summary-list').children.map((el) => el.textContent);
    assert.ok(chips.includes('Файлове: 3'), 'чипът с броя файлове: ' + chips.join(' | '));
    assert.ok(chips.some((t) => t.startsWith('Общ обем: ')), 'чипът с обема');

    // ── PP-04: адресът за изтегляне е ИЗПИСАН за свободния и за файла с ключ ──────────
    const linkCodes = [...doc.body.querySelectorAll('.file-link')].map((p) => p.querySelector('code').textContent);
    assert.equal(linkCodes.length, 2, 'два файла показват адрес (забраненият — не)');
    for (const code of linkCodes) assert.match(code, /\/api\/v1\/p\/(render-demo|[0-9a-f]+)\/files\/[^/]+\/download$/);
    // Адресът е АБСОЛЮТЕН и е с базовия адрес от сървъра, а не с `location.origin`: това е
    // линкът, който посетителят копира и праща нататък (правило 6 от договора за адресите).
    for (const code of linkCodes) assert.ok(code.startsWith(base + '/api/v1/p/'), 'адресът за изтегляне е абсолютен: ' + code);
    const shownUrl = doc.getElementById('portal-url').textContent;
    assert.equal(shownUrl, `${base}/p/${portalId}`, 'изписаният адрес на портала е абсолютен и е по id');
    doc.getElementById('copy-link').click();
    await waitFor(() => copied.includes(shownUrl), { label: 'копиране на адреса на портала' });

    // ── PP-05: „Изтегли“ е истински линк с download; ключът е поле + бутон ──────────
    const anchors = doc.body.querySelectorAll('a.btn-primary').filter((a) => a.getAttribute('download'));
    assert.equal(anchors.length, 1, 'точно един свободен файл има линк за сваляне');
    assert.match(anchors[0].getAttribute('href'), new RegExp('/files/' + free.id + '/download$'));
    assert.equal(anchors[0].getAttribute('download'), 'dogovor.txt', 'сваля се с истинското име');
    const keyInputs = doc.body.querySelectorAll('input.key-input');
    assert.equal(keyInputs.length, 1, 'файлът с ключ има поле за ключ');
    assert.ok(doc.body.textContent.includes('Изтегли с ключ'), 'бутонът за ключ е изписан');

    // ── INV-6: забраненият файл не предлага нито адрес, нито бутон ──────────────────
    const blockedCard = doc.body.querySelectorAll('.file').find((li) => li.textContent.includes('arhiv.zip'));
    assert.ok(blockedCard, 'картата на забранения файл е в списъка');
    assert.equal(blockedCard.querySelectorAll('.file-link').length, 0, 'няма изписан адрес');
    assert.equal(blockedCard.querySelectorAll('a.btn-primary').length, 0, 'няма линк за сваляне');
    assert.ok(blockedCard.textContent.includes('Изтеглянето е забранено от издателя'));

    // ── INV-9: имената влизат като текст, не като HTML ───────────────────────────────
    assert.ok(doc.getElementById('files').textContent.includes('dogovor.txt'));

    // ── PP-12: пакетът се предлага само когато има какво да влезе в него ──────────
    const pkgBtn = doc.getElementById('package-btn');
    assert.equal(pkgBtn.hidden, false, 'бутонът за пакета е показан при свободен файл');
    assert.match(pkgBtn.title, /— 1 /, 'броят е само на файловете без ключ: ' + pkgBtn.title);
    assert.equal(doc.getElementById('package-note').textContent, '', 'преди натискане няма бележка за линка');

    console.log(
      'PASS portal-page-render: id изписан и копируем · резюме „цялостен набор от 3 файла“ · ' +
      '2 адреса за изтегляне · 1 линк с download · 1 поле за ключ · забраненият без адрес и бутон · ' +
      'бутон за пакет с броя на свободните файлове'
    );
  } finally {
    await server.stop({ keep: true }).catch(() => { });
    try { fs.rmSync(server.dir, { recursive: true, force: true }); } catch { /* Windows може да държи файла още */ }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
