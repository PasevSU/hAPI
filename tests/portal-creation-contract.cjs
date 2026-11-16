'use strict';
// ДОГОВОРЪТ „API + QR ЗА ПОРТАЛА, ФАЙЛА И ПРЕГЛЕДА — ОЩЕ ПРИ СЪЗДАВАНЕТО“ (0.69.219).
//
// Заявката на собственика: „създай договор, който създава API и QR кодовете за целия портал,
// за файловете и read-only още при създаването; те трябва да водят към портала, който дори и
// да няма нищо публикувано, трябва да го отразява“.
//
// Тестът пази четири неща, всяко от които е било невярно до 0.69.219:
//   1. `POST /admin/api/portals` ВРЪЩА договора (`contract`) — дотук адресите се научаваха
//      с втора заявка (`api-info`), тоест „още при създаването“ не беше вярно;
//   2. всеки адрес от договора СЕ ОТВАРЯ ВЕДНАГА — преди да е публикуван какъвто и да е
//      файл: страницата, API-то, `api.json`, `manifest`, `openapi.json`, QR SVG-то;
//   3. спътникът „само за преглед“ има СВОИ адреси и СВОЙ QR (а не препратка към родителя);
//   4. страницата на празен портал НЕ е 404: тя се отваря и КАЗВА, че още нищо не е
//      публикувано — проверява се на РЕНДИРАНИЯ DOM (`portal.js` върху живия сървър), не на
//      регулярен израз в изходния код;
//   5. шаблоните за файл/папка (`{path}`) работят след първото качване и водят до ЧОВЕШКАТА
//      страница, не до JSON API-то.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { createDocument } = require('./lib/dom-stub.cjs');

const SLUG = 'contract-demo';

