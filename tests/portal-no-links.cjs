'use strict';
// ДОГОВОР (0.69.141): страницата на портала НЕ Е „сайт с линкове“.
//
// До 0.69.140 посетителят получаваше: връзка „API“ и връзка „Манифест“ (суров JSON в нов
// таб), изписан адрес за изтегляне под всеки файл (`<code>…/download</code>`), връзки за
// подпапките и за QR архивите, и `mailto:`/`tel:` котви за контакта. Всичко това е или
// бутон, или информация в самата страница.
//
// Тук се проверява РЕЗУЛТАТЪТ, не изходният код: страницата се монтира срещу ЖИВ сървър и
// в готовия DOM не бива да има нито един `<a>` елемент. Единственото изключение е временен
// `<a download>`, който `downloadFile` създава в момента на сваляне — той не се вижда.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { createDocument } = require('./lib/dom-stub.cjs');

const ROOT = path.join(__dirname, '..');
// Коментарите не са разметка: в тях може да се говори ЗА тага, без да го има на страницата.
const markupOnly = (source) => String(source).replace(/<!--[\s\S]*?-->/g, '');
const html = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'portal', 'portal.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'portal', 'portal.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'portal', 'portal.css'), 'utf8');
const intHtml = fs.readFileSync(path.join(ROOT, 'custom_components', 'hapi_enterprise', 'portal.html'), 'utf8');
const intJs = fs.readFileSync(path.join(ROOT, 'custom_components', 'hapi_enterprise', 'portal.js'), 'utf8');

