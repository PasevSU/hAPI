'use strict';
// 0.69.102 — КАРТАТА НА ПАПКАТА ТРЯБВА ДА КАЗВА И АДРЕСА НА ФАЙЛА.
//
// Две неща се проверете тук, защото те са едно обещание „виждам файла → мога да го взема“:
//
// 1. `GET /api/v1/p/<slug>/tree/api.json?path=…` изреждаше име, размер, режим и основание,
//    но НЕ и адрес. Клиентът (или човек) виждаше файла и трябваше сам да се досети за
//    `/tree/file?path=`, докато папките имаха `apiUrl`. Сега всеки файл носи `url`.
// 2. Адресът трябва да е ЧЕСТЕН: при файл със „ключ“ същият `url` дава 403 (а не 200),
//    а необявеният (`listed:false`) файл изобщо не влиза в картата. Ако картата обещава
//    достъп, който правилата после отказват, тя лъже — затова се проверяват и двете посоки.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const SLUG = 'karta-papka';
// `/share` е абсолютен път в add-on-а: на Linux е `/share`, на Windows — `<диск>:\share`.
const shareRoot = path.join(path.parse(process.cwd()).root, 'share');
const folder = path.join(shareRoot, SLUG);
const INSIDE = 'съдържание на файла в папката';
const UPLOADED = 'съдържание на качения файл';

const clean = () => fs.rmSync(folder, { recursive: true, force: true });

