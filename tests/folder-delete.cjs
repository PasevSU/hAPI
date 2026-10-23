'use strict';
// 0.69.62: (1) адресите в „Сподели / QR“ се отварят, (2) „добави файл“ качва ЕДИН файл,
// (3) папките вече могат да се трият — с реално изтриване в хранилището на портала.
//
// Какво се мери на живия сървър:
//   • непразна папка НЕ се трие „на сляпо“: 409 с броя файлове, папката си остава;
//   • с `?recursive=1` се трие заедно със съдържанието, а регистрираният в портала файл
//     от нея изчезва ЗАЕДНО с байтовете си (не остава запис към изтрит файл);
//   • празна папка се трие без `recursive`; коренът не се трие (400); липсваща → 404;
//     изход навън от хранилището (`..`) → 400; заключена папка → 409.
// И в панела: QR кодът се строи от РАБОТЕЩИЯ адрес, а не от път, който иска ключ.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const root = path.join(__dirname, '..');

(async () => {
  const server = await startServer();
  try {
    const api = (p, method = 'GET', bodyJson) =>
      server.authFetch(server.base + p, {
        method,
        headers: bodyJson === undefined ? {} : { 'content-type': 'application/json' },
        body: bodyJson === undefined ? undefined : JSON.stringify(bodyJson),
      });
    const upload = (p, data) =>
      server.authFetch(server.base + p, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: data,
      });

    // ── Портал и папка ───────────────────────────────────────────────────────
    // Порталът получава СОБСТВЕНА папка в хранилището (/share/<slug>), затова тестът не
    // пипа общия /share и в края се чисти след себе си.
    const slug = 'deltest-' + Date.now().toString(36);
    const portalRes = await api('/admin/api/portals', 'POST', { slug, title: 'Изтриване', category: 'Дела' });
    assert.equal(portalRes.status, 201, 'порталът се създава: ' + (await portalRes.clone().text()).slice(0, 200));
    const created = await portalRes.json();
    const portal = created.id;
    assert.equal(created.storage_root, '/share/' + slug, 'порталът получава собствена папка, а не целия /share');
    const base = `/admin/api/portals/${portal}/tree`;

    const mk = await api(`${base}/folder`, 'POST', { parent: '', name: 'документи' });
    assert.equal(mk.status, 201, 'папката се създава');

    const payload = Buffer.from('съдържание на документа', 'utf8');
    assert.equal((await upload(`${base}/upload?path=${encodeURIComponent('/документи/първи.txt')}`, payload)).status, 201);
    assert.equal((await upload(`${base}/upload?path=${encodeURIComponent('/документи/под/second.txt')}`, payload)).status, 201);

    const reg = await api(`${base}/register`, 'POST', { path: '/документи/първи.txt' });
    assert.equal(reg.status, 201, 'файлът се регистрира в портала');
    const registered = await reg.json();

    // ── 1. Непразна папка: 409, нищо не се трие ──────────────────────────────
    const blocked = await api(`${base}/folder?path=${encodeURIComponent('/документи')}`, 'DELETE');
    assert.equal(blocked.status, 409, 'непразна папка не се трие без потвърждение');
    const blockedBody = await blocked.json();
    assert.match(blockedBody.error, /не е празна/, 'отговорът казва защо');
    assert.match(blockedBody.error, /2 файла/, 'отговорът казва колко файла има (2)');
    assert.match(blockedBody.error, /1 папки/, 'отговорът казва колко подпапки има (1)');

    const tree1 = await (await api(`${base}`)).json();
    assert.ok(JSON.stringify(tree1.tree).includes('документи'), 'папката си стои след отказа');

    // ── 2. Рекурсивно: трие се със съдържанието и с регистрацията ────────────
    const forced = await api(`${base}/folder?path=${encodeURIComponent('/документи')}&recursive=1`, 'DELETE');
    assert.equal(forced.status, 200, 'с recursive=1 папката се трие');
    const forcedBody = await forced.json();
    assert.equal(forcedBody.deleted, true);
    assert.equal(forcedBody.files, 2, 'изтрити са 2 файла');
    assert.equal(forcedBody.folders, 1, 'изтрита е 1 подпапка');
    assert.equal(forcedBody.registeredFiles, 1, 'един регистриран файл е премахнат от портала');
    assert.equal(forcedBody.recursive, true);

    const tree2 = await (await api(`${base}`)).json();
    assert.equal(JSON.stringify(tree2.tree).includes('документи'), false, 'папката я няма в дървото');

    const portalAfter = await (await api(`/admin/api/portals/${portal}`)).json();
    const stillThere = (portalAfter.files || []).some((f) => f.id === registered.id);
    assert.equal(stillThere, false, 'регистрираният файл е махнат от портала');
    assert.equal((await api(`/admin/api/portals/${portal}/files/${registered.id}/download`)).status, 404, 'байтовете също са изтрити');

    // ── 3. Празна папка се трие без recursive ───────────────────────────────
    assert.equal((await api(`${base}/folder`, 'POST', { parent: '', name: 'празна' })).status, 201);
    const empty = await api(`${base}/folder?path=${encodeURIComponent('/празна')}`, 'DELETE');
    assert.equal(empty.status, 200, 'празната папка се трие без потвърждение');
    assert.equal((await empty.json()).files, 0);

    // ── 4. Откази: корен, липсваща, изход навън, заключена ──────────────────
    assert.equal((await api(`${base}/folder?path=%2F`, 'DELETE')).status, 400, 'коренът не се трие');
    assert.equal((await api(`${base}/folder?path=${encodeURIComponent('/няма-такава')}`, 'DELETE')).status, 404, 'липсваща папка → 404');
    assert.equal(
      (await api(`${base}/folder?path=${encodeURIComponent('/../извън')}`, 'DELETE')).status,
      400,
      'изходът навън от хранилището се отказва',
    );

    assert.equal((await api(`${base}/folder`, 'POST', { parent: '', name: 'заключена' })).status, 201);
    assert.equal((await api(`${base}/folder`, 'PATCH', { path: '/заключена', locked: true })).status, 200);
    const locked = await api(`${base}/folder?path=${encodeURIComponent('/заключена')}&recursive=1`, 'DELETE');
    assert.equal(locked.status, 409, 'заключена папка не се трие дори рекурсивно');
    assert.match((await locked.json()).error, /заключена/);
    assert.equal(
      JSON.stringify((await (await api(`${base}`)).json()).tree).includes('заключена'),
      true,
      'заключената папка си стои',
    );

    // ── 5. Панелът: QR от работещия адрес, един файл на прикачване, изтриване ──
    const ui = (name) => fs.readFileSync(path.join(root, 'hapi_enterprise', 'ui', name), 'utf8');
    const filesUi = ui('files-manager.js');
    const foldersUi = ui('portal-folders.js');
    const filesBlock = ui('portal-files.js');

    assert.equal(filesUi.includes('/api/public/v1/files/'), false, 'панелът не строи адрес, който иска ключ');
    // Файлът няма собствен QR адрес: QR-ът се рисува от адреса за изтегляне.
    assert.equal(/files\/\$\{encodeURIComponent\(f\.id\)\}\/qr\.svg/.test(filesUi), false, 'няма отделен QR адрес за файл');
    assert.match(filesUi, /function qrMarkup\(f, link\)/, 'QR кодът се строи от адреса за изтегляне');
    assert.match(filesUi, /qrSvg\(link\)/, 'рисува се от СЪЩИЯ адрес, който се копира');
    assert.match(filesUi, /data-folder-delete/, 'изтриването на папка е вързано към бутон');
    assert.match(filesUi, /async function deleteFolder\(rel\)/);
    assert.match(filesUi, /r\.status === 409/, 'непразна папка пита втори път (409)');
    assert.match(foldersUi, /data-folder-delete="\$\{esc\(key\)\}"/, 'менюто на папката има „изтрий папката“');
    assert.equal(/data-folder-delete[\s\S]{0,80}key\s*\?/.test(foldersUi), false, 'коренът няма бутон за триене');
    assert.match(foldersUi, /\$\{key\s*\n?\s*\?/, 'бутонът за триене е само при истинска папка');
    assert.match(filesBlock, /id="fm-file-input" class="u-hidden" \/>/, 'прикачването на файл е единично');
    assert.match(filesBlock, /id="fm-dir-input" class="u-hidden" webkitdirectory directory multiple/, 'папката остава multiple');

    console.log(
      'PASS folder-delete: непразна → 409 (2 файла, 1 папка) · recursive → 200 (2 файла, 1 подпапка, 1 регистриран) · празна → 200 · корен → 400 · липсваща → 404 · „..“ → 400 · заключена → 409 · панелът строи QR от работещия адрес',
    );

    // Чистене: собствената папка на тестовия портал (празна е — съдържанието е изтрито
    // от маршрута, който тестът проверява).
    try {
      fs.rmSync(path.resolve('/share', slug), { recursive: true, force: true });
    } catch {
      /* на Linux /share може да не е достъпен за писане от теста — тогава остава празна папка */
    }
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error('FAIL folder-delete:', e && e.message ? e.message : e);
  if (e && e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
