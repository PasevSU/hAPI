'use strict';
// 0.69.75 — ЕДИН публичен вход и ЕДНА папка.
//
// Порталите вече не изискват всеки файл да е „регистриран“ и да получи собствен адрес:
//   • човекът качва файловете в папката на портала (`/share/<slug>`) и те са там;
//   • страницата на портала `/p/<id>` се отваря НАПРАВО в папката (`data-folders="1"`);
//   • `?folder=<подпапка>` сочи папка ВЪТРЕ в нея (това носи QR кодът);
//   • изтеглянето минава през ЕДИН контролиран маршрут `GET /api/v1/p/<slug>/tree/file?path=`,
//     който проверява правото за портала, че пътят е ВЪТРЕ в папката и че папката не е скрита.
//
// Отрицателните проверки са целта на теста: `..`, скрита папка, заключена папка, директория,
// чужд портал и частен портал без право НЕ дават файл. Плюс: общ корен (`/share`) не се отдава.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const shareRoot = path.resolve('/share');
const cleaned = [];

(async () => {
  const server = await startServer();
  try {
    const api = (p, method = 'GET', bodyJson) =>
      server.authFetch(server.base + p, {
        method,
        headers: bodyJson === undefined ? {} : { 'content-type': 'application/json' },
        body: bodyJson === undefined ? undefined : JSON.stringify(bodyJson),
      });
    const jsonOf = async (p, method, bodyJson) => {
      const res = await api(p, method, bodyJson);
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      return { status: res.status, data };
    };

    // ── Подготовка: публичен портал със СВОЯ папка ────────────────────────────
    const slug = 'fp-' + Date.now().toString(36);
    const created = await jsonOf('/admin/api/portals', 'POST', { slug, title: 'Портал с папка', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data).slice(0, 200));
    const portal = created.data;
    cleaned.push(portal.slug);
    assert.equal(portal.storage_root, '/share/' + slug, 'порталът има собствена папка');

    const folder = path.join(shareRoot, slug);
    const put = (rel, text) => {
      const full = path.join(folder, ...rel.split('/'));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, text);
      return full;
    };
    const pdfBytes = Buffer.from('договор за доставка — 2026', 'utf8');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'Договор 2026.pdf'), pdfBytes);
    put('данни.csv', 'a,b\n1,2\n');
    put('архив/стар.txt', 'стар файл');
    put('скрита/тайно.txt', 'не бива да се вижда');
    put('заключена/файл.txt', 'заключено');

    // Скрита и заключена папка се отбелязват през администраторския API.
    assert.equal((await jsonOf(`/admin/api/portals/${portal.id}/tree/folder`, 'PATCH', { path: '/скрита', visible: false })).status, 200, 'скритата папка се отбелязва');
    assert.equal((await jsonOf(`/admin/api/portals/${portal.id}/tree/folder`, 'PATCH', { path: '/заключена', locked: true, reason: 'заключена за теста' })).status, 200, 'заключената папка се отбелязва');

    // ── 1. Страницата на портала отваря ПАПКАТА, не регистъра ─────────────────
    const page = await api('/p/' + portal.id);
    assert.equal(page.status, 200, 'страницата на портала се отваря');
    const pageHtml = await page.text();
    assert.match(pageHtml, /data-folders="1"/, 'страницата знае, че порталът има собствена папка');
    assert.match(pageHtml, new RegExp(`data-api="/api/v1/p/${slug}"`), 'страницата получава пътя на API-то');
    assert.match(pageHtml, /data-folder=""/, 'без ?folder= се отваря коренът на папката');
    const subPage = await (await api('/p/' + portal.id + '?folder=' + encodeURIComponent('архив'))).text();
    assert.match(subPage, /data-folder="архив"/, '?folder= сочи подпапка в папката на портала');
    const traversalPage = await (await api('/p/' + portal.id + '?folder=../../etc')).text();
    assert.match(traversalPage, /data-folder=""/, '?folder= не може да излезе извън папката');

    // ── 2. Списъкът идва от папката, скритите не се показват ─────────────────
    const tree = await jsonOf(`/api/v1/p/${slug}/tree?path=/`);
    assert.equal(tree.status, 200, 'дървото на папката се чете: ' + JSON.stringify(tree.data).slice(0, 200));
    const names = (tree.data.files || []).map((f) => f.name).sort();
    assert.deepEqual(names, ['Договор 2026.pdf', 'данни.csv'].sort(), 'файловете са тези от папката: ' + names.join(', '));
    const folderNames = (tree.data.folders || []).map((f) => f.name);
    assert.ok(folderNames.includes('архив'), 'подпапката се вижда: ' + folderNames.join(', '));
    assert.equal(folderNames.includes('скрита'), false, 'скритата папка НЕ се вижда в списъка');
    const subTree = await jsonOf(`/api/v1/p/${slug}/tree?path=${encodeURIComponent('/архив')}`);
    assert.deepEqual((subTree.data.files || []).map((f) => f.name), ['стар.txt'], 'подпапката се чете отделно');

    // ── 3. Изтегляне по път: байтове, име и тип ──────────────────────────────
    const dl = await api(`/api/v1/p/${slug}/tree/file?path=${encodeURIComponent('/Договор 2026.pdf')}`);
    assert.equal(dl.status, 200, 'файлът от папката се изтегля');
    assert.equal(dl.headers.get('content-type'), 'application/pdf', 'типът идва от разширението');
    assert.equal(dl.headers.get('cache-control'), 'no-store', 'файлът не се кешира');
    const disposition = dl.headers.get('content-disposition') || '';
    assert.match(disposition, /^attachment; filename\*=UTF-8''/, 'отдава се като прикачен файл с UTF-8 име');
    assert.ok(disposition.includes(encodeURIComponent('Договор 2026.pdf')), 'името е оригиналното: ' + disposition);
    assert.equal(Buffer.compare(Buffer.from(await dl.arrayBuffer()), pdfBytes), 0, 'байтовете са същите като на диска');

    const nested = await api(`/api/v1/p/${slug}/tree/file?path=${encodeURIComponent('/архив/стар.txt')}`);
    assert.equal(nested.status, 200, 'файл в подпапка се изтегля по относителен път');
    assert.equal(await nested.text(), 'стар файл', 'съдържанието е вярното');

    // ── 4. Отрицателни: излизане от папката, директория, липсващ файл ────────
    for (const bad of ['/../данни.csv', '/../../etc/passwd', '/архив/../../x', 'данни.csv/../../x']) {
      const res = await api(`/api/v1/p/${slug}/tree/file?path=${encodeURIComponent(bad)}`);
      assert.equal(res.status, 400, `пътят "${bad}" се отхвърля (400), а не се чете`);
      await res.arrayBuffer();
    }
    // Същото, но кодирано в самата заявка (`%2e%2e`, `%2f`) — сървърът декодира ВЕДНЪЖ и пак отказва.
    for (const raw of ['/%2e%2e%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fx']) {
      const res = await server.authFetch(server.base + `/api/v1/p/${slug}/tree/file?path=${raw}`);
      assert.equal(res.status, 400, `кодираният път "${raw}" се отхвърля`);
      await res.arrayBuffer();
    }
    assert.equal((await api(`/api/v1/p/${slug}/tree/file?path=${encodeURIComponent('/')}`)).status, 400, 'коренът не е файл');
    assert.equal((await api(`/api/v1/p/${slug}/tree/file?path=`)).status, 400, 'без път няма файл');
    assert.equal((await api(`/api/v1/p/${slug}/tree/file?path=${encodeURIComponent('/архив')}`)).status, 404, 'директория не се отдава като файл');
    assert.equal((await api(`/api/v1/p/${slug}/tree/file?path=${encodeURIComponent('/няма.txt')}`)).status, 404, 'липсващ файл → 404');
    assert.equal((await api(`/api/v1/p/${slug}/tree/file?path=${encodeURIComponent('/данни.csv')}`, 'POST')).status, 405, 'само GET изтегля');

    // ── 5. Скрита и заключена папка не дават файл дори по име ────────────────
    assert.equal((await api(`/api/v1/p/${slug}/tree/file?path=${encodeURIComponent('/скрита/тайно.txt')}`)).status, 404, 'файл в скрита папка не се дава');
    assert.equal((await api(`/api/v1/p/${slug}/tree/file?path=${encodeURIComponent('/заключена/файл.txt')}`)).status, 404, 'файл в заключена папка не се дава');
    // …но след като папката се покаже отново, файлът е достъпен.
    await jsonOf(`/admin/api/portals/${portal.id}/tree/folder`, 'PATCH', { path: '/скрита', visible: true });
    assert.equal((await api(`/api/v1/p/${slug}/tree/file?path=${encodeURIComponent('/скрита/тайно.txt')}`)).status, 200, 'след отмяна на скриването файлът е достъпен');

    // ── 6. Частен портал не дава папката си без право ────────────────────────
    const privSlug = slug + '-priv';
    const priv = (await jsonOf('/admin/api/portals', 'POST', { slug: privSlug, title: 'Частен', visibility: 'private' })).data;
    cleaned.push(priv.slug);
    const privFolder = path.join(shareRoot, privSlug);
    fs.mkdirSync(privFolder, { recursive: true });
    fs.writeFileSync(path.join(privFolder, 'таен.txt'), 'само за свои');
    assert.equal((await api(`/api/v1/p/${privSlug}/tree/file?path=${encodeURIComponent('/таен.txt')}`)).status, 404, 'частен портал: файлът не се дава');
    assert.equal((await api('/p/' + priv.id)).status, 404, 'частен портал: страницата не се отваря');

    // ── 7. Общ корен (`/share`) не се отдава ─────────────────────────────────
    const bare = (await jsonOf('/admin/api/portals', 'POST', { slug: slug + '-bare', title: 'Общ корен', visibility: 'public' })).data;
    cleaned.push(bare.slug);
    assert.equal((await jsonOf(`/admin/api/portals/${bare.id}`, 'PATCH', { storage_root: '/share' })).status, 200, 'порталът може да сочи общия корен (за списък)');
    const bareDl = await api(`/api/v1/p/${bare.slug}/tree/file?path=${encodeURIComponent('/' + slug + '/данни.csv')}`);
    assert.equal(bareDl.status, 403, 'общият корен НЕ отдава файловете на другите портали');
    await bareDl.arrayBuffer();

    // ── 8. api-info сочи СТРАНИЦАТА (тя отваря папката) ──────────────────────
    const info = (await jsonOf(`/admin/api/portals/${portal.id}/api-info`)).data;
    assert.equal(info.folderUrl, info.landingUrl, 'адресът за споделяне е страницата, която отваря папката');
    assert.equal(info.folder, 'share/' + slug, 'api-info назовава коя папка се сервира');
    assert.ok(info.qrTarget.startsWith(info.landingUrl), 'QR кодът води към страницата');
    assert.equal(info.qrTarget, info.landingUrl, 'публичният портал не носи подпис — не му е нужен');
    // Частният портал: същият адрес, но с краткотраен подпис, който отваря И папката.
    const privInfo = (await jsonOf(`/admin/api/portals/${priv.id}/api-info`)).data;
    assert.ok(privInfo.qrTarget.startsWith(privInfo.landingUrl), 'QR кодът на частния портал води към страницата');
    assert.match(privInfo.qrTarget, /[?&]sig=/, 'частният QR носи подписания достъп');

    // ── 9. Страницата тегли през blob, не с изложен адрес за всеки файл ──────
    const portalJs = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'portal', 'portal.js'), 'utf8');
    assert.match(portalJs, /\/tree\/file\?path=/, 'страницата тегли през контролирания маршрут');
    assert.match(portalJs, /createObjectURL/, 'файлът се сваля като blob, без адрес в историята');
    assert.match(portalJs, /boot\.folders === "1"/, 'портал със собствена папка се отваря в нея');
    const panel = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', 'portal-control.js'), 'utf8');
    assert.match(panel, /api\.folderUrl/, 'QR кодът в панела кодира адреса, който отваря папката');
    assert.match(panel, /api\.folder/, 'панелът показва коя папка се сервира');

    console.log(
      `PASS portal-folder-portal: един вход /p/<id> → папка ${portal.storage_root} · ${names.length} файла по път · скрита/заключена папка 404 · .. → 400 · частен портал 404 · общ корен 403`,
    );
  } finally {
    await server.stop();
    for (const name of cleaned) {
      try {
        fs.rmSync(path.join(shareRoot, name), { recursive: true, force: true });
      } catch {
        /* на Linux /share може да не е достъпен за писане */
      }
    }
  }
})().catch((e) => {
  console.error('FAIL portal-folder-portal:', e && e.message ? e.message : e);
  if (e && e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
