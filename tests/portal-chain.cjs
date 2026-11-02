'use strict';
// 0.69.106 — ВЕРИГАТА: API → ГЛАВНИЯ ПОРТАЛ → ПАПКИТЕ. Една и съща за всички портали.
//
// Какво обещаваме на човека: `api.json` дава адрес, този адрес отваря ГЛАВНАТА страница на
// портала, а тя зарежда ПАПКИТЕ и файловете (през `/tree`), без да знае нищо за диска.
// Тестът минава ЦЯЛАТА верига с истински заявки и я иска за ВСЕКИ вид портал — това е
// проверката „няма различия“:
//
//   1. публичен портал със собствена папка      → карта → страница → папки → файл
//   2. частен портал със собствена папка        → същото, но само със сесийна бисквитка
//   3. портал върху общ корен `/share`           → страница и виртуален списък, без `/tree`
//   4. портал без собствена (липсваща) папка    → страница се отваря, картата не лъже с `/tree`
//
// За всеки се проверява и че страницата наистина е в режим „папка“ ({{FOLDERS}} = 1), че
// скриптът ѝ вика `/tree?path=`, и че адресът, който картата дава, връща СЪЩИТЕ папки.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

/** Същият генератор като в `server.js` — за да докажем КАКВО точно кодира QR кодът. */
const qrSvg = (text) => { const q = require('../hapi_enterprise/qrcode')(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 8, margin: 4, scalable: true }); };

const shareRoot = path.join(path.parse(process.cwd()).root, 'share');
const SLUG = 'veriga-' + process.pid.toString(36);
const DIR = path.join(shareRoot, SLUG);
const SHARED_SLUG = 'veriga-obsht-' + process.pid.toString(36);
const MISSING_SLUG = 'veriga-lipsva-' + process.pid.toString(36);

const clean = () => fs.rmSync(DIR, { recursive: true, force: true });

/** Страницата на портала в режим „папка“ ли е и вика ли `/tree`? */
async function portalPage(base, id) {
  const res = await fetch(`${base}/p/${id}`);
  const html = await res.text();
  return { status: res.status, html };
}