(async () => {
  // ── 1. Статичният HTML: няма нито един `<a>` ─────────────────────────────────────
  for (const [name, source, buttons] of [
    ['add-on', html, ['api-open', 'manifest-open', 'doc-info-close', 'copy-link', 'copy-id', 'folder-open']],
    ['интеграция', intHtml, ['api-open', 'manifest-open', 'doc-info-close', 'copy-link', 'folder-open']],
  ]) {
    assert.equal(/<a[\s>]/i.test(markupOnly(source)), false, `${name}: страницата не съдържа <a> елементи`);
    for (const id of buttons) {
      const tag = new RegExp('<button[^>]*id="' + id + '"', 'i').exec(source);
      assert.ok(tag, `${name}: #${id} е БУТОН, не линк`);
    }
    for (const id of ['doc-info', 'doc-info-title', 'doc-info-note', 'doc-info-body', 'doc-info-status']) {
      assert.ok(source.includes(`id="${id}"`), `${name}: има панел за информацията (#${id})`);
    }
    assert.equal(/target\s*=\s*"_blank"/.test(source), false, `${name}: нищо не се отваря в нов таб`);
  }
  // Скриптовете вече не строят адреси за външни линкове.
  for (const [name, source] of [['add-on', js], ['интеграция', intJs]]) {
    for (const gone of ['api-link', 'manifest-link', 'target="_blank"']) {
      assert.equal(source.includes(gone), false, `${name}: portal.js не съдържа „${gone}“`);
    }
    for (const needed of ['openInfo', 'closeInfo', 'infoRow', 'renderApiInfo', 'renderManifestInfo']) {
      assert.ok(source.includes(needed), `${name}: portal.js съдържа ${needed}`);
    }
  }
  // Стиловете за панела и за бутона-текст съществуват (иначе панелът е гол списък).
  for (const cls of ['.info-list', '.link-btn', '.file-folder']) {
    assert.ok(css.includes(cls), `portal.css съдържа ${cls}`);
  }

  // ── 2. Живата страница: в готовия DOM няма нито един `<a>` ─────────────────────────
  // Порталът получава собствена папка и се отваря в режим „папка“ — остатъци от предишно
  // пускане биха добавили чужди карти, затова папката се изчиства преди създаването.
  const shareDir = path.resolve('/share', 'nolinks-demo');
  try { fs.rmSync(shareDir, { recursive: true, force: true }) } catch { /* заключен файл на Windows */ }
  const server = await startServer({ keepData: true });
  const { api, authFetch, base } = server;
  try {
    const created = await api('/admin/api/portals', 'POST', {
      slug: 'nolinks-demo',
      title: 'Документи без линкове',
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
    await api(`/admin/api/portals/${portalId}/files/${keyed.id}/access`, 'PATCH', { mode: 'KEY_REQUIRED', listed: true, reason: 'тест' });

    const page = await (await fetch(`${base}/p/${portalId}`)).text();
    const bodyHtml = page.slice(page.indexOf('<body>') + '<body>'.length, page.indexOf('</body>'));
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
      navigator: { clipboard: { writeText: async (text) => { copied.push(String(text)); } } },
      fetch: (url, init) => fetch(typeof url === 'string' && url.startsWith('/') ? base + url : url, init),
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(await (await fetch(`${base}/portal-i18n.js`)).text(), sandbox, { filename: 'portal-i18n.js' });
    vm.runInContext(await (await fetch(`${base}/portal.js`)).text(), sandbox, { filename: 'portal.js' });

    await waitFor(() => doc.getElementById('files').children.length === 2, { label: 'двата файла в списъка' });

    // Нито един `<a>` в готовата страница: нито API, нито Манифест, нито адрес за сваляне.
    const anchors = doc.body.querySelectorAll('a');
    assert.equal(anchors.length, 0, 'в готовата страница няма нито един <a>: ' + anchors.map((a) => a.outerHTML || '').join(' | '));
    // Информацията е на картата: име, размер и SHA-256, без адрес.
    const cardText = doc.getElementById('files').textContent;
    assert.ok(cardText.includes('dogovor.txt'), 'картата показва името');
    assert.ok(cardText.includes('SHA-256'), 'картата показва отпечатъка: ' + cardText.slice(0, 120));
    assert.equal(cardText.includes('/download'), false, 'адресът за изтегляне не се вижда като текст');
    // Действията са бутони.
    const freeCard = doc.body.querySelectorAll('.file').find((li) => li.textContent.includes('dogovor.txt'));
    const freeButtons = freeCard.querySelectorAll('button').map((b) => b.textContent.trim());
    assert.ok(freeButtons.some((t) => t.includes('Изтегли')), 'свободният файл има бутон за сваляне: ' + freeButtons.join(' | '));
    assert.ok(freeButtons.some((t) => t.includes('Копирай адреса')), 'и бутон за копиране на адреса: ' + freeButtons.join(' | '));
    // Копирането дава абсолютния адрес, без той да е изписан някъде.
    freeCard.querySelectorAll('button').find((b) => b.textContent.includes('Копирай адреса')).click();
    await waitFor(() => copied.some((v) => v.endsWith(`/files/${free.id}/download`)), { label: 'копиране на адреса' });

    // ── 3. „API“ и „Манифест“ разгъват информацията В страницата ─────────────────────
    assert.equal(doc.getElementById('doc-info').hidden, true, 'панелът е скрит до поискване');
    doc.getElementById('api-open').click();
    await waitFor(() => doc.getElementById('doc-info').hidden === false, { label: 'панелът се отваря' });
    assert.equal(doc.getElementById('doc-info-title').textContent, 'Информация за портала');
    const apiInfo = doc.getElementById('doc-info-body').textContent;
    assert.ok(apiInfo.includes(portalId), 'панелът показва идентификатора');
    assert.ok(apiInfo.includes('Документи без линкове'), 'и заглавието');
    assert.equal(apiInfo.includes('/api/'), false, 'в панела няма адрес за копиране');
    doc.getElementById('manifest-open').click();
    await waitFor(
      () => doc.getElementById('doc-info-body').textContent.includes('dogovor.txt'),
      { label: 'манифестът се разгъва' },
    );
    const manifestInfo = doc.getElementById('doc-info-body').textContent;
    assert.ok(manifestInfo.includes('SHA-256'), 'манифестът показва отпечатъците');
    assert.ok(manifestInfo.includes('с ключ'), 'и режима на достъп: ' + manifestInfo.slice(0, 160));
    assert.equal(manifestInfo.includes('/api/'), false, 'манифестът също не дава адреси');
    doc.getElementById('doc-info-close').click();
    assert.equal(doc.getElementById('doc-info').hidden, true, '„Затвори“ връща панела');
    // Скокът към съдържанието също е бутон и не сменя адреса.
    const before = location.href;
    doc.getElementById('skip').click();
    assert.equal(location.href, before, 'скокът не променя адреса');

    // ── 4. Осталите публични страници: началната и страницата за един файл ─────────────
    // Там CSP забранява скриптове (`script-src` липсва), затова „бутон“ е оформена връзка,
    // а оправданието е, че ВСИЧКО останало е информация, не линк.
    const landing = await (await fetch(`${base}/`)).text();
    assert.equal(/<a[\s>]/i.test(landing), false, 'началната страница не дава линк към API-то');
    assert.ok(landing.includes('/api/v1/portals'), 'адресът на API-то се вижда като информация');

    // Един реален файл в папката на портала — страницата `/file.html` показва точно него.
    const portalFolder = path.resolve('/share', 'nolinks-demo');
    fs.mkdirSync(portalFolder, { recursive: true });
    fs.writeFileSync(path.join(portalFolder, 'doklad.txt'), 'съдържание за едностраничния изглед', 'utf8');
    const filePage = await (await fetch(`${base}/file.html?file=` + encodeURIComponent('nolinks-demo/doklad.txt'))).text();
    assert.ok(filePage.includes('SHA-256'), 'страницата на файла показва отпечатъка');
    assert.ok(filePage.includes('Адрес за изтегляне'), 'и адреса за изтегляне като информация');
    const fileAnchors = filePage.match(/<a[\s>][^>]*>/gi) || [];
    assert.equal(fileAnchors.length, 1, 'точно едно действие — бутонът „Изтегли файла“: ' + fileAnchors.join(' | '));
    assert.match(fileAnchors[0], /class="btn"/, 'действието е оформено като бутон');
    assert.equal(/href="#"|target="_blank"/.test(filePage), false, 'няма празни връзки и нови табове');

    console.log(
      'PASS portal-no-links: 0 линка в готовата страница · API/Манифест се разгъват В страницата · ' +
      'адресът се копира с бутон, но не се изписва · контактът и папките са бутони · ' +
      'копие за интеграцията със същия договор · началната страница и /file.html дават информация, не линкове',
    );
  } finally {
    await server.stop();
  }
})().catch((e) => {
  process.stderr.write(`FAIL portal-no-links: ${e && e.message ? e.message : e}\n`);
  process.exitCode = 1;
});
