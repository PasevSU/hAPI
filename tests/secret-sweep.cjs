'use strict';
// Почистването на тайни връзки (`sweep`) НЕ бива да трие това, което не е успяло да прочете.
//
// Защо има отделен тест: `sweep` се вика от маршрута на списъка и след всяко създаване, тоест
// минава често. Старата реализация питаше `read()`, който поглъщаше ВСЯКА грешка и връщаше
// `null` — а `null` значеше „невалиден запис, трий“. Така една моментна грешка на диска
// (EACCES, EIO, EMFILE) изтриваше валидна тайна, която още никой не е отворил. Тук се
// проверява и обратната посока: изтеклите, изчерпаните и повредените записи СЕ трият, за да
// не се превърне поправката в „не чисти нищо“.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const secretLinks = require('../hapi_enterprise/secret-links');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-sweep-'));
const envelope = { v: 2, iv: 'A'.repeat(16), ct: 'AAAA' };
const hashOf = (n) => String(n).repeat(64).slice(0, 64);

async function write(body, hash) {
  const rec = secretLinks.createRecord({ envelope, idHash: hash, expiresIn: 3600, maxViews: 5 }, () => Date.parse('2026-01-01T00:00:00Z'));
  const record = { ...rec.record, ...body };
  await secretLinks.save(root, record);
  return secretLinks.recordPath(root, hash);
}

(async () => {
  const liveHash = hashOf('a');
  const livePath = await write({}, liveHash);

  // Живата тайна оцелява при пусто почистване.
  assert.equal(await secretLinks.sweep(root, () => Date.parse('2026-01-01T00:00:00Z')), 0, 'нищо не се трие, когато всичко е валидно');
  assert.ok(fs.existsSync(livePath), 'живата тайна е на място');

  // ── 1. Изтекла и изчерпана се трият (обратната посока на поправката) ──────
  const expiredPath = await write({ expiresAt: '2025-12-31T00:00:00.000Z' }, hashOf('b'));
  const usedPath = await write({ views: 5 }, hashOf('c'));
  assert.equal(await secretLinks.sweep(root, () => Date.parse('2026-01-01T00:00:00Z')), 2, 'изтеклата и изчерпаната се трият');
  assert.ok(!fs.existsSync(expiredPath), 'изтеклата е изтрита');
  assert.ok(!fs.existsSync(usedPath), 'изчерпаната е изтрита');
  assert.ok(fs.existsSync(livePath), 'живата не е пипната');

  // ── 2. Повреден файл и объркан idHash се трият ───────────────────────────
  const corruptPath = path.join(secretLinks.secretsDir(root), hashOf('d') + '.json');
  fs.writeFileSync(corruptPath, '{ това не е JSON');
  // Името на файла е `sha256(id)`; запис с друг `idHash` вътре е подменен (не се показва).
  const swapped = secretLinks.createRecord({ envelope, idHash: hashOf('e') }, () => Date.parse('2026-01-01T00:00:00Z')).record;
  const swappedPath = path.join(secretLinks.secretsDir(root), hashOf('f') + '.json');
  fs.writeFileSync(swappedPath, JSON.stringify(swapped));
  assert.equal(await secretLinks.sweep(root, () => Date.parse('2026-01-01T00:00:00Z')), 2, 'повреденият и подмененият се трият');
  assert.ok(!fs.existsSync(corruptPath), 'нечетимият JSON е изтрит');
  assert.ok(!fs.existsSync(swappedPath), 'запис с чужд idHash е изтрит');

  // ── 3. ГРЕШКАТА НА ДИСКА НЕ ТРИЕ: това е поправката ──────────────────────
  // Четенето се проваля за ВСИЧКИ файлове, както при отнето право или зает диск.
  const original = fsp.readFile;
  const seen = [];
  fsp.readFile = async () => { throw Object.assign(new Error('disk says no'), { code: 'EACCES' }) };
  let removed;
  try {
    removed = await secretLinks.sweep(root, () => Date.parse('2026-01-01T00:00:00Z'), (s) => seen.push(s));
  } finally {
    fsp.readFile = original;
  }
  assert.equal(removed, 0, 'не се трие нищо, което не е прочетено');
  assert.ok(fs.existsSync(livePath), 'валидната тайна оцелява при грешка на диска');
  assert.equal(seen.length, 1, 'пропускът се съобщава, вместо да се губи');
  assert.equal(seen[0].error, 'EACCES', 'съобщава се истинската причина');
  assert.equal(seen[0].hash, liveHash, 'съобщава се кой запис е пропуснат');

  // ── 4. `readRecord` различава „липсва“ от „повреден“ ─────────────────────
  assert.equal((await secretLinks.readRecord(root, liveHash)).error, '', 'валидният се чете');
  assert.equal((await secretLinks.readRecord(root, hashOf('9'))).error, 'missing', 'липсващият се разпознава');
  const brokenPath = path.join(secretLinks.secretsDir(root), hashOf('8') + '.json');
  fs.writeFileSync(brokenPath, 'не е json');
  assert.equal((await secretLinks.readRecord(root, hashOf('8'))).error, 'corrupt', 'повреденият се разпознава');
  fs.unlinkSync(brokenPath);

  // ── 5. `read` пази стария договор (запис или null) ───────────────────────
  assert.equal((await secretLinks.read(root, liveHash)).idHash, liveHash, 'read връща записа');
  assert.equal(await secretLinks.read(root, hashOf('9')), null, 'read връща null за липсващ');
  assert.equal(await secretLinks.read(root, 'не-хеш'), null, 'read не приема не-хеш');

  console.log('PASS secret sweep: изтекла/изчерпана/повредена се трият, а нечетима заради грешка на диска ОЦЕЛЯВА и се съобщава');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