(async () => {
  clean();
  try {
    fs.mkdirSync(path.join(folder, 'Договори', '2026'), { recursive: true });
  } catch (e) {
    console.log(`SKIP portal-folder-contract: ${shareRoot} не може да се създаде (${e.code || e.message}) — липсва /share`);
    process.exit(0);
  }
  fs.writeFileSync(path.join(folder, 'Договори', '2026', 'анекс.txt'), INSIDE);
  // `portal_folder_copy` по подразбиране е изключено; тук е включено, защото точно то качва
  // файла в САМАТА папка на портала — тоест дава му `storagePath`, по който после се прилагат
  // правилата (ключ/необявен) и по който картата на папката го вижда.
  const server = await startServer({ env: { PORTAL_FOLDER_COPY: '1' } });
  try {
    const created = await server.api('/admin/api/portals', 'POST', {
      slug: SLUG,
      title: 'Карта на папка',
      visibility: 'public',
      storage_root: '/share/' + SLUG,
    });
    assert.equal(created.status, 201, 'порталът със собствена папка се създава: ' + created.status);
    const portal = created.data.v || created.data;

    // Качване през API-то: файлът влиза и в папката на портала, със `storagePath`.
    const up = await server.authFetch(`${server.base}/admin/api/portals/${portal.id}/files`, {
      method: 'POST',
      headers: { 'X-File-Name': encodeURIComponent('качен.txt'), 'content-type': 'application/octet-stream' },
      body: UPLOADED,
    });
    assert.equal(up.status, 201, 'файлът се качва: ' + up.status);
    const uploaded = await up.json();
    assert.ok(uploaded.id, 'каченият файл има id: ' + JSON.stringify(uploaded).slice(0, 120));

    // ── 1. Картата на папката носи адрес за всеки файл ────────────────────────
    const mapRes = await fetch(`${server.base}/api/v1/p/${SLUG}/tree/api.json?path=/`);
    assert.equal(mapRes.status, 200, 'картата на папката се сервира: ' + mapRes.status);
    const map = await mapRes.json();
    assert.equal(map.kind, 'storage-folder', 'документът е карта на папка');
    assert.ok(Array.isArray(map.files) && map.files.length >= 1,
      'картата изрежда файла от папката: ' + JSON.stringify({ folder: map.folder, folders: map.folders, files: map.files }));
    for (const file of map.files) {
      assert.ok(file.url, `файлът „${file.name}“ трябва да носи адрес, а носи: ${JSON.stringify(file)}`);
      assert.match(file.url, /\/api\/v1\/p\/[^/]+\/tree\/file\?path=/, 'адресът е договорът `/tree/file?path=`: ' + file.url);
    }

    // Всеки обявен адрес отговаря според ПРАВИЛАТА на файла, не според обещание.
    const byName = new Map(map.files.map((f) => [f.name, f]));
    const uploadedEntry = byName.get('качен.txt');
    assert.ok(uploadedEntry, 'каченият файл е в картата: ' + [...byName.keys()].join(', '));
    const got = await fetch(uploadedEntry.url);
    assert.equal(got.status, 200, 'адресът на свободния файл дава 200: ' + got.status);
    assert.equal(await got.text(), UPLOADED, 'адресът дава СЪДЪРЖАНИЕТО на файла, не описание');

    // ── 2. Списъкът (`/tree?path=`) носи същите адреси ────────────────────────
    const listing = await (await fetch(`${server.base}/api/v1/p/${SLUG}/tree?path=/`)).json();
    const listingEntry = (listing.files || []).find((f) => f.name === 'качен.txt');
    assert.ok(listingEntry && listingEntry.url === uploadedEntry.url,
      'списъкът и картата дават ЕДИН адрес за същия файл');

    // ── 3. Вложената папка: файлът на диска също има адрес и той работи ──────
    const nested = await (await fetch(`${server.base}/api/v1/p/${SLUG}/tree/api.json?path=/Договори/2026`)).json();
    const annex = (nested.files || []).find((f) => f.name === 'анекс.txt');
    assert.ok(annex && annex.url, 'файлът от вложената папка носи адрес: ' + JSON.stringify(nested.files));
    const annexRes = await fetch(annex.url);
    assert.equal(annexRes.status, 200, 'адресът на вложения файл дава 200: ' + annexRes.status);
    assert.equal(await annexRes.text(), INSIDE, 'вложеният файл идва с точното си съдържание');

    // ── 4. Заключен файл: адресът остава в картата, но НЕ дава байтовете ─────
    const lock = await server.api(`/admin/api/portals/${portal.id}/files/${uploaded.id}/access`, 'PATCH', {
      mode: 'KEY_REQUIRED',
      reason: 'иска се ключ от клиента',
    });
    assert.equal(lock.status, 200, 'файлът се заключва с ключ: ' + lock.status);
    const afterLock = await (await fetch(`${server.base}/api/v1/p/${SLUG}/tree/api.json?path=/`)).json();
    const lockedEntry = (afterLock.files || []).find((f) => f.name === 'качен.txt');
    assert.ok(lockedEntry, 'заключеният файл НЕ изчезва от картата (вижда се с режима си)');
    assert.equal(lockedEntry.mode, 'KEY_REQUIRED', 'картата казва режима: ' + lockedEntry.mode);
    assert.equal(lockedEntry.key, true, 'картата казва, че иска ключ');
    const refused = await fetch(lockedEntry.url);
    assert.equal(refused.status, 403, 'заключеният файл се отказва с 403 по СВОЯ адрес: ' + refused.status);
    await refused.text();

    // ── 5. Необявен файл: не влиза в картата и адресът му не работи ─────────
    const hide = await server.api(`/admin/api/portals/${portal.id}/files/${uploaded.id}/access`, 'PATCH', {
      mode: 'FREE',
      listed: false,
      reason: 'чернова',
    });
    assert.equal(hide.status, 200, 'файлът се маркира като необявен: ' + hide.status);
    const afterHide = await (await fetch(`${server.base}/api/v1/p/${SLUG}/tree/api.json?path=/`)).json();
    assert.equal((afterHide.files || []).some((f) => f.name === 'качен.txt'), false,
      'необявеният файл не се показва в картата');
    const hidden = await fetch(uploadedEntry.url);
    assert.equal(hidden.status, 404, 'адресът на необявения файл дава 404: ' + hidden.status);
    await hidden.text();

    // ── 6. Самата карта на API-то обявява папката и адресите ѝ работят ───────
    // До 0.69.103 `api.json` не споменаваше папката: клиент, тръгнал от картата, виждаше
    // `storage.fileCount: 0` (виртуалните файлове) и нямаше как да научи, че документите са
    // в папката. Договорът `/tree` работеше, но не беше обявен никъде освен в `portal.js`.
    const apiMap = await (await fetch(`${server.base}/api/v1/p/${SLUG}/api.json`)).json();
    assert.ok(apiMap.folder, 'картата на API-то трябва да обявява папката: ' + JSON.stringify(Object.keys(apiMap)));
    assert.equal(apiMap.folder.dedicated, true, 'папката е собствена (не общия /share)');
    for (const [name, url] of [['url', apiMap.folder.treeUrl], ['apiJsonUrl', apiMap.folder.apiJsonUrl], ['qrUrl', apiMap.folder.qrUrl]]) {
      assert.match(String(url), /^https?:\/\//, `${name} е абсолютен адрес: ${url}`);
      const answer = await fetch(url);
      assert.equal(answer.status, 200, `обявеният ${name} отговаря 200: ${answer.status} → ${url}`);
      await answer.text();
    }
    assert.match(String(apiMap.folder.fileUrlTemplate), /\/tree\/file\?path=<path>$/, 'шаблонът за един файл е обявен: ' + apiMap.folder.fileUrlTemplate);
    const apiOpenapi = await (await fetch(apiMap.openapi)).json();
    for (const suffix of ['/tree', '/tree/api.json', '/tree/qr.svg', '/tree/file']) {
      const key = '/api/v1/p/' + SLUG + suffix;
      assert.ok(apiOpenapi.paths[key], 'договорът описва ' + key);
    }

    // …а портал БЕЗ собствена папка НЕ я обявява: за общ корен `/tree` дава 403 и картата
    // не бива да обещава заключена врата. Порталът тук получава `/share` (общ корен), а не
    // подразбиращата се `/share/<slug>`, защото такава папка може да съществува от предишен
    // пуск — и тогава обявяването е ПРАВИЛНО.
    const sharedSlug = 'obsht-koren-' + process.pid.toString(36);
    const bare = await server.api('/admin/api/portals', 'POST', { slug: sharedSlug, title: 'Общ корен', visibility: 'public', storage_root: '/share' });
    assert.equal(bare.status, 201, 'порталът върху общия корен се създава: ' + bare.status);
    const bareMap = await (await fetch(`${server.base}/api/v1/p/${sharedSlug}/api.json`)).json();
    assert.equal(bareMap.folder, undefined, 'портал върху /share не обявява папка');
    assert.equal(/\/tree(\?|"|$)/.test(JSON.stringify(bareMap.links)), false, 'и не дава мъртви адреси в препратките');
    const refusedTree = await fetch(`${server.base}/api/v1/p/${sharedSlug}/tree`);
    assert.equal(refusedTree.status, 403, 'затова и `/tree` там е 403: ' + refusedTree.status);
    await refusedTree.text();

    console.log(`portal-folder-contract OK: картата на папката дава url на всеки файл (${map.files.length} в корена) · адресът връща съдържанието · списъкът и картата сочат едно и също · заключен → 403, необявен → 404 и изчезва · api.json обявява папката (3 адреса, всички 200), а портал без папка — не`);
  } finally {
    await server.stop();
    clean();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
