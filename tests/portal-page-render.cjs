'use strict';
// ОРАКУЛ (поведенчески): страницата НАИСТИНА рисува договора — id, резюме с брой файлове,
// бутон за копиране на адреса, панел с информацията и бутон „Изтегли“.
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
  // Порталът получава СОБСТВЕНА папка `/share/<slug>` и се отваря в режим „папка“.
  // Остатъци от предишно пускане (или от паралелен тест) добавят чужди карти към
  // списъка — затова тук папката се изчиства, преди да се създаде порталът.
  const shareDir = path.resolve('/share', 'render-demo');
  try { fs.rmSync(shareDir, { recursive: true, force: true }) } catch { /* заключен файл на Windows */ }
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
    await upload('dogovor.txt', 'свободен');
    const keyed = await upload('akt.pdf', 'с ключ');
    const blocked = await upload('arhiv.zip', 'забранен');
    await api(`/admin/api/portals/${portalId}/files/${keyed.id}/access`, 'PATCH', { mode: 'KEY_REQUIRED', listed: true, reason: 'тест: ключ' }).then((r) =>
      assert.equal(r.status, 200, 'файлът става KEY_REQUIRED: ' + JSON.stringify(r.data)),
    );
    await api(`/admin/api/portals/${portalId}/files/${blocked.id}/access`, 'PATCH', { mode: 'DISABLED', listed: true, reason: 'тест: недостъпен' }).then((r) =>
      assert.equal(r.status, 200, 'файлът става DISABLED: ' + JSON.stringify(r.data)),
    );

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

    // ── PP-04: адресът НЕ е изписан; дава се бутон „Копирай адреса“ ──────────────────
    // До 0.69.140 тук се проверяваше, че адресът за изтегляне е изписан като текст. Това
    // беше „сайт с линкове“: посетителят трябваше да го копира сам. Сега адресът се дава
    // като бутон, а информацията (име, размер, SHA-256, достъп) е на картата.
    assert.equal(doc.body.querySelectorAll('.file-link').length, 0, 'няма изписан адрес за изтегляне');
    assert.equal(doc.getElementById('files').textContent.includes('/download'), false, 'адресът не се вижда като текст');
    const cardsNow = doc.body.querySelectorAll('.file');
    const withCopy = cardsNow.filter((li) =>
      li.querySelectorAll('button').some((b) => b.textContent.includes('Копирай адреса')),
    );
    assert.equal(
      withCopy.length,
      2,
      'два файла дават бутон за копиране (забраненият — не). Има: ' +
      cardsNow.map((li) => li.textContent.slice(0, 40).replace(/\s+/g, ' ')).join(' | '),
    );
    withCopy[0].querySelectorAll('button').find((b) => b.textContent.includes('Копирай адреса')).click();
    await waitFor(() => copied.some((v) => /\/api\/v1\/p\/(render-demo|[0-9a-f]+)\/files\/[^/]+\/download$/.test(v)), { label: 'копиране на адреса за изтегляне' });
    // 0.69.184: адресът не се изписва на страницата — проверява се какво дава бутонът.
    doc.getElementById('copy-link').click();
    await waitFor(() => copied.some((v) => new RegExp('/p/' + portalId + '$').test(v)), { label: 'копиране на адреса на портала' });
    const shownUrl = copied[copied.length - 1];
    assert.equal(shownUrl, `${base}/p/${portalId}`, 'копираният адрес на портала е абсолютен и е по id');

    // ── PP-04: „API“ и „Манифест“ разгъват информацията В страницата ────────────────
    assert.equal(doc.getElementById('doc-info').hidden, true, 'панелът е скрит до поискване');
    doc.getElementById('api-open').click();
    await waitFor(() => doc.getElementById('doc-info').hidden === false, { label: 'панелът с информация се отваря' });
    assert.equal(doc.getElementById('doc-info-title').textContent, 'Информация за портала', 'заглавието е за портала');
    const apiInfo = doc.getElementById('doc-info-body').textContent;
    assert.ok(apiInfo.includes(portalId), 'информацията показва идентификатора: ' + apiInfo.slice(0, 120));
    assert.ok(apiInfo.includes('Документи по дело 2026-114'), 'и заглавието на портала');
    assert.equal(apiInfo.includes('/api/v1/p/'), false, 'в панела няма адреси за копиране');
    doc.getElementById('manifest-open').click();
    await waitFor(
      () => doc.getElementById('doc-info-title').textContent === 'Манифест на портала' && doc.getElementById('doc-info-body').textContent.includes('dogovor.txt'),
      { label: 'манифестът се разгъва с файловете' },
    );
    const manifestInfo = doc.getElementById('doc-info-body').textContent;
    assert.ok(manifestInfo.includes('SHA-256'), 'манифестът показва отпечатъците: ' + manifestInfo.slice(0, 160));
    doc.getElementById('doc-info-close').click();
    assert.equal(doc.getElementById('doc-info').hidden, true, 'бутонът „Затвори“ връща панела');

    // ── PP-05: „Изтегли“ е БУТОН (със сверка на SHA-256); ключът е поле + бутон ──────
    // Проверката е ПО КАРТАТА на файла, а не с общ селектор: така не зависи от реда на
    // файловете и от това коя карта е първа в списъка.
    const cards = doc.body.querySelectorAll('.file');
    const cardOf = (name) => cards.find((li) => li.textContent.includes(name));
    const freeCard = cardOf('dogovor.txt');
    assert.ok(freeCard, 'картата на свободния файл е в списъка');
    const freeButtons = freeCard.querySelectorAll('button').map((b) => b.textContent.trim());
    assert.equal(
      freeButtons.filter((t) => t.startsWith('Изтегли') && !t.includes('ключ')).length,
      1,
      'свободният файл има точно един бутон за сваляне (има: ' + freeButtons.join(' | ') + ')',
    );
    assert.equal(doc.body.querySelectorAll('a.btn-primary').length, 0, 'няма линк, който да сваля файл');
    const keyInputs = doc.body.querySelectorAll('input.key-input');
    assert.equal(keyInputs.length, 1, 'файлът с ключ има поле за ключ');
    assert.ok(doc.body.textContent.includes('Изтегли с ключ'), 'бутонът за ключ е изписан');

    // ── INV-6: забраненият файл не предлага нито адрес, нито бутон ──────────────────
    const blockedCard = doc.body.querySelectorAll('.file').find((li) => li.textContent.includes('arhiv.zip'));
    assert.ok(blockedCard, 'картата на забранения файл е в списъка');
    assert.equal(blockedCard.querySelectorAll('.file-link').length, 0, 'няма изписан адрес');
    assert.equal(blockedCard.querySelectorAll('button.btn-primary').length, 0, 'няма бутон за сваляне');
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
      '2 бутона за копиране на адреса (без изписан URL) · панел „Информация/Манифест“ в страницата · ' +
      '1 бутон за сваляне · 1 поле за ключ · забраненият без адрес и бутон · ' +
      'бутон за пакет с броя на свободните файлове'
    );
  } finally {
    await server.stop({ keep: true }).catch(() => { });
    try { fs.rmSync(server.dir, { recursive: true, force: true }); } catch { /* Windows може да държи файла още */ }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
