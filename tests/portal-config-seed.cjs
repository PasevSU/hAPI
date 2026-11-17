'use strict';
// ВСЕКИ ПОРТАЛ НОСИ СВОЕТО `configuration.yaml` (план 23, фаза 1 — първа стъпка).
//
// Какво пази този тест: описанието се създава в САМАТА папка на портала, с пълните
// подразбирания, чете се обратно без проблеми и НЕ се презаписва при второ докосване — иначе
// първата ръчна промяна на човек би изчезнала при следващия старт. Проверява се и че файлът не
// се брои за съдържание (не се показва в дървото на портала).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startServer } = require('./lib/gui-harness.cjs');
const { storageRoot } = require('./helpers.cjs');
const portalConfig = require(path.join(__dirname, '..', 'hapi_enterprise', 'portal-config.js'));

(async () => {
  const storage = storageRoot();
  const server = await startServer({
    env: { ...storage.env, PORTAL_FOLDER_COPY: 'true' },
  });
  try {
    const created = await server.api('/admin/api/portals', 'POST', {
      title: 'Портал с описание',
      slug: 's-opisanie',
      visibility: 'public',
    });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data).slice(0, 200));
    const portal = created.data.portal || created.data;
    assert.ok(portal && portal.id, 'отговорът носи идентификатора на портала');

    // Качване: то копира байтовете в папката на портала и създава самата папка. Името на файла
    // върви в заглавка, а тялото е самите байтове — затова тук е `fetch`, не `api()`.
    const upload = async (name, body) =>
      fetch(server.base + '/admin/api/portals/' + encodeURIComponent(portal.id) + '/files', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + server.token, 'x-file-name': encodeURIComponent(name) },
        body,
      }).then((r) => ({ status: r.status, text: r.text() }));
    const first = await upload('dokument.txt', 'съдържание');
    assert.ok([200, 201].includes(first.status), 'файлът се качва: ' + first.status);

    // Папката се взима от САМИЯ портал (`storage_root`), а логическият път (`/share/...`) се
    // превежда към ВРЕМЕННИЯ корен на теста — така тестът не строи „<диск>:\share“ и не бърка
    // двойно „share“ (вж. `storage-roots`).
    const logical = String(portal.storage_root || '').replace(/^\/+/, '');
    const folder = path.join(storage.dir, ...logical.split('/').filter(Boolean));
    const file = path.join(folder, 'configuration.yaml');
    assert.ok(fs.existsSync(file), 'описанието е в папката на портала: ' + file);

    // ── Съдържанието: пълно описание, което минава проверката ────────────────
    const read = portalConfig.read(file, { slug: 's-opisanie' });
    assert.deepEqual(read.problems, [], 'прочетеното описание е валидно: ' + JSON.stringify(read.problems));
    assert.equal(read.data.portal.slug, 's-opisanie', 'описанието знае коя папка е');
    assert.equal(read.data.portal.title, 'Портал с описание', 'заглавието идва от портала');
    assert.equal(read.data.version, 1, 'версията на формата е 1');
    assert.ok(read.data.revision >= 1, 'ревизията започва от 1');
    const eff = portalConfig.effective(read.data);
    for (const key of ['access', 'qr', 'folders', 'storage', 'ui', 'audit']) {
      assert.ok(eff[key] && typeof eff[key] === 'object', 'в описанието стои и разделът „' + key + '“');
    }

    // ── Ръчна промяна не се губи при повторно докосване ────────────────────
    const before = fs.readFileSync(file, 'utf8');
    const edited = before.replace('portal:', 'portal:').replace('notes: ""', 'notes: "ръчна бележка"');
    fs.writeFileSync(file, edited, 'utf8');
    assert.equal(fs.readFileSync(file, 'utf8'), edited, 'файлът е променен на ръка');

    // Второ качване минава през същата папка — описанието трябва да остане ръчното.
    const second = await upload('vtori.txt', 'второ');
    assert.ok([200, 201].includes(second.status), 'вторият файл се качва: ' + second.status);
    assert.match(fs.readFileSync(file, 'utf8'), /ръчна бележка/, 'ръчната промяна е запазена (описанието не се презаписва)');

    // ── Не е съдържание: дървото на портала не го показва ──────────────
    const tree = await server.api('/admin/api/portals/' + encodeURIComponent(portal.id) + '/tree');
    assert.ok(tree.status === 200, 'дървото се чете: ' + tree.status);
    const names = JSON.stringify(tree.data || {});
    assert.equal(names.includes('configuration.yaml'), false, 'описанието не е файл на портала в дървото');

    console.log(
      'PASS portal-config-seed: всяка папка на портал получава configuration.yaml с пълните подразбирания · ' +
        'минава собствената си проверка · ръчна промяна НЕ се презаписва · не се брои за съдържание',
    );
  } finally {
    await server.stop();
    fs.rmSync(storage.dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('FAIL portal-config-seed: ' + error.message);
  process.exitCode = 1;
});
