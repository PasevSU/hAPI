'use strict';
// 0.69.63: папката на портала — там СА файловете, с истинските им имена, и има portal.html.
//
// Какво се мери на живия сървър (не се твърди „работи“, а се гледа диска):
//   • всеки портал има собствена папка `/share/<slug>` (не общия /share, където са чуждите папки);
//   • качен файл се записва в нея под ОРИГИНАЛНОТО си име, байт по байт, и `storagePath` сочи към него;
//   • едноименно качване не презаписва: `име.pdf`, `име-2.pdf`;
//   • шифрован файл НЕ се слага в папката (иначе открит текст в /share);
//   • изтриването на файла го маха и от диска;
//   • в `api/<slug>/` има `portal.html` — човешката страница на портала, която изрежда файловете.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const shareRoot = path.resolve('/share');
let created = null;

(async () => {
  // Тестът проверява САМАТА папка на портала, затова пуска с включено копие
  // (`portal_folder_copy`). По подразбиране прикачването не създава папка — това се
  // пази от `tests/portal-folder-copy.cjs`.
  const server = await startServer({ env: { PORTAL_FOLDER_COPY: '1' } });
  try {
    const api = (p, method = 'GET', bodyJson) =>
      server.authFetch(server.base + p, {
        method,
        headers: bodyJson === undefined ? {} : { 'content-type': 'application/json' },
        body: bodyJson === undefined ? undefined : JSON.stringify(bodyJson),
      });
    const upload = (p, data, headers) =>
      server.authFetch(server.base + p, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', ...(headers || {}) },
        body: data,
      });

    const slug = 'folder-' + Date.now().toString(36);
    const createdRes = await api('/admin/api/portals', 'POST', { slug, title: 'Папка на портала' });
    assert.equal(createdRes.status, 201, 'порталът се създава: ' + (await createdRes.clone().text()).slice(0, 200));
    const portal = await createdRes.json();
    created = portal;

    // ── 1. Собствена папка, създадена веднага ────────────────────────────────
    assert.equal(portal.storage_root, '/share/' + slug, 'порталът получава собствена папка, не целия /share');
    const folder = path.join(shareRoot, slug);
    assert.equal(fs.existsSync(folder), true, 'папката на портала съществува на диска: ' + folder);
    assert.equal(fs.statSync(folder).isDirectory(), true);

    // ── 2. portal.html в папката на API-то ───────────────────────────────────
    const apiDir = path.join(server.dir, 'api', slug);
    const pagePath = path.join(apiDir, 'portal.html');
    assert.equal(fs.existsSync(pagePath), true, 'api/<slug>/portal.html съществува: ' + pagePath);
    const page = fs.readFileSync(pagePath, 'utf8');
    assert.match(page, /<title>Папка на портала — портал hAPI Enterprise<\/title>/, 'страницата носи заглавието на портала');
    assert.match(page, /Портал <code>[a-z0-9-]+<\/code>/, 'страницата назовава портала');
    for (const sibling of ['api.json', 'openapi.json']) {
      assert.equal(fs.existsSync(path.join(apiDir, sibling)), true, `до нея е ${sibling}`);
    }

    // ── 3. Каченият файл е в папката, с истинското си име ────────────────────
    const payload = Buffer.from('съдържание на договора — 2026', 'utf8');
    const up = await upload(`/admin/api/portals/${portal.id}/files`, payload, { 'X-File-Name': encodeURIComponent('Договор 2026.pdf'), 'X-File-Encrypt': '0' });
    assert.equal(up.status, 201, 'файлът се качва: ' + (await up.clone().text()).slice(0, 200));
    const file = await up.json();
    assert.equal(file.storagePath, '/Договор 2026.pdf', 'записът сочи пътя в папката на портала');
    const onDisk = path.join(folder, 'Договор 2026.pdf');
    assert.equal(fs.existsSync(onDisk), true, 'файлът е на диска под оригиналното си име');
    assert.equal(Buffer.compare(fs.readFileSync(onDisk), payload), 0, 'байтовете са същите');
    assert.equal(
      fs.readFileSync(onDisk).length,
      file.size,
      `размерът съвпада (${file.size} B)`,
    );

    // ── 4. Едноименно качване не презаписва ──────────────────────────────────
    const second = await upload(`/admin/api/portals/${portal.id}/files`, Buffer.from('втора версия', 'utf8'), {
      'X-File-Name': encodeURIComponent('Договор 2026.pdf'),
      'X-File-Encrypt': '0',
    });
    assert.equal(second.status, 201);
    const secondFile = await second.json();
    assert.equal(secondFile.storagePath, '/Договор 2026-2.pdf', 'второто качване получава ново име');
    assert.equal(fs.readFileSync(path.join(folder, 'Договор 2026.pdf')).toString('utf8'), payload.toString('utf8'), 'първият файл е непокътнат');
    assert.equal(fs.readFileSync(path.join(folder, 'Договор 2026-2.pdf')).toString('utf8'), 'втора версия');

    // ── 5. Шифрован файл НЕ влиза в папката ──────────────────────────────────
    const secret = await upload(`/admin/api/portals/${portal.id}/files`, Buffer.from('тайна', 'utf8'), {
      'X-File-Name': encodeURIComponent('тайна.txt'),
      'X-File-Encrypt': '1',
    });
    assert.equal(secret.status, 201);
    const secretFile = await secret.json();
    assert.equal(secretFile.encrypted, true, 'файлът е шифрован');
    assert.equal(secretFile.storagePath || '', '', 'шифрован файл няма път в откритата папка');
    assert.equal(fs.existsSync(path.join(folder, 'тайна.txt')), false, 'в /share няма открит текст на шифрования файл');

    // ── 6. Експлорерът вижда файловете (дървото на портала) ──────────────────
    const tree = await (await api(`/admin/api/portals/${portal.id}/tree`)).json();
    const names = (tree.tree.files || []).map((f) => f.name);
    assert.ok(names.includes('Договор 2026.pdf'), 'дървото показва качения файл: ' + names.join(', '));
    assert.ok(names.includes('Договор 2026-2.pdf'));

    // ── 7. portal.html вече изрежда файловете ────────────────────────────────
    const pageAfter = fs.readFileSync(pagePath, 'utf8');
    assert.match(pageAfter, /Договор 2026\.pdf/, 'страницата показва името на файла');
    assert.match(pageAfter, /\/api\/v1\/p\/[a-z0-9-]+\/files\/[0-9a-f]+\/download/, 'страницата дава адрес за изтегляне');

    // ── 7б. Същата страница се сервира на /portal.html?folder=<slug> ────────
    // За личен портал адресът иска достъп като /p/<slug> — 404 без право.
    assert.equal((await api(`/portal.html?folder=${encodeURIComponent(slug)}`)).status, 404, 'личен портал: адресът не се отваря без право');
    assert.equal((await api(`/admin/api/portals/${portal.id}`, 'PATCH', { visibility: 'public' })).status, 200, 'порталът става публичен');
    const served = await api(`/portal.html?folder=${encodeURIComponent(slug)}`);
    assert.equal(served.status, 200, 'адресът /portal.html?folder=<slug> се отваря');
    assert.match(served.headers.get('content-type') || '', /text\/html/, 'връща HTML, не файл от диска');
    const servedHtml = await served.text();
    assert.match(servedHtml, /Договор 2026\.pdf/, 'страницата на папката изрежда файловете');
    assert.match(servedHtml, new RegExp(`Портал <code>${slug}</code>`), 'страницата е за ТОЗИ портал');
    assert.equal((await api('/portal.html?folder=няма-такъв')).status, 404, 'непозната папка → 404');
    assert.equal((await api('/portal.html')).status, 404, 'без ?folder= адресът не е страница на портал');

    // ── 7в. Нов портал НЕ наследява чуждите файлове от общата папка ──────────
    // Всеки портал сочи собствена папка `/share/<slug>`, затова „новият портал“ е празен,
    // дори когато в /share има други папки и файлове.
    const neighbour = path.join(shareRoot, 'чужд-портал-' + Date.now().toString(36));
    fs.mkdirSync(neighbour, { recursive: true });
    fs.writeFileSync(path.join(neighbour, 'чужд.txt'), 'не е на портала');
    const freshSlug = slug + '-fresh';
    const fresh = await api('/admin/api/portals', 'POST', { slug: freshSlug, title: 'Чист портал' });
    assert.equal(fresh.status, 201, 'нов портал се създава дори когато /share е пълен');
    const freshPortal = await fresh.json();
    assert.equal(freshPortal.storage_root, '/share/' + freshSlug, 'новият портал сочи СВОЯТА папка');
    assert.equal(freshPortal.fileCount, 0, 'новият портал е с 0 файла, а не с чуждите');
    const freshTree = await (await api(`/admin/api/portals/${freshPortal.id}/tree`)).json();
    assert.deepEqual((freshTree.tree.files || []).map((f) => f.name), [], 'дървото на новия портал е празно');
    fs.rmSync(neighbour, { recursive: true, force: true });
    fs.rmSync(path.join(shareRoot, freshSlug), { recursive: true, force: true });

    // ── 8. Изтриването маха файла и от диска ─────────────────────────────────
    const del = await api(`/admin/api/portals/${portal.id}/files/${file.id}`, 'DELETE');
    assert.equal(del.status, 200, 'файлът се трие');
    assert.equal(fs.existsSync(onDisk), false, 'файлът е махнат и от папката на портала');
    assert.equal(fs.existsSync(path.join(folder, 'Договор 2026-2.pdf')), true, 'другият файл остава');

    console.log(
      `PASS portal-folder: папка ${portal.storage_root} · качен файл ${file.size} B с истинско име · второ качване → -2.pdf · шифрован не влиза в папката · portal.html изрежда файловете · изтриването чисти и диска`,
    );
  } finally {
    await server.stop();
    // Чистене: собствената папка на тестовия портал в хранилището.
    if (created) {
      try {
        fs.rmSync(path.join(shareRoot, created.slug), { recursive: true, force: true });
      } catch {
        /* на Linux /share може да не е достъпен за писане от теста */
      }
    }
  }
})().catch((e) => {
  console.error('FAIL portal-folder:', e && e.message ? e.message : e);
  if (e && e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
