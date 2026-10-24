'use strict';
// 0.69.76 — `order` е договорът на универсалния портал, а правилата за файловете се
// прилага СЪРВЪРНО.
//
//   /portal.html?order=share/<папка>[/<подпапка>]   ← това носи QR кодът
//
// Страницата НЕ решава коя папка е разрешена: тя само разчита `order` от адреса. Затова
// сървърът проверява, че пътят сочи ИМЕННО папката на съществуващ портал (`storage_root`)
// и че за портала има право `read`. Име на папка само по себе си не отваря нищо.
//
// Проверява се:
//   1. `?order=share/<slug>` сервира същата страница, сочеща API-то на ТОЗИ портал;
//   2. `?order=share/<slug>/<подпапка>` предава подпапката като `data-folder`;
//   3. `?order=` с чужда/несъществуваща папка, `..`, или частен портал → 404;
//   4. правилата на файла (недостъпен, необявен, с ключ) важат и през папката;
//   5. качване в липсваща подпапка НЕ я създава (404), а в съществуваща — работи.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const shareRoot = path.resolve('/share');
const cleaned = [];

(async () => {
  // `PORTAL_FOLDER_COPY=1`, за да имат качените през API файлове `storagePath` в папката —
  // точно както при портал, който пази файловете си на диска.
  const server = await startServer({ env: { PORTAL_FOLDER_COPY: '1' } });
  try {
    const api = (p, method = 'GET', bodyJson, headers) =>
      server.authFetch(server.base + p, {
        method,
        headers: { ...(bodyJson === undefined ? {} : { 'content-type': 'application/json' }), ...(headers || {}) },
        body: bodyJson === undefined ? undefined : JSON.stringify(bodyJson),
      });
    const jsonOf = async (p, method, bodyJson) => {
      const res = await api(p, method, bodyJson);
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      return { status: res.status, data };
    };

    const slug = 'ord-' + Date.now().toString(36);
    const portal = (await jsonOf('/admin/api/portals', 'POST', { slug, title: 'Портал с order', visibility: 'public' })).data;
    cleaned.push(portal.slug);
    const folder = path.join(shareRoot, slug);
    fs.mkdirSync(path.join(folder, 'архив'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'данни.csv'), 'a,b\n1,2\n');
    fs.writeFileSync(path.join(folder, 'архив', 'стар.txt'), 'стар');

    // ── 1. Универсалният вход: `order` сочи папката на портала ────────────────
    const page = await api('/portal.html?order=' + encodeURIComponent('share/' + slug));
    assert.equal(page.status, 200, 'order сервира страницата на портала');
    const pageHtml = await page.text();
    assert.match(pageHtml, /data-folders="1"/, 'страницата е в режим „папка“');
    assert.match(pageHtml, new RegExp(`data-api="/api/v1/p/${slug}"`), 'страницата ползва API-то на ТОЗИ портал');
    assert.match(pageHtml, /data-folder=""/, 'без подпапка се отваря коренът на папката');
    assert.match(pageHtml, /<div id="hapi-boot"/, 'това е приложението, не статичната страница на папката');

    // ── 2. Подпапка в `order` ────────────────────────────────────────────────
    const sub = await api('/portal.html?order=' + encodeURIComponent(`share/${slug}/архив`));
    assert.equal(sub.status, 200, 'order с подпапка се отваря');
    assert.match(await sub.text(), /data-folder="архив"/, 'подпапката стига до страницата');

    // ── 3. Отрицателни: чуждо име, излизане от папката, частен портал ────────
    assert.equal((await api('/portal.html?order=' + encodeURIComponent('share/няма-такава'))).status, 404, 'непозната папка → 404');
    assert.equal((await api('/portal.html?order=' + encodeURIComponent('../etc'))).status, 404, 'излизане от папката → 404');
    assert.equal((await api('/portal.html?order=' + encodeURIComponent('share/' + slug + '/../..'))).status, 404, 'връщане назад → 404');
    assert.equal((await api('/portal.html?order=')).status, 404, 'празен order не е страница на портал');
    assert.equal((await api('/portal.html')).status, 404, 'без order адресът не е страница на портал');

    const privSlug = slug + '-priv';
    const priv = (await jsonOf('/admin/api/portals', 'POST', { slug: privSlug, title: 'Частен', visibility: 'private' })).data;
    cleaned.push(priv.slug);
    assert.equal((await api('/portal.html?order=' + encodeURIComponent('share/' + privSlug))).status, 404, 'частен портал не се отваря без право');

    // ── 4. Правилата на файла важат и през папката ───────────────────────────
    // Тялото се подава отделно — `api()` не слага body за undefined.
    const up = await server.authFetch(server.base + `/admin/api/portals/${portal.id}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('правило.txt'), 'x-file-encrypt': '0' },
      body: 'съдържание',
    });
    assert.equal(up.status, 201, 'файлът се качва: ' + (await up.clone().text()).slice(0, 160));
    const file = await up.json();
    assert.equal(file.storagePath, '/правило.txt', 'файлът е в папката на портала');

    const listPath = `/api/v1/p/${slug}/tree?path=${encodeURIComponent('/')}`;
    const showNames = async () => ((await jsonOf(listPath)).data.files || []).map((f) => f.name);
    assert.ok((await showNames()).includes('правило.txt'), 'файлът се вижда в списъка');

    // недостъпен: нито в списъка, нито при изтегляне
    assert.equal((await jsonOf(`/admin/api/portals/${portal.id}/files/${file.id}/access`, 'PATCH', { mode: 'DISABLED' })).status, 200);
    assert.equal((await showNames()).includes('правило.txt'), false, 'недостъпен файл НЕ се показва');
    assert.equal((await api(`/api/v1/p/${slug}/tree/file?path=${encodeURIComponent('/правило.txt')}`)).status, 404, 'недостъпен файл не се тегли');

    // необявен: същото, но с `listed:false`
    await jsonOf(`/admin/api/portals/${portal.id}/files/${file.id}/access`, 'PATCH', { mode: 'FREE', listed: false });
    assert.equal((await showNames()).includes('правило.txt'), false, 'необявен файл НЕ се показва');
    assert.equal((await api(`/api/v1/p/${slug}/tree/file?path=${encodeURIComponent('/правило.txt')}`)).status, 404, 'необявен файл не се тегли');

    // с ключ: показва се с флаг `key`, но не се тегли без ключ
    await jsonOf(`/admin/api/portals/${portal.id}/files/${file.id}/access`, 'PATCH', { mode: 'KEY_REQUIRED', listed: true });
    const keyRow = ((await jsonOf(listPath)).data.files || []).find((f) => f.name === 'правило.txt');
    assert.ok(keyRow, 'файлът с ключ се показва');
    assert.equal(keyRow.key, true, 'списъкът казва, че файлът иска ключ');
    assert.equal((await api(`/api/v1/p/${slug}/tree/file?path=${encodeURIComponent('/правило.txt')}`)).status, 403, 'без ключ файлът не се дава');

    // свободен: пак се тегли
    await jsonOf(`/admin/api/portals/${portal.id}/files/${file.id}/access`, 'PATCH', { mode: 'FREE', listed: true });
    assert.equal((await api(`/api/v1/p/${slug}/tree/file?path=${encodeURIComponent('/правило.txt')}`)).status, 200, 'свободният файл се тегли');

    // ── 5. Качване не създава папки, които не съм поискал ─────────────────────
    const treeUpload = (rel) =>
      server.authFetch(server.base + `/admin/api/portals/${portal.id}/tree/upload?path=${encodeURIComponent(rel)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: 'x',
      });
    const missing = await treeUpload('/няма-такава/файл.txt');
    assert.equal(missing.status, 404, 'качване в липсваща папка е 404, а не мълчаливо създаване');
    assert.equal(fs.existsSync(path.join(folder, 'няма-такава')), false, 'на диска НЕ се е появила папка');
    assert.equal((await treeUpload('/архив/нов.txt')).status, 201, 'качване в съществуваща папка работи');
    assert.equal(fs.readFileSync(path.join(folder, 'архив', 'нов.txt'), 'utf8'), 'x', 'файлът е в папката');
    assert.equal((await treeUpload('/корен.txt')).status, 201, 'качване в корена на портала работи');

    console.log('PASS portal-order: order → папката на портала · подпапка · чуждо/частно → 404 · DISABLED/unlisted скрити и 404 · KEY 403 · качване не създава папки');
  } finally {
    await server.stop();
    for (const name of cleaned) {
      try {
        fs.rmSync(path.join(shareRoot, name), { recursive: true, force: true });
      } catch {
        /* на Linux /share може да не е достъпен */
      }
    }
  }
})().catch((e) => {
  console.error('FAIL portal-order:', e && e.message ? e.message : e);
  if (e && e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