(async () => {
  // ── Минала (грешна) логика: пазим я като ЗАБРАНЕН шаблон в изходния код ────────────
  // Тези проверки хващат връщането на стария код дори там, където няма портал, който да
  // задейства поведението (напр. портал без собствена папка или без частен достъп).
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', f), 'utf8');
  const serverSrc = src('server.js'), spec = src('api-spec.js');
  assert.equal(serverSrc.includes('qrSvg(apiUrl)'), false, 'QR кодът на папката не кодира JSON адреса (стара логика)');
  assert.equal(spec.includes('folder.url:'), false, 'картата на папката не ползва голо `url`');
  assert.equal(spec.includes('folderUrl: refs.folderUrl'), false, 'и не преизползва името `folderUrl` на панела');
  assert.equal((serverSrc.match(/portalStorage\.folderFilesOf\(/g) || []).length, 2, 'има ТОЧНО един строител на файловите записи (`folderFilesOf`), ползван от двата документа');
  assert.equal(serverSrc.includes('files: (node.files || []).map('), false, 'и няма втори, вграден вариант на същия запис');

  clean();
  try {
    fs.mkdirSync(path.join(DIR, 'Договори', '2026'), { recursive: true });
  } catch (e) {
    console.log(`SKIP portal-chain: ${shareRoot} не може да се създаде (${e.code || e.message}) — липсва /share`);
    process.exit(0);
  }
  fs.writeFileSync(path.join(DIR, 'Договори', '2026', 'анекс.txt'), 'съдържание на анекса');
  fs.writeFileSync(path.join(DIR, 'четиме.txt'), 'прочети ме');

  const server = await startServer();
  try {
    // ── Скриптът на страницата: ЕДИН файл, който вика `/tree` (иначе „папки“ няма) ──
    const portalJs = await (await fetch(`${server.base}/portal.js`)).text();
    assert.match(portalJs, /\/tree\?path=/, 'страницата на портала зарежда папките през `/tree?path=`');
    assert.match(portalJs, /\/tree\/file\?path=/, 'и сваля файл от папката през `/tree/file?path=`');

    // ── 1. Публичен портал със собствена папка ─────────────────────────────────
    const pub = await server.api('/admin/api/portals', 'POST', { slug: SLUG, title: 'Верига', visibility: 'public', storage_root: '/share/' + SLUG });
    assert.equal(pub.status, 201, 'порталът се създава: ' + pub.status);
    const portal = pub.data.v || pub.data;
    const map = await (await fetch(`${server.base}/api/v1/p/${SLUG}/api.json`)).json();

    // Верига: карта → главна страница.
    assert.ok(map.landing, 'картата дава адреса на главната страница');
    const page = await portalPage(server.base, portal.id);
    assert.equal(page.status, 200, 'главната страница се отваря: ' + page.status);
    assert.ok(page.html.includes('data-folders="1"'), 'страницата е в режим „папка“ ({{FOLDERS}}=1)');
    assert.match(page.html, /\/portal\.js/, 'страницата зарежда своя скрипт');
    assert.ok(page.html.includes('/api/v1/p/' + SLUG), 'страницата знае точното API на ТОЗИ портал');

    // Верига: главна страница → папки (адресите от картата).
    assert.ok(map.folder && map.folder.treeUrl, 'картата обявява договора за папката');
    const tree = await fetch(map.folder.treeUrl);
    assert.equal(tree.status, 200, 'обявеният адрес на папката отваря: ' + tree.status);
    const listing = await tree.json();
    assert.deepEqual((listing.folders || []).map((f) => f.name), ['Договори'], 'страницата вижда СЪЩИТЕ папки като на диска');
    assert.deepEqual((listing.files || []).map((f) => f.name), ['четиме.txt'], 'и файловете в корена');
    const sub = await (await fetch(`${map.folder.treeUrl}?path=${encodeURIComponent('/Договори/2026')}`)).json();
    assert.deepEqual((sub.files || []).map((f) => f.name), ['анекс.txt'], 'подпапката се зарежда по същия договор');
    const bytes = await fetch(sub.files[0].url);
    assert.equal(bytes.status, 200, 'адресът на файла от картата на папката работи: ' + bytes.status);
    assert.equal(await bytes.text(), 'съдържание на анекса', 'и връща точното съдържание');

    // Верига: QR кодът на папката → СЪЩАТА главна страница, отворена на нея (а не JSON).
    const folderQr = await (await fetch(`${map.folder.qrUrl}?path=${encodeURIComponent('/Договори')}`)).text();
    assert.equal(folderQr, qrSvg(`${server.base}/p/${portal.id}?folder=${encodeURIComponent('Договори')}`), 'QR кодът на папката кодира /p/<id>?folder=…');
    assert.notEqual(folderQr, qrSvg(`${server.base}/api/v1/p/${SLUG}/tree?path=${encodeURIComponent('/Договори')}`), 'и НЕ кодира JSON адреса (до 0.69.105 кодираше него)');
    const folderPage = await fetch(`${server.base}/p/${portal.id}?folder=${encodeURIComponent('Договори')}`);
    assert.equal(folderPage.status, 200, 'страницата от QR кода се отваря: ' + folderPage.status);

    // ── 2. Частен портал: същата верига, но само със сесия ─────────────────────
    const priv = await server.api('/admin/api/portals', 'POST', { slug: SLUG + '-taina', title: 'Тайна верига', visibility: 'private', storage_root: '/share/' + SLUG });
    assert.equal(priv.status, 201, 'частният портал се създава: ' + priv.status);
    const privPortal = priv.data.v || priv.data;
    const anon = await fetch(`${server.base}/api/v1/p/${SLUG}-taina/api.json`);
    assert.equal(anon.status, 404, 'без ключ частната карта не се дава: ' + anon.status);
    await anon.text();
    const issued = await fetch(`${server.base}/admin/api/portals/${privPortal.id}/tokens`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + server.token, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'veriga' }),
    });
    assert.equal(issued.status, 201, 'издава се токен за частния портал: ' + issued.status);
    const token = (await issued.json()).token;
    const login = await fetch(`${server.base}/t/${token}`, { redirect: 'manual' });
    assert.equal(login.status, 302, 'входът по токен пренасочва: ' + login.status);
    const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
    const privPage = await fetch(`${server.base}/p/${privPortal.id}`, { headers: { cookie } });
    const privHtml = await privPage.text();
    assert.equal(privPage.status, 200, 'частната главна страница се отваря със сесия: ' + privPage.status);
    assert.ok(privHtml.includes('data-folders="1"'), 'и тя е в режим „папка“');
    const anonQr = await fetch(`${server.base}/api/v1/p/${SLUG}-taina/tree/qr.svg`);
    assert.equal(anonQr.status, 404, 'без ключ QR кодът на частната папка не се дава: ' + anonQr.status);
    await anonQr.text();
    const privMap = await (await fetch(`${server.base}/api/v1/p/${SLUG}-taina/api.json`, { headers: { cookie } })).json();
    const privTree = await fetch(privMap.folder.treeUrl, { headers: { cookie } });
    assert.equal(privTree.status, 200, 'частната папка се отваря по адреса от картата: ' + privTree.status);
    const privListing = await privTree.json();
    assert.deepEqual((privListing.folders || []).map((f) => f.name), ['Договори'], 'частният портал вижда същите папки');

    // ── 3. Портал върху общ корен `/share`: страницата работи, `/tree` — не ────
    const shared = await server.api('/admin/api/portals', 'POST', { slug: SHARED_SLUG, title: 'Общ корен', visibility: 'public', storage_root: '/share' });
    assert.equal(shared.status, 201, 'порталът върху /share се създава: ' + shared.status);
    const sharedPortal = shared.data.v || shared.data;
    const sharedHtml = (await portalPage(server.base, sharedPortal.id)).html;
    assert.equal(sharedHtml.includes('data-folders="1"'), false, 'порталът върху /share НЕ е в режим „папка“ (няма собствена папка)');
    const sharedMap = await (await fetch(`${server.base}/api/v1/p/${SHARED_SLUG}/api.json`)).json();
    assert.equal(sharedMap.folder, undefined, 'и картата не обявява папка');
    const sharedTree = await fetch(`${server.base}/api/v1/p/${SHARED_SLUG}/tree`);
    assert.equal(sharedTree.status, 403, 'затова `/tree` там е 403, а не мълчаливо празен: ' + sharedTree.status);
    await sharedTree.text();
    const sharedVirtual = await fetch(sharedMap.storage.url);
    assert.equal(sharedVirtual.status, 200, 'виртуалното хранилище на същия портал работи: ' + sharedVirtual.status);
    await sharedVirtual.text();

    // ── 4. Портал със заделена, но ЛИПСВАЩА папка: без мъртви адреси ───────────
    const missing = await server.api('/admin/api/portals', 'POST', { slug: MISSING_SLUG, title: 'Липсва', visibility: 'public', storage_root: '/share/' + MISSING_SLUG });
    assert.equal(missing.status, 201, 'порталът с липсваща папка се създава: ' + missing.status);
    const missingPortal = missing.data.v || missing.data;
    const missingHtml = (await portalPage(server.base, missingPortal.id)).html;
    assert.ok(missingHtml.includes('data-folders="1"'), 'страницата знае, че порталът ИМА заделена папка');
    const missingMap = await (await fetch(`${server.base}/api/v1/p/${MISSING_SLUG}/api.json`)).json();
    assert.equal(missingMap.folder, undefined, 'но картата не обявява договор, който още не работи');
    const missingTree = await fetch(`${server.base}/api/v1/p/${MISSING_SLUG}/tree`);
    assert.equal(missingTree.status, 404, 'затова `/tree` е 404 „Folder not found“: ' + missingTree.status);
    await missingTree.text();

    console.log(`portal-chain OK: api.json → /p/<id> → /tree → файл работи за ${[SLUG, SLUG + '-taina', SHARED_SLUG, MISSING_SLUG].length} вида портал · страницата е в режим „папка“ само когато има собствена папка · частният иска сесия · общ корен → 403, липсваща папка → 404 и картата не лъже`);
  } finally {
    await server.stop();
    clean();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
