'use strict';
// МАРШРУТИ НА ОПЦИИТЕ НА ПОРТАЛА (план 23, „Остава“ №1).
//
// Какво пази този тест: панелът чете и пише описанието САМО през тези адреси. Затова всяка
// мутация носи чекпойнт (`expectHash`/`If-Match`) и връща новия хеш; запис върху чужда промяна
// е 409 с текущия хеш и разликата; ръчна промяна във файла влиза в базата само с `adopt`; а
// `verify` сравнява `files[]` с РЕАЛНОТО съдържание на папката.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startServer } = require('./lib/gui-harness.cjs');
const { storageRoot } = require('./helpers.cjs');

(async () => {
  const storage = storageRoot();
  const server = await startServer({ env: { ...storage.env, PORTAL_FOLDER_COPY: 'true' } });
  const authed = (url, init) => fetch(server.base + url, { ...init, headers: { authorization: 'Bearer ' + server.token, ...(init && init.headers) } });
  const api = (url, method, body) => server.api(url, method, body);
  try {
    const created = await api('/admin/api/portals', 'POST', { title: 'Портал с опции', slug: 'p-opcii', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data).slice(0, 200));
    const portal = created.data.portal || created.data;
    const base = '/admin/api/portals/' + encodeURIComponent(portal.id) + '/config';
    const logical = String(portal.storage_root || '').replace(/^\/+/, '');
    const folder = path.join(storage.dir, ...logical.split('/').filter(Boolean));
    const file = path.join(folder, 'configuration.yaml');

    const upload = (name, text) => authed('/admin/api/portals/' + encodeURIComponent(portal.id) + '/files', {
      method: 'POST',
      headers: { 'x-file-name': encodeURIComponent(name) },
      body: text,
    }).then((r) => r.status);
    assert.ok([200, 201].includes(await upload('dokument.txt', 'съдържание')), 'файлът се качва');
    assert.ok(fs.existsSync(file), 'описанието е в папката');

    // ── 1. GET: ефективни стойности + чекпойнт ───────────────────────────────
    const first = await api(base, 'GET');
    assert.equal(first.status, 200, 'GET config минава: ' + JSON.stringify(first.data).slice(0, 200));
    assert.equal(first.data.exists, true, 'файлът съществува');
    assert.equal(first.data.legacy, false, 'новото описание е плоско');
    assert.match(first.data.hash, /^[0-9a-f]{64}$/, 'GET връща хеша (чекпойнт)');
    assert.equal(first.data.data.ui_columns, 3, 'опциите са плоски в отговора');
    assert.equal(first.data.effective.visibility, 'public', 'ефективните стойности идват от файла');
    assert.deepEqual(first.data.problems, [], 'описанието е валидно: ' + JSON.stringify(first.data.problems));

    // ── 2. PUT: иска чекпойнт, иначе 409 ────────────────────────────────────
    const blind = await api(base, 'PUT', { config: { ui_columns: 4 }, expectHash: null });
    assert.equal(blind.status, 409, 'запис без чекпойнт върху съществуващ файл е отказ');
    assert.equal(blind.data.error, 'PORTAL_CONFIG_CONFLICT', 'кодът е отделен');
    assert.equal(blind.data.currentHash, first.data.hash, 'отказът носи текущия хеш');
    const noHash = await api(base, 'PUT', { config: { ui_columns: 4 } });
    assert.equal(noHash.status, 400, 'липсващо поле expectHash е 400');
    assert.match(noHash.data.error, /HASH_REQUIRED/, 'кодът казва защо');

    const changed = await api(base, 'PUT', { config: { ui_columns: 4, notes: 'от панела' }, expectHash: first.data.hash });
    assert.equal(changed.status, 200, 'записът с верния чекпойнт минава: ' + JSON.stringify(changed.data).slice(0, 300));
    assert.ok(changed.data.revision > first.data.revision, 'ревизията расте');
    assert.notEqual(changed.data.hash, first.data.hash, 'хешът се сменя');
    assert.equal(changed.data.data.ui_columns, 4, 'промяната е записана');
    assert.ok(changed.data.applied.includes('notes'), 'опциите влизат и в записа: ' + JSON.stringify(changed.data.applied));

    const stale = await api(base, 'PUT', { config: { ui_columns: 2 }, expectHash: first.data.hash });
    assert.equal(stale.status, 409, 'стар чекпойнт се отказва');
    assert.equal(stale.data.currentHash, changed.data.hash, 'отказът носи новия хеш');
    assert.ok(stale.data.diff.some((d) => d.path === 'ui_columns'), 'и разликата по ключ: ' + JSON.stringify(stale.data.diff));

    // ── 3. export.yaml: файлът както е на диска ─────────────────────────────
    const exported = await authed(base + '/export.yaml');
    assert.equal(exported.status, 200, 'експортът минава');
    assert.match(exported.headers.get('content-type') || '', /application\/yaml/, 'типът е YAML');
    assert.equal(exported.headers.get('x-config-hash'), changed.data.hash, 'хешът е в заглавка');
    const text = await exported.text();
    assert.equal(text, fs.readFileSync(file, 'utf8'), 'тялото е точно файлът');
    assert.match(text, /^ui_columns: 4$/m, 'промяната е в експорта');

    // ── 4. import: цял YAML, чекпойнт в If-Match ────────────────────────────
    const noMatch = await authed(base + '/import', { method: 'POST', body: text });
    assert.equal(noMatch.status, 400, 'import без If-Match е отказ');
    const wrong = await authed(base + '/import', { method: 'POST', headers: { 'if-match': '"' + first.data.hash + '"' }, body: text });
    assert.equal(wrong.status, 409, 'import със стар хеш е конфликт');
    const edited = text.replace(/^notes: .*$/m, 'notes: от файл').replace(/^ui_columns: 4$/m, 'ui_columns: 2');
    const imported = await authed(base + '/import', { method: 'POST', headers: { 'if-match': '"' + changed.data.hash + '"' }, body: edited });
    assert.equal(imported.status, 200, 'import с верния хеш минава: ' + (await imported.clone().text()).slice(0, 200));
    const afterImport = await imported.json();
    assert.equal(afterImport.data.notes, 'от файл', 'съдържанието идва от тялото');
    assert.equal(afterImport.data.ui_columns, 2, 'всички опции се заменят');
    assert.equal(afterImport.data.id, first.data.data.id, 'идентификаторът не се издава наново');
    assert.equal(afterImport.data.files.length, 1, '`files[]` остава от описанието');

    // ── 4б. import?dry=1 показва разликата, без да пише ─────────────────────
    const beforeDry = fs.readFileSync(file, 'utf8');
    const dryText = beforeDry.replace(/^notes: .*$/m, 'notes: сухо');
    const dry = await authed(base + '/import?dry=1', { method: 'POST', headers: { 'if-match': '"' + afterImport.hash + '"' }, body: dryText });
    assert.equal(dry.status, 200, 'сухият импорт минава');
    const dryData = await dry.json();
    assert.equal(dryData.dry, true, 'отговорът е белязан като сух');
    assert.ok(dryData.diff.some((d) => d.path === 'notes'), 'разликата е по ключ: ' + JSON.stringify(dryData.diff));
    assert.equal(fs.readFileSync(file, 'utf8'), beforeDry, 'сухият импорт не е пипал файла');

    // ── 5. verify: излишен файл се вижда ────────────────────────────────────
    const verified = await api(base + '/verify', 'POST');
    assert.equal(verified.status, 200, 'verify минава');
    assert.equal(verified.data.ok, true, 'преди намесата папката съвпада: ' + JSON.stringify(verified.data));
    fs.writeFileSync(path.join(folder, 'добавен-направо.txt'), 'извън панела', 'utf8');
    const extra = await api(base + '/verify', 'POST');
    assert.deepEqual(extra.data.extra, ['/добавен-направо.txt'], 'файл, добавен направо в папката, е „излишен“: ' + JSON.stringify(extra.data.extra));
    assert.equal(extra.data.ok, false, 'разликата се вижда');

    // ── 6. adopt: ръчна промяна във файла влиза в базата ────────────────────
    const manual = fs.readFileSync(file, 'utf8').replace(/^name: .*$/m, 'name: Име от файла').replace(/^ui_columns: 2$/m, 'ui_columns: 3');
    fs.writeFileSync(file, manual, 'utf8');
    const adopted = await api(base + '/adopt', 'POST');
    assert.equal(adopted.status, 200, 'adopt минава: ' + JSON.stringify(adopted.data && adopted.data.applied));
    assert.ok(adopted.data.applied.includes('name'), 'името е внесено: ' + JSON.stringify(adopted.data.applied));
    const portalAfter = await api('/admin/api/portals/' + encodeURIComponent(portal.id), 'GET');
    assert.equal(portalAfter.data.title, 'Име от файла', 'базата вече носи името от файла');
    const afterAdopt = fs.readFileSync(file, 'utf8');
    assert.match(afterAdopt, /^ui_columns: 3$/m, 'ръчната настройка остава');
    assert.match(afterAdopt, /^name: Име от файла$/m, 'файлът е сглобен от записа, без да губи настройки');

    // ── 7. Липсващ файл: GET не пише, PUT с `expectHash: null` създава ──────
    const fresh = await api('/admin/api/portals', 'POST', { title: 'Нов портал', slug: 'p-nov', visibility: 'private' });
    const freshPortal = fresh.data.portal || fresh.data;
    const freshBase = '/admin/api/portals/' + encodeURIComponent(freshPortal.id) + '/config';
    const freshLogical = String(freshPortal.storage_root || '').replace(/^\/+/, '');
    const freshFile = path.join(storage.dir, ...freshLogical.split('/').filter(Boolean), 'configuration.yaml');
    fs.rmSync(freshFile, { force: true });
    const freshGet = await api(freshBase, 'GET');
    assert.equal(freshGet.data.exists, false, 'липсващият файл се вижда като `exists: false` (GET не пише)');
    assert.equal(fs.existsSync(freshFile), false, 'GET не е създал файл');
    assert.match(freshGet.data.data.id, /^p-nov-[a-z0-9-]+-001$/, 'GET предлага идентификатор');
    const createdFile = await api(freshBase, 'PUT', { config: { notes: 'първи запис' }, expectHash: null });
    assert.equal(createdFile.status, 200, 'създаването минава: ' + JSON.stringify(createdFile.data).slice(0, 200));
    assert.equal(createdFile.data.revision, 1, 'първата ревизия е 1');
    assert.equal(createdFile.data.exists, true, 'файлът вече съществува');

    // Чекпойнтът може да е и в заглавка `If-Match` (договор §27), не само в тялото.
    const viaHeader = await authed(freshBase, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'if-match': '"' + createdFile.data.hash + '"' },
      body: JSON.stringify({ config: { notes: 'втори запис' } }),
    });
    assert.equal(viaHeader.status, 200, 'PUT с If-Match минава: ' + (await viaHeader.clone().text()).slice(0, 200));
    assert.equal((await viaHeader.json()).data.notes, 'втори запис', 'промяната е записана');

    console.log(
      'PASS portal-config-api: GET с хеш · PUT иска expectHash и връща 409 при чужд запис · export.yaml · ' +
        'import с If-Match · verify вижда файл, добавен направо в папката · adopt внася ръчна промяна в базата',
    );
  } finally {
    await server.stop();
    fs.rmSync(storage.dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('FAIL portal-config-api: ' + error.message);
  process.exitCode = 1;
});
