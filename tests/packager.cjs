'use strict';
// Пакетиране: ZIP структура, манифест, хешове, PGP подпис и живот на артефактите.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const packager = require('../hapi_enterprise/packager.js');
const ooxml = require('../hapi_enterprise/ooxml.js');
const pgp = require('../hapi_enterprise/pgp.js');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-pack-'));
  const p = packager.create({ root });
  const portal = { id: 'p1', slug: 'case-2026-114', title: 'Дело 2026-114', category: 'Правни дела', subject: 'посещение на лице', flag: 'important', storage_root: '/share/case' };
  const files = [
    { name: 'протокол.pdf', data: Buffer.from('PDF-1') },
    { name: 'протокол.pdf', data: Buffer.from('PDF-2') }, // същото име → уникализира се
    { name: '../../etc/passwd', data: Buffer.from('nope') }, // опасен път → само името
  ];

  const key = pgp.generate({ algorithm: 'ed25519', userId: 'Пакети <pack@example.test>' });
  const meta = await p.build({ portal, files, sign: { secretArmored: key.secretArmored, keyId: key.keyId, label: 'Пакети' } });

  // 1. Метаданни
  assert.match(meta.id, /^[a-f0-9]{24}$/);
  assert.equal(meta.files, 3);
  assert.equal(meta.hasSignature, true);
  assert.equal(meta.signature.keyId, key.keyId);
  assert.match(meta.fileName, /^case-2026-114-\d{8}-\d{6}\.zip$/);
  assert.ok(Date.parse(meta.expiresAt) > Date.parse(meta.createdAt));

  // 2. ZIP съдържание
  const zipBuf = fs.readFileSync(path.join(p.dir, `${meta.id}.zip`));
  assert.equal(crypto.createHash('sha256').update(zipBuf).digest('hex'), meta.sha256);
  const entries = ooxml.unzip(zipBuf);
  assert.ok(entries.has('PACKAGE_INDEX.json'));
  assert.ok(entries.has('manifest/portal.json'));
  assert.ok(entries.has('hashes/sha256sum.txt'));
  assert.ok(entries.has('originals/протокол.pdf'));
  assert.ok(entries.has('originals/протокол-2.pdf'));
  assert.ok(entries.has('originals/passwd'), 'опасният път се смалява до име на файл');
  assert.equal(entries.get('originals/протокол.pdf')().toString(), 'PDF-1');

  // 3. Индекс и хешове
  const index = JSON.parse(entries.get('PACKAGE_INDEX.json')().toString('utf8'));
  assert.equal(index.portal.slug, 'case-2026-114');
  assert.equal(index.files.length, 3);
  assert.equal(index.signature.status, 'signed');
  assert.equal(index.signature.key_id, key.keyId);
  const sums = entries.get('hashes/sha256sum.txt')().toString('utf8').trim().split('\n');
  assert.equal(sums.length, 3);
  for (const line of sums) assert.match(line, /^[a-f0-9]{64} {2}originals\/.+$/);
  // Пълният пакет хешове: индексът носи всички алгоритми за всеки файл,
  // а hashes/checksums.txt ги изброява четливо (един блок на файл).
  assert.equal(index.schema_version, '1.1');
  assert.ok(Array.isArray(index.hash_algorithms) && index.hash_algorithms.includes('sha256'));
  for (const entry of index.files) {
    for (const algo of index.hash_algorithms) {
      assert.match(entry.hashes[algo], /^[a-f0-9]+$/, `${algo} липсва за ${entry.path}`);
    }
    assert.equal(entry.hashes.sha256, entry.sha256);
  }
  const checksums = entries.get('hashes/checksums.txt')().toString('utf8');
  assert.match(checksums, /^# originals\/протокол\.pdf \(\d+ B\)/m);
  for (const algo of index.hash_algorithms) assert.ok(checksums.includes(`\n${algo}\t`), `няма ${algo} в checksums.txt`);
  const manifest = JSON.parse(entries.get('manifest/portal.json')().toString('utf8'));
  assert.equal(manifest.counts.files, 3);
  assert.deepEqual(manifest.hash_algorithms, index.hash_algorithms);
  assert.match(manifest.verification, /hashes\/checksums\.txt/);
  assert.equal(manifest.portal.subject, 'посещение на лице');

  // 4. Подписът покрива точно ZIP-а
  const armored = fs.readFileSync(path.join(p.dir, `${meta.id}.zip.asc`), 'utf8');
  const verified = pgp.verifyDetached(zipBuf, armored, key.publicArmored);
  assert.equal(verified.valid, true, JSON.stringify(verified));

  // 5. Без подпис
  const plain = await p.build({ portal, files: [{ name: 'a.txt', data: Buffer.from('a') }], sign: null });
  assert.equal(plain.hasSignature, false);
  assert.equal(plain.signature.status, 'unsigned');
  assert.equal(fs.existsSync(path.join(p.dir, `${plain.id}.zip.asc`)), false);

  // 6. Списък, четене, артефакти
  const all = await p.list();
  assert.equal(all.length, 2);
  assert.equal((await p.readMeta(meta.id)).sha256, meta.sha256);
  const zipArtifact = await p.artifact(meta.id, 'zip');
  assert.ok(zipArtifact.stat.size === meta.size);
  const sigArtifact = await p.artifact(meta.id, 'signature');
  assert.match(sigArtifact.name, /\.zip\.asc$/);

  // 7. Невалидни входове
  await assert.rejects(() => p.build({ portal, files: [], sign: null }), /празен/i);
  await assert.rejects(() => p.build({ portal, files: [{ name: 'x', data: 'не е buffer' }], sign: null }), /данни/i);
  await assert.rejects(() => p.artifact('../evil', 'zip'), /Невалиден идентификатор/);

  // 8. Премахване и почистване
  assert.equal((await p.remove(plain.id)).removed, true);
  assert.equal(await p.readMeta(plain.id), null);
  const old = await p.build({ portal, files: [{ name: 'b.txt', data: Buffer.from('b') }], sign: null, ttlHours: 1 });
  const pruned = await p.prune({ maxAgeHours: 1, now: new Date(Date.now() + 2 * 3600_000) });
  assert.ok(pruned.removed.includes(old.id));
  assert.ok(pruned.removed.includes(meta.id));

  fs.rmSync(root, { recursive: true, force: true });
  console.log('packager OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