(async () => {
  const server = await startServer({ keepData: true });
  const { base, api, authFetch } = server;
  // Остатъци от предишно пускане добавят чужди карти към страницата — чисти се преди и след.
  // Двете папки: на портала и на частния (тестът създава и втори, за да провери подписа).
  const shareDir = [SLUG, `${SLUG}-private`].map((s) => path.join(server.storageRoot(), 'share', s));
  const wipe = () => { for (const dir of shareDir) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* заключен файл на Windows */ } } };
  wipe();

  try {
    // ── 1. Създаване: договорът идва в ОТГОВОРА на създаването ────────────────
    const created = await api('/admin/api/portals', 'POST', {
      slug: SLUG,
      title: 'Договор за адресите',
      description: 'Още нищо не е публикувано.',
      visibility: 'public',
      readonlyView: true,
    });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data));
    const portal = created.data;
    const c = portal.contract;
    assert.ok(c, 'отговорът на създаването носи contract — иначе „още при създаването“ е невярно');
    assert.equal(c.ready, true, 'договорът е готов веднага');
    assert.equal(c.id, portal.id, 'договорът е за ТОЗИ портал');
    assert.equal(c.slug, SLUG);
    assert.equal(c.readonly, false, 'родителят не е „само за преглед“');
    assert.equal(c.files.count, 0, 'още няма публикуван файл');
    assert.equal(c.files.empty, true, 'договорът КАЗВА, че е празен');

    // ── 2. Четирите адреса са налице и са различни повърхности ───────────────
    assert.equal(c.page, `${base}/p/${portal.id}`, 'страницата е /p/<id> (адресът на QR кода)');
    assert.equal(c.api, `${base}/api/v1/p/${SLUG}`, 'API-то е /api/v1/p/<slug>');
    assert.equal(c.apiJson, `${base}/api/v1/p/${SLUG}/api.json`);
    assert.equal(c.manifest, `${base}/api/v1/p/${SLUG}/manifest`);
    assert.equal(c.openapi, `${base}/api/v1/p/${SLUG}/openapi.json`);
    assert.equal(c.qr, `${base}/api/v1/p/${SLUG}/qr.svg`, 'qr е АДРЕСЪТ на SVG-то');
    assert.equal(c.qrTarget, c.page, 'кодът сочи човешката страница, не JSON-а');

    // Шаблоните за файл/папка — файловете още не съществуват, затова са шаблони.
    assert.equal(c.file.qr, `${base}/api/v1/p/${SLUG}/tree/qr.svg?path={path}`);
    assert.equal(c.file.download, `${base}/api/v1/p/${SLUG}/tree/file?path={path}`);
    assert.equal(c.file.page, '/file.html:{slug}/{path}', 'страницата на файла е човешката, не API-то');
    assert.equal(c.folder.qr, c.file.qr, 'едно и също ниво-независимо място за код');

    // ── 3. Спътникът „само за преглед“ има собствени адреси ──────────────────
    const ro = c.readOnly;
    assert.ok(ro, 'поискан е read-only — договорът го съдържа');
    assert.equal(ro.readonly, true);
    assert.equal(ro.slug, `${SLUG}-view`, 'спътникът е със свой slug');
    assert.notEqual(ro.page, c.page, 'спътникът има СВОЯ страница, не препратка към родителя');
    assert.notEqual(ro.qr, c.qr, 'и СВОЙ QR');
    assert.equal(portal.viewPortal.contract.page, ro.page, 'договорът на спътника съвпада с този в viewPortal');

    // ── 4. Всичко се отваря ВЕДНАГА — преди първото качване ──────────────────
    const get = async (url) => {
      const res = await fetch(url);
      return { status: res.status, type: res.headers.get('Content-Type') || '', text: await res.text() };
    };
    for (const [label, url, want] of [
      ['страницата', c.page, /text\/html/],
      ['API-то', c.api, /application\/json/],
      ['api.json', c.apiJson, /application\/json/],
      ['manifest', c.manifest, /application\/json/],
      ['openapi.json', c.openapi, /application\/json/],
      ['QR SVG', c.qr, /image\/svg\+xml/],
      ['страницата на прегледа', ro.page, /text\/html/],
      ['QR на прегледа', ro.qr, /image\/svg\+xml/],
    ]) {
      const res = await get(url);
      assert.equal(res.status, 200, `${label} се отваря на празен портал: ` + res.status);
      assert.match(res.type, want, `${label} има правилния тип: ` + res.type);
    }
    assert.match((await get(c.qr)).text, /<svg/, 'QR-ът е истински SVG');

    // ── 5. Празният портал ГО КАЗВА на екрана, не е 404 ──────────────────────
    const html = (await get(c.page)).text;
    assert.ok(/id="hapi-boot"/.test(html), 'страницата носи „бут“-а с адресите');
    const doc = createDocument({ lang: 'bg' });
    doc.body.innerHTML = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
    const sandbox = {
      document: doc,
      location: {
        protocol: 'http:', origin: base, host: '127.0.0.1', pathname: `/p/${portal.id}`, search: '', hash: '',
        href: c.page, toString: () => c.page,
      },
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
      navigator: { clipboard: { writeText: async () => {} } },
      fetch: (url, init) => fetch(typeof url === 'string' && url.startsWith('/') ? base + url : url, init),
    };
    for (const file of ['portal-i18n.js', 'portal.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'portal', file), 'utf8');
      if (file === 'portal-i18n.js') sandbox.window = sandbox;
      require('node:vm').runInNewContext(src, sandbox, { filename: file });
    }
    const emptyText = await waitFor(
      () => {
        const el = doc.getElementById('empty');
        const summary = doc.getElementById('summary');
        const shown = el && !el.hidden ? String(el.textContent || '') : '';
        const sum = summary ? String(summary.textContent || '') : '';
        const hit = [shown, sum].find((t) => /нищо|още не|not contain files yet|enthält noch keine/i.test(t));
        return hit || null;
      },
      { label: 'съобщението, че още нищо не е публикувано', timeout: 8000 },
    );
    assert.match(emptyText, /още|нищо/i, 'страницата КАЗВА, че още нищо не е публикувано: ' + emptyText);

    // ── 6. Шаблоните работят след първото качване ────────────────────────────
    const up = await authFetch(`${base}/admin/api/portals/${portal.id}/tree/upload?path=${encodeURIComponent(`/${'dokument.txt'}`)}&mkdir=1`, {
      method: 'POST',
      body: 'съдържание',
    });
    assert.equal(up.status, 201, 'файлът се качва в папката на портала: ' + up.status);
    const fileQr = c.file.qr.replace('{path}', encodeURIComponent('/dokument.txt'));
    const folderQr = c.folder.qr.replace('{path}', encodeURIComponent('/'));
    const download = c.file.download.replace('{path}', encodeURIComponent('/dokument.txt'));
    assert.equal((await get(fileQr)).status, 200, 'кодът за файла се дава по шаблона');
    assert.equal((await get(folderQr)).status, 200, 'кодът за корена се дава по шаблона');
    assert.equal((await get(download)).status, 200, 'изтеглянето минава по шаблона');

    // Кодът на файла води до СТРАНИЦАТА на файла, а не до API-то — сверява се с построителя,
    // защото SVG-то е матрица, а не текст с адреса вътре.
    const qrSvgLib = require(path.join(__dirname, '..', 'hapi_enterprise', 'qr-svg.js'));
    const pageOfFile = `${base}/file.html:${SLUG}/${encodeURIComponent('dokument.txt')}`;
    assert.equal(
      (await get(fileQr)).text,
      qrSvgLib.svg(pageOfFile),
      'кодът на файла сочи човешката страница на файла: ' + pageOfFile,
    );
    assert.notEqual(
      (await get(fileQr)).text,
      qrSvgLib.svg(`${base}/api/v1/p/${SLUG}/tree/file?path=${encodeURIComponent('/dokument.txt')}`),
      'и НЕ сочи JSON/изтеглящия адрес',
    );

    // Договорът се обновява в `api-info` — същият построител, не втори.
    const info = await api(`/admin/api/portals/${portal.id}/api-info`);
    assert.equal(info.status, 200, 'api-info работи');
    assert.deepEqual(info.data.contract.files, { count: 0, bytes: 0, empty: true }, 'броят идва от регистъра на файловете, не от папката');
    assert.equal(info.data.contract.qr, c.qr, 'същият QR адрес и в двата отговора (един построител)');

    // ── 7. ЧАСТЕН портал: адресът на прегледа носи СВОЯ подпис (DEF-65) ──────
    // До 0.69.220 спътникът се строеше без `accessQuery`, тоест `/p/<id на прегледа>` без
    // `?expires=&sig=` — и правеше 404, макар договорът да твърдеше, че е готов. Тестът
    // по-горе не го хвана, защото порталът беше ПУБЛИЧЕН; затова тук има втори, частен.
    const priv = await api('/admin/api/portals', 'POST', {
      slug: `${SLUG}-private`,
      title: 'Частен с преглед',
      visibility: 'private',
      readonlyView: true,
    });
    assert.equal(priv.status, 201, 'частният портал се създава: ' + JSON.stringify(priv.data));
    const pc = priv.data.contract;
    assert.ok(pc.readOnly, 'частният портал също има договор за прегледа');
    assert.match(pc.page, /[?&]sig=/, 'адресът на частния портал носи подпис');
    assert.match(pc.readOnly.page, /[?&]sig=/, 'адресът на ПРЕГЛЕДА също носи СВОЙ подпис: ' + pc.readOnly.page);
    assert.notEqual(pc.readOnly.page, pc.page, 'и това не е същият адрес като портала');
    assert.equal((await get(pc.page)).status, 200, 'частният портал се отваря с подписа от договора');
    assert.equal((await get(pc.readOnly.page)).status, 200, 'и прегледът се отваря с подписа от договора');
    // Отпечатъците са различни: подписът е вързан за конкретния запис (id + signingSecret).
    const sigOf = (url) => new URL(url).searchParams.get('sig');
    assert.notEqual(sigOf(pc.readOnly.page), sigOf(pc.page), 'подписите са различни — иначе единият запис би отварял другия');
    // И `api-info` дава същото (един построител, не втори).
    const pInfo = await api(`/admin/api/portals/${priv.data.id}/api-info`);
    assert.equal(pInfo.status, 200, 'api-info работи и за частния портал');
    assert.match(pInfo.data.contract.readOnly.page, /[?&]sig=/, 'api-info също дава подписан адрес на прегледа');
    assert.equal((await get(pInfo.data.contract.readOnly.page)).status, 200, 'и той се отваря');

    console.log(
      'PASS portal-creation-contract: договорът идва при създаването · страница/API/api.json/manifest/openapi/QR се отварят на ПРАЗЕН портал · ' +
        'read-only със свой адрес и QR · празният портал КАЗВА, че нищо не е публикувано · шаблоните {path} работят и водят до човешката страница',
    );
  } finally {
    wipe();
    await server.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
