'use strict';
// СИНХРОНИЗАЦИЯ ФАЙЛ → БАЗА В `configuration.yaml` (план 23, стъпка 1).
//
// Какво пази този тест: описанието в папката на портала не е снимка от създаването, а ЖИВА
// карта — при качване, триене и повторно качване `files[]` се обновява, а `revision` расте
// само когато съдържанието наистина се е променило. Проверява се и обратното: счупен файл не
// се презаписва (чужда работа не се губи) и качването не пада заради него.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startServer } = require('./lib/gui-harness.cjs');
const { storageRoot } = require('./helpers.cjs');
const portalConfig = require(path.join(__dirname, '..', 'hapi_enterprise', 'portal-config.js'));

const ok = (r) => r.status === 200 || r.status === 201;

(async () => {
  const storage = storageRoot();
  const server = await startServer({ env: { ...storage.env, PORTAL_FOLDER_COPY: 'true' } });
  const upload = (portalId, name, body, encrypt) =>
    fetch(server.base + '/admin/api/portals/' + encodeURIComponent(portalId) + '/files', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + server.token,
        'x-file-name': encodeURIComponent(name),
        ...(encrypt ? { 'x-file-encrypt': '1' } : {}),
      },
      body,
    }).then(async (r) => ({ status: r.status, text: await r.text() }));
  try {
    const created = await server.api('/admin/api/portals', 'POST', {
      title: 'Портал със синхронизация',
      slug: 'p-sync',
      visibility: 'public',
    });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data).slice(0, 200));
    const portal = created.data.portal || created.data;
    const logical = String(portal.storage_root || '').replace(/^\/+/, '');
    const folder = path.join(storage.dir, ...logical.split('/').filter(Boolean));
    const file = path.join(folder, 'configuration.yaml');
    assert.ok(fs.existsSync(file), 'описанието е в папката на портала');

    const readConfig = () => portalConfig.read(file, { slug: 'p-sync' });

    // ── 1. Качване → `files[]` научава за файла ──────────────────────────────
    const first = await upload(portal.id, 'dogovor.txt', 'първи');
    assert.ok(ok(first), 'първият файл се качва: ' + first.status);
    const afterFirst = readConfig();
    assert.deepEqual(afterFirst.problems, [], 'описанието е валидно: ' + JSON.stringify(afterFirst.problems));
    assert.equal(afterFirst.data.files.length, 1, 'един файл в описанието');
    assert.equal(afterFirst.data.files[0].path, '/dogovor.txt', 'пътят е този в папката на портала');
    assert.equal(afterFirst.data.files[0].size, Buffer.byteLength('първи', 'utf8'), 'размерът е на байтовете');
    assert.match(afterFirst.data.files[0].sha256, /^[0-9a-f]{64}$/, 'отпечатъкът е sha256');
    assert.equal(afterFirst.data.files[0].access, 'free', 'достъпът по подразбиране е свободен');
    assert.equal(afterFirst.data.files[0].listed, true, 'файлът е в списъка');
    const revisionAfterFirst = afterFirst.data.revision;

    // ── 2. Втори файл → втори запис, без да се губи първият ──────────────────
    const second = await upload(portal.id, 'vtori.txt', 'втори');
    assert.ok(ok(second), 'вторият файл се качва: ' + second.status);
    const afterSecond = readConfig();
    assert.deepEqual(afterSecond.problems, [], 'описанието е валидно и с два файла');
    assert.deepEqual(
      afterSecond.data.files.map((f) => f.path),
      ['/dogovor.txt', '/vtori.txt'],
      'двата пътя са в описанието, подредени по път',
    );
    assert.ok(afterSecond.data.revision > revisionAfterFirst, 'ревизията расте при промяна на съдържанието');

    // ── 3. Нищо не се е променило → файлът не се пипа ────────────────────────
    const before = fs.readFileSync(file, 'utf8');
    const patched = await server.api('/admin/api/portals/' + encodeURIComponent(portal.id), 'PATCH', { title: 'Портал със синхронизация' });
    assert.equal(patched.status, 200, 'PATCH със същото заглавие минава: ' + patched.status);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'без промяна файлът остава байт по байт същият');
    assert.equal(readConfig().data.revision, afterSecond.data.revision, 'ревизията не расте от празна промяна');

    // ── 4. Едноименно качване → два РАЗЛИЧНИ пътя (иначе проверката пада) ────
    const again = await upload(portal.id, 'dogovor.txt', 'трети');
    assert.ok(ok(again), 'едноименният файл се качва: ' + again.status);
    const afterThird = readConfig();
    assert.deepEqual(afterThird.problems, [], 'описанието е валидно и след едноименно качване');
    const paths = afterThird.data.files.map((f) => f.path);
    assert.equal(paths.length, 3, 'три файла в описанието: ' + paths.join(', '));
    assert.equal(new Set(paths.map((p) => p.toLowerCase())).size, 3, 'пътищата са уникални: ' + paths.join(', '));

    // ── 5. Шифрован файл не е в папката, но е в описанието (виртуален път) ───
    const secret = await upload(portal.id, 'tajna.txt', 'тайна', true);
    assert.ok(ok(secret), 'шифрованият файл се качва: ' + secret.status);
    const afterSecret = readConfig();
    assert.deepEqual(afterSecret.problems, [], 'описанието е валидно и с шифрован файл');
    const virtual = afterSecret.data.files.filter((f) => f.path === '/tajna.txt');
    assert.equal(virtual.length, 1, 'шифрованият файл е описан с виртуален път /tajna.txt');
    assert.equal(fs.existsSync(path.join(folder, 'tajna.txt')), false, 'но НЕ е в папката — открит текст не се слага там');

    // ── 6. Триене → записът изчезва от описанието ────────────────────────────
    const listed = await server.api('/admin/api/portals/' + encodeURIComponent(portal.id));
    assert.equal(listed.status, 200, 'порталът се чете: ' + listed.status);
    const victim = (listed.data.files || []).find((f) => f.name === 'vtori.txt');
    assert.ok(victim && victim.id, 'намерен е файлът за триене');
    const removed = await server.api('/admin/api/portals/' + encodeURIComponent(portal.id) + '/files/' + encodeURIComponent(victim.id), 'DELETE');
    assert.equal(removed.status, 200, 'файлът се трие: ' + removed.status);
    const afterDelete = readConfig();
    assert.deepEqual(afterDelete.problems, [], 'описанието остава валидно след триене');
    assert.equal(afterDelete.data.files.some((f) => f.path === '/vtori.txt'), false, 'изтритият файл го няма в описанието');
    assert.ok(afterDelete.data.revision > afterSecret.data.revision, 'ревизията расте при триене');

    // ── 7. Счупен файл не се презаписва, а качването пак минава ──────────────
    const broken = 'това: [не е затворено\n';
    fs.writeFileSync(file, broken, 'utf8');
    const afterBroken = await upload(portal.id, 'posle.txt', 'след счупването');
    assert.ok(ok(afterBroken), 'качването не пада заради счупено описание: ' + afterBroken.status);
    assert.equal(fs.readFileSync(file, 'utf8'), broken, 'счупеният файл е оставен както е — чужда работа не се губи');
    const problems = portalConfig.read(file, { slug: 'p-sync' }).problems;
    assert.ok(problems.length > 0, 'файлът наистина е невалиден (иначе проверката е празна)');

    console.log(
      'PASS portal-config-sync: качване/триене обновяват `files[]` · празна промяна не вдига ревизията · ' +
        'едноименни файлове с различни пътища · шифрован файл е описан, но не е в папката · счупено описание не се презаписва',
    );
  } finally {
    await server.stop();
    fs.rmSync(storage.dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
