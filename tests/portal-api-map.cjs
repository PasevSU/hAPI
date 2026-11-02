'use strict';
// 0.69.100 — КАРТАТА НА API-ТО СЕ СЕРВИРА, НЕ САМО СЕ ЗАПИСВА НА ДИСКА.
//
// Дефектът: `api-registry` записва `api/<slug>/api.json` при всяка промяна на портала,
// `layout.js` го обявява като адрес (`/api/v1/p/<slug>/api.json`), панелът го предлага за
// сваляне — но сървърът НЕ го обслужваше. Клиент, който прочете картата от документите или
// от папката на портала, получаваше 404 на най-очевидния си въпрос „къде е API-то?“.
//
// Тестът държи три неща заедно, защото те са едно обещание:
//   1. адресът отговаря 200 и връща СЪЩИЯ документ, който лежи до портала (един източник —
//      `api-spec.js`, а не втори, измислен в маршрута);
//   2. броячите в картата съвпадат с манифеста (двете врати не бива да казват различни числа);
//   3. затвореното си остава затворено: непознат slug и частен портал без ключ дават 404.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const allowlist = require(path.join(__dirname, '..', 'hapi_enterprise', 'public-route-allowlist.js'));

const DOC_A = 'първи документ за картата на API-то';
const DOC_B = 'втори документ — за да има два файла';

const upload = async (server, portalId, name, body) =>
  server.authFetch(`${server.base}/admin/api/portals/${portalId}/files`, {
    method: 'POST',
    headers: { 'X-File-Name': encodeURIComponent(name), 'content-type': 'application/octet-stream' },
    body,
  });

