'use strict';
// API за PGP ключове и експортни пакети: прикачане на ключ (без генерация),
// автоподписване, изтегляне на ZIP и на .asc, проверка на подписа и RBAC.
const { stopChild, freePort } = require('./helpers.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const pgp = require('../hapi_enterprise/pgp.js');
const ooxml = require('../hapi_enterprise/ooxml.js');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-package-api-'));
  const port = await freePort();
  const token = 'package-api-test-token-at-least-24-chars';
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: token },
    // Работната папка е на системния диск, за да сочи "/share" към <root>/share, а не към UNC пътя на хранилището.
    cwd: os.tmpdir(),
    stdio: 'ignore',
  });
  const call = async (p, method = 'GET', data, auth = true, headers = {}) => {
    const r = await fetch('http://127.0.0.1:' + port + p, {
      method,
      headers: { ...(auth ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      body: data,
    });
    const type = r.headers.get('content-type') || '';
    const value = type.includes('application/json') ? await r.json() : await r.arrayBuffer();
    return { status: r.status, value, headers: r.headers };
  };
  // Папката на портала винаги е под /share — в теста ползваме <root>/share/<уникална>.
  const storageBase = path.join(path.parse(os.tmpdir()).root, 'share');
  const storageDir = path.join(storageBase, `hapi-pkg-${process.pid}-${Math.random().toString(16).slice(2, 8)}`);
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try {
        if ((await call('/health')).status === 200) { ready = true; break; }
      } catch { }
      await new Promise((r) => setTimeout(r, 30));
    }
    assert(ready, 'сървърът трябва да стартира');

    // 1. Портал с два файла.
    const portal = (await call('/admin/api/portals', 'POST', JSON.stringify({ slug: 'pkg', title: 'Пакет', category: 'Правни дела', subject: 'посещение на лице' }), true, { 'Content-Type': 'application/json' })).value;
    const fileA = (await call(`/admin/api/portals/${portal.id}/files`, 'POST', 'съдържание А', true, { 'X-File-Name': 'A.txt' })).value;
    await call(`/admin/api/portals/${portal.id}/files`, 'POST', 'съдържание Б', true, { 'X-File-Name': 'B.txt' });

    // 2. Няма ключове → автоподписването не е възможно, но пакетът се създава.
    let list = (await call('/admin/api/pgp/keys')).value;
    assert.deepEqual(list.keys, []);
    assert.equal(list.settings.autoSign, false);
    // Автоподписване без прикачен ключ → 400 с ясно съобщение.
    const noKey = await call('/admin/api/packages/settings', 'PATCH', JSON.stringify({ autoSign: true }), true, { 'Content-Type': 'application/json' });
    assert.equal(noKey.status, 400);
    assert.match(noKey.value.error, /Няма прикачен PGP ключ/);

    const unsigned = (await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id, sign: false }), true, { 'Content-Type': 'application/json' }));
    assert.equal(unsigned.status, 201, JSON.stringify(unsigned.value));
    assert.equal(unsigned.value.hasSignature, false);
    assert.equal(unsigned.value.files, 2);

    // 3. ZIP-ът се изтегля и е валиден архив.
    const zip = await call(`/admin/api/packages/${unsigned.value.id}/download`);
    assert.equal(zip.status, 200);
    assert.equal(Buffer.from(zip.value).subarray(0, 2).toString(), 'PK');
    const crypto = require('node:crypto');
    assert.equal(crypto.createHash('sha256').update(Buffer.from(zip.value)).digest('hex'), unsigned.value.sha256);

    // 4. Прикачане на ключ (v4) — сървърът не генерира ключове.
    const v4 = pgp.generate({ algorithm: 'ed25519', userId: 'Пакети v4 <pkg4@example.test>' });
    const noSecret = await call('/admin/api/pgp/keys', 'POST', JSON.stringify({ label: 'Без секрет', publicArmored: v4.publicArmored }), true, { 'Content-Type': 'application/json' });
    assert.equal(noSecret.status, 400);
    assert.match(noSecret.value.error, /ПРИКАЧИ|Прикачи/i);
    const pubOnly = await call('/admin/api/pgp/keys', 'POST', JSON.stringify({ label: 'Само публичен', secretArmored: v4.publicArmored }), true, { 'Content-Type': 'application/json' });
    assert.equal(pubOnly.status, 400);
    assert.match(pubOnly.value.error, /Липсва секретен ключ/);

    const attach = { 'Content-Type': 'application/json' };
    const key = (await call('/admin/api/pgp/keys', 'POST', JSON.stringify({ label: 'Тестов ключ', secretArmored: v4.secretArmored }), true, attach));
    assert.equal(key.status, 201, JSON.stringify(key.value));
    assert.equal(key.value.hasSecret, true);
    assert.equal(key.value.version, 4);
    assert.equal(key.value.keyId, v4.keyId);
    assert.equal(key.value.secretEnc, undefined, 'секретният ключ никога не се връща');
    // Същият ключ втори път → 409.
    assert.equal((await call('/admin/api/pgp/keys', 'POST', JSON.stringify({ label: 'Дубъл', secretArmored: v4.secretArmored }), true, attach)).status, 409);

    const settings = (await call('/admin/api/packages/settings', 'PATCH', JSON.stringify({ autoSign: true, signKeyId: key.value.id }), true, { 'Content-Type': 'application/json' }));
    assert.equal(settings.status, 200);
    assert.equal(settings.value.autoSign, true);

    // 5. Автоподписан пакет (без изричен sign) + проверка.
    const signed = (await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id }), true, { 'Content-Type': 'application/json' }));
    assert.equal(signed.status, 201, JSON.stringify(signed.value));
    assert.equal(signed.value.hasSignature, true);
    assert.equal(signed.value.signature.keyId, key.value.keyId);
    assert.equal(signed.value.signature.hash, 'SHA-512');

    const asc = await call(`/admin/api/packages/${signed.value.id}/signature`);
    assert.equal(asc.status, 200);
    assert.match(Buffer.from(asc.value).toString('utf8'), /^-----BEGIN PGP SIGNATURE-----/);

    const zipSigned = Buffer.from((await call(`/admin/api/packages/${signed.value.id}/download`)).value);
    const pub = (await call(`/admin/api/pgp/keys/${key.value.id}/public`)).value;
    const direct = pgp.verifyDetached(zipSigned, Buffer.from(asc.value).toString('utf8'), pub.publicArmored);
    assert.equal(direct.valid, true, JSON.stringify(direct));

    const verified = (await call(`/admin/api/packages/${signed.value.id}/verify`, 'POST', '{}', true, { 'Content-Type': 'application/json' })).value;
    assert.equal(verified.valid, true, JSON.stringify(verified));

    // 5б. OpenPGP v6 (RFC 9580) ключ: прикачане, подписване и проверка.
    const v6 = pgp.generate({ algorithm: 'ed25519', version: 6, userId: 'Пакети v6 <pkg6@example.test>' });
    const key6 = (await call('/admin/api/pgp/keys', 'POST', JSON.stringify({ label: 'Ключ v6', secretArmored: v6.secretArmored }), true, attach)).value;
    assert.equal(key6.version, 6, JSON.stringify(key6));
    assert.equal(key6.fingerprint.length, 64, 'v6 отпечатъкът е SHA-256');
    const signed6 = (await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id, sign: true, keyId: key6.id }), true, attach));
    assert.equal(signed6.status, 201, JSON.stringify(signed6.value));
    assert.equal(signed6.value.hasSignature, true);
    assert.equal(signed6.value.signature.keyId, key6.keyId);
    const verify6 = (await call(`/admin/api/packages/${signed6.value.id}/verify`, 'POST', '{}', true, attach)).value;
    assert.equal(verify6.valid, true, JSON.stringify(verify6));
    // Премахването на единия от двата ключа НЕ изключва автоподписването.
    const removed6 = (await call(`/admin/api/pgp/keys/${key6.id}`, 'DELETE')).value;
    assert.equal(removed6.autoSign, true, 'остава втори ключ');
    assert.equal(removed6.keys, 1);

    // 6. Избор само на един файл.
    const partial = (await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id, fileIds: [fileA.id], sign: false }), true, { 'Content-Type': 'application/json' })).value;
    assert.equal(partial.files, 1);

    // 6b. Пълен пакет хешове за един файл (SHA-2 256/384/512, SHA3-256, SHA-1, MD5).
    const hashes = await call(`/admin/api/portals/${portal.id}/files/${fileA.id}/hashes`);
    assert.equal(hashes.status, 200, JSON.stringify(hashes.value));
    const rawA = Buffer.from('съдържание А', 'utf8');
    assert.equal(hashes.value.sha256, crypto.createHash('sha256').update(rawA).digest('hex'));
    assert.equal(hashes.value.sha512, crypto.createHash('sha512').update(rawA).digest('hex'));
    assert.equal(hashes.value.sha1, crypto.createHash('sha1').update(rawA).digest('hex'));
    assert.equal(hashes.value.md5, crypto.createHash('md5').update(rawA).digest('hex'));
    assert.equal(hashes.value.size, rawA.length);
    assert.equal(hashes.value.name, 'A.txt');
    assert.ok(hashes.value.computedAt);
    // Пълният набор: списък с алгоритми + обект с всички стойности + сверка с регистрирания.
    assert.ok(Array.isArray(hashes.value.algorithms) && hashes.value.algorithms.includes('sha256'));
    assert.ok(hashes.value.algorithms.includes('sha512'));
    assert.match(hashes.value.hashes.sha256, /^[a-f0-9]{64}$/);
    assert.match(hashes.value.hashes.sha512, /^[a-f0-9]{128}$/);
    assert.match(hashes.value.hashes.sha1, /^[a-f0-9]{40}$/);
    assert.match(hashes.value.hashes.md5, /^[a-f0-9]{32}$/);
    if (hashes.value.algorithms.includes('sha3-256')) assert.match(hashes.value.hashes['sha3-256'], /^[a-f0-9]{64}$/);
    if (hashes.value.algorithms.includes('sha384')) assert.match(hashes.value.hashes.sha384, /^[a-f0-9]{96}$/);
    assert.equal(hashes.value.match, true);
    assert.equal(hashes.value.registered.sha256, hashes.value.sha256);
    assert.equal(hashes.value.warning, undefined, 'регистрираният хеш съвпада');
    assert.equal((await call(`/admin/api/portals/${portal.id}/files/missing/hashes`)).status, 404);

    // 6c. Пакет с всички файлове от папката на портала (storage_root).
    let storageReady = false;
    try {
      fs.mkdirSync(path.join(storageDir, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(storageDir, 'readme.txt'), 'от хранилището');
      fs.writeFileSync(path.join(storageDir, 'sub', 'deep.csv'), 'a,b\n1,2\n');
      fs.writeFileSync(path.join(storageDir, '.hidden'), 'скрит');
      storageReady = true;
    } catch {
      // Среда без права за запис в /share — проверяваме само ясната грешка.
    }
    const storageRoot = '/share/' + path.basename(storageDir);
    if (storageReady) {
      const patched = (await call(`/admin/api/portals/${portal.id}`, 'PATCH', JSON.stringify({ storage_root: storageRoot }), true, { 'Content-Type': 'application/json' }));
      assert.equal(patched.status, 200, JSON.stringify(patched.value));
      assert.equal(patched.value.storage_root, storageRoot);
      const full = await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id, sign: false, includeStorage: true }), true, { 'Content-Type': 'application/json' });
      assert.equal(full.status, 201, JSON.stringify(full.value));
      assert.equal(full.value.files, 4, 'два регистрирани + два от хранилището');
      assert.equal(full.value.storageFiles, 2);
      assert.equal(full.value.storageRoot, storageRoot);
      const zipFull = Buffer.from((await call(`/admin/api/packages/${full.value.id}/download`)).value);
      assert.ok(zipFull.includes('storage/readme.txt'), 'файловете от хранилището са в архива с относителен път');
      assert.ok(zipFull.includes('storage/sub/deep.csv'), 'подпапките се запазват');
      assert.equal(zipFull.includes('.hidden'), false, 'скритите файлове се пропускат');
      const unzipped = ooxml.unzip(zipFull);
      const indexJson = unzipped.get('PACKAGE_INDEX.json')().toString('utf8');
      assert.match(indexJson, /"source": "storage"/, 'индексът отбелязва произхода на файла');
      assert.match(indexJson, /storage\/sub\/deep\.csv/);
    }
    // Празна/липсваща папка при портал без регистрирани файлове → 404, а не празен пакет.
    const bare = (await call('/admin/api/portals', 'POST', JSON.stringify({ slug: 'bare', title: 'Празен', storage_root: '/share/hapi-missing-' + Date.now() }), true, { 'Content-Type': 'application/json' })).value;
    const noFiles = await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: bare.id, sign: false, includeStorage: true }), true, { 'Content-Type': 'application/json' });
    assert.equal(noFiles.status, 404);
    assert.match(noFiles.value.error, /Папката на портала е празна или липсва/);

    // 7. Списък, метаданни, изтриване.
    list = (await call('/admin/api/packages')).value;
    assert.ok(list.packages.length >= 3);
    assert.equal((await call(`/admin/api/packages/${partial.id}`)).value.id, partial.id);
    assert.equal((await call(`/admin/api/packages/${partial.id}`, 'DELETE')).value.removed, true);
    assert.equal((await call(`/admin/api/packages/${partial.id}`)).status, 404);

    // 8. Валидации и права.
    assert.equal((await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: 'nope' }), true, { 'Content-Type': 'application/json' })).status, 404);
    assert.equal((await call('/admin/api/packages/settings', 'PATCH', JSON.stringify({ signKeyId: 'missing' }), true, { 'Content-Type': 'application/json' })).status, 400);
    assert.equal((await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id, sign: true }), false, { 'Content-Type': 'application/json' })).status, 401);
    assert.equal((await call('/admin/api/pgp/keys', 'GET', undefined, false)).status, 401);

    // 9. Ключът се пази криптиран в хранилището (не в чист вид).
    const snap = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
    assert.equal(snap.includes('BEGIN PGP PRIVATE KEY BLOCK'), false, 'секретният ключ не е в чист вид');
    assert.match(snap, /"secretEnc":/, 'секретът е записан само в криптиран вид');

    // 10. Премахване на последния ключ изчиства и настройката.
    const removedLast = (await call(`/admin/api/pgp/keys/${key.value.id}`, 'DELETE')).value;
    assert.equal(removedLast.removed, key.value.id);
    assert.equal(removedLast.autoSign, false, 'без ключ автоподписването се изключва');
    assert.equal((await call('/admin/api/packages')).value.settings.signKeyId, '');
    // Повторно включване вече не е възможно без ключ.
    assert.equal((await call('/admin/api/packages/settings', 'PATCH', JSON.stringify({ autoSign: true }), true, attach)).status, 400);

    console.log('package-api OK');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