(async () => {
  const server = await startServer();
  try {
    // ── 1. Портали: един публичен (с два файла) и един частен ────────────────
    const pub = await server.api('/admin/api/portals', 'POST', { slug: 'mapa', title: 'Карта', visibility: 'public' });
    assert.equal(pub.status, 201, 'публичният портал се създава: ' + JSON.stringify(pub.data).slice(0, 160));
    const portal = pub.data.v || pub.data;
    for (const [name, body] of [['първи.txt', DOC_A], ['втори.txt', DOC_B]]) {
      const res = await upload(server, portal.id, name, body);
      assert.equal(res.status, 201, 'файлът „' + name + '“ се качва: ' + res.status);
      await res.arrayBuffer();
    }
    const priv = await server.api('/admin/api/portals', 'POST', { slug: 'taina', title: 'Тайна', visibility: 'private' });
    assert.equal(priv.status, 201, 'частният портал се създава');
    const privatePortal = priv.data.v || priv.data;

    // ── 2. Адресът отговаря и носи картата ───────────────────────────────────
    const res = await server.authFetch(server.base + '/api/v1/p/mapa/api.json');
    assert.equal(res.status, 200, 'GET /api/v1/p/mapa/api.json трябва да е 200, а беше ' + res.status);
    assert.match(String(res.headers.get('content-type')), /application\/json/, 'картата е JSON');
    const map = await res.json();

    assert.equal(map.slug, 'mapa', 'картата е за поискания портал');
    assert.equal(map.title, portal.title, 'заглавието идва от портала, не е преписено');
    assert.equal(map.apiUrl, server.base + '/api/v1/p/mapa', 'картата носи пълния адрес на API-то');
    assert.ok(String(map.openapi).endsWith('/api/v1/p/mapa/openapi.json'), 'сочи и договора: ' + map.openapi);
    assert.ok(String(map.manifest).endsWith('/api/v1/p/mapa/manifest'), 'сочи и манифеста: ' + map.manifest);
    assert.ok(String(map.landing).includes('/p/' + portal.id), 'човешката страница е с id, не със slug: ' + map.landing);
    assert.equal(map.storage.virtual, true, 'хранилището е виртуално');
    assert.equal(map.storage.fileCount, 2, 'картата брои качените два файла, а не нула');
    assert.ok(map.links && map.links.qrUrl, 'картата носи и блока с препратки');

    // ── 3. Същият документ, който api-registry записа до портала ─────────────
    const onDisk = JSON.parse(fs.readFileSync(path.join(server.dir, 'api', 'mapa', 'api.json'), 'utf8'));
    const withoutTimestamp = (value) => ({ ...value, updatedAt: '' });
    assert.deepEqual(withoutTimestamp(map), withoutTimestamp(onDisk),
      'сервираната карта е СЪЩИЯТ документ, който лежи до портала (различава се само updatedAt)');

    // ── 4. Двете врати казват едни и същи числа ──────────────────────────────
    const manifest = await (await server.authFetch(server.base + '/api/v1/p/mapa/manifest')).json();
    assert.equal(manifest.storage.fileCount, map.storage.fileCount, 'манифестът и картата броят еднакво файлове');
    assert.equal(manifest.storage.folderCount, map.storage.folderCount, 'манифестът и картата броят еднакво папки');
    assert.equal(manifest.files.length, 2, 'манифестът изрежда двата файла');

    // ── 5. Публичният gateway също пуска адреса (иначе картата е само за панела) ──
    assert.equal(allowlist.allow('/api/v1/p/mapa/api.json', 'GET'), true,
      'адресът е в allowlist-а на публичния listener');

    // ── 6. Затвореното си остава затворено ──────────────────────────────────
    const unknown = await server.authFetch(server.base + '/api/v1/p/nyama-takuv/api.json');
    assert.equal(unknown.status, 404, 'непознат портал дава 404, не празна карта');
    await unknown.arrayBuffer();
    const privateAnon = await fetch(server.base + '/api/v1/p/taina/api.json');
    assert.equal(privateAnon.status, 404, 'частен портал без ключ дава 404 — картата не е странична врата');
    await privateAnon.arrayBuffer();
    // Собственикът обаче я отваря по СЪЩИЯ път, по който отваря портала: с линк `/t/<токен>`,
    // който дава бисквитка за сесия. Администраторският Bearer тук НЕ помага — и това е
    // правилното: публичното API на портала се отваря с достъп до портала, не с админ токен.
    const issued = await fetch(`${server.base}/admin/api/portals/${privatePortal.id}/tokens`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + server.token, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'mapa' }),
    });
    assert.equal(issued.status, 201, 'издава се токен за частния портал: ' + issued.status);
    const granted = await issued.json();
    const login = await fetch(server.base + '/t/' + granted.token, { redirect: 'manual' });
    assert.equal(login.status, 302, 'входът по токен пренасочва: ' + login.status);
    const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(/hapi_session=/.test(cookie), 'входът дава бисквитка за сесия');
    const privateOwner = await fetch(server.base + '/api/v1/p/taina/api.json', { headers: { cookie } });
    assert.equal(privateOwner.status, 200, 'собственикът отваря частната карта: ' + privateOwner.status);
    const privateMap = await privateOwner.json();
    assert.equal(privateMap.slug, 'taina', 'частната карта е на частния портал');

    // ── 7. След изтриване на файл картата не лъже ────────────────────────────
    const files = await (await server.authFetch(server.base + '/api/v1/p/mapa/files')).json();
    const first = (files.files || files.items || [])[0];
    assert.ok(first && first.id, 'списъкът връща файловете с id');
    const del = await server.authFetch(`${server.base}/admin/api/portals/${portal.id}/files/${first.id}`, { method: 'DELETE' });
    assert.equal(del.status, 200, 'файлът се изтрива: ' + del.status);
    await del.arrayBuffer();
    const after = await (await server.authFetch(server.base + '/api/v1/p/mapa/api.json')).json();
    assert.equal(after.storage.fileCount, 1, 'след изтриване картата показва 1 файл');
    const afterDisk = JSON.parse(fs.readFileSync(path.join(server.dir, 'api', 'mapa', 'api.json'), 'utf8'));
    assert.equal(afterDisk.storage.fileCount, 1, 'и записаният до портала api.json е обновен');

    console.log(`portal-api-map OK: /api/v1/p/<slug>/api.json → 200 · същият документ като на диска (${JSON.stringify(map).length}B) · броячите съвпадат с манифеста · непознат и частен портал → 404 · след изтриване 2→1`);
  } finally {
    await server.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
