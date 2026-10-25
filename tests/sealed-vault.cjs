'use strict';
// ПЕЧАТЪТ на WORM (`worm.js` → `vaultPut`/`vaultCheck`/`vaultRestore`).
//
// Редът от `PLAN_STATUS` §4.1 казваше: „`chmod` пази от презаписване, не от ИЗТРИВАНЕ“.
// `chmod` си остава същото — затова тук се проверява ДРУГИЯТ механизъм, който наистина
// отговаря на въпроса „какво става, ако някой изтрие файла“:
//   • байтовете влизат в печат, адресиран по SHA-256 на съдържанието си;
//   • изтриването на работния файл НЕ ги унищожава — `vaultCheck` показва „липсва“ срещу
//     „наличен“, вместо само да отчете загуба;
//   • `vaultRestore` ги връща и проверява хеша при връщането;
//   • печат с чужд хеш не се записва (иначе би „потвърдил“ вече подменен файл);
//   • връщането не презаписва мълчаливо нещо, което някой е сложил на мястото.
//
// Точност: печатът НЕ прави файла физически неизтриваем (който има права върху `.worm`,
// може да изтрие и него). Тестът проверява това, което модулът обещава — оцеляване и
// връщане, не „никоя роля не може да изтрие“.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { create, VAULT_NAME } = require('../hapi_enterprise/worm.js');

const cases = [];
const ok = (label) => cases.push(label);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-vault-'));
  const portalDir = path.join(root, 'p_1');
  await fsp.mkdir(portalDir, { recursive: true });
  const fileA = path.join(portalDir, 'a.txt');
  const bytesA = Buffer.from('доказателство А — байтовете, които не бива да изчезнат');
  await fsp.writeFile(fileA, bytesA);
  const shaA = sha256(bytesA);

  const events = [];
  const worm = create({ filesRoot: root, audit: (name, details) => events.push({ name, details }) });

  // ── 1. Печатът е адресиран по съдържанието си ─────────────────────────────
  const put = await worm.vaultPut(fileA, shaA);
  assert.deepEqual({ ok: put.ok, created: put.created, sha256: put.sha256 }, { ok: true, created: true, sha256: shaA });
  const sealedFile = path.join(root, VAULT_NAME, shaA);
  assert.equal(fs.existsSync(sealedFile), true, 'печатът е .worm/<sha256>');
  assert.deepEqual(fs.readFileSync(sealedFile), bytesA, 'байтовете в печата са същите');
  assert.equal((await worm.vaultStats()).objects, 1, 'един обект в печата');
  ok('печатът е `<filesRoot>/.worm/<sha256>` и съдържа същите байтове');

  // ── 2. Повторно слагане не презаписва ─────────────────────────────────────
  const again = await worm.vaultPut(fileA, shaA);
  assert.deepEqual({ ok: again.ok, created: again.created }, { ok: true, created: false }, 'втори път: вече е там, не се пише');
  ok('повторно слагане на същите байтове е идемпотентно');

  // ── 3. Печат с чужд хеш НЕ се записва ─────────────────────────────────────
  const fileLi = path.join(portalDir, 'liar.txt');
  await fsp.writeFile(fileLi, 'подменено съдържание');
  const lie = await worm.vaultPut(fileLi, shaA);
  assert.equal(lie.ok, false);
  assert.equal(lie.reason, 'SHA_MISMATCH', 'манифестът казва друг хеш → отказ, а не „готово“');
  assert.equal(fs.existsSync(path.join(root, VAULT_NAME, lie.sha256)), false, 'чуждото съдържание не влиза в печата');
  ok('файл, който не отговаря на хеша от манифеста, не се подпечатва');

  // ── 4. Изтриването на работния файл НЕ унищожава байтовете ────────────────
  await fsp.rm(fileA);
  const afterDelete = await worm.vaultCheck([{ path: fileA, sha256: shaA }]);
  assert.equal(afterDelete.ok, false, 'липсващият работен файл е находка, не „наред“');
  assert.equal(afterDelete.problems[0].working, 'missing');
  assert.equal(afterDelete.problems[0].sealed, 'ok', 'байтовете са в печата');
  assert.deepEqual(fs.readFileSync(sealedFile), bytesA, 'изтриването не е пипнало печата');
  ok('след изтриване: „работен: липсва“, „печат: наличен“ — байтовете оцеляват');

  // ── 5. Връщането дава същите байтове ──────────────────────────────────────
  const restored = await worm.vaultRestore({ path: fileA, sha256: shaA });
  assert.equal(restored.ok, true);
  assert.equal(restored.restored, true);
  assert.equal(sha256(fs.readFileSync(fileA)), shaA, 'върнатият файл има същия хеш');
  const afterRestore = await worm.vaultCheck([{ path: fileA, sha256: shaA }]);
  assert.equal(afterRestore.ok, true, 'след връщане проверката е чиста');
  ok('`vaultRestore` връща същите байтове и проверката става чиста');

  // ── 6. Подменен работен файл се вижда като „changed“, не като „ok“ ────────
  await fsp.writeFile(fileA, 'друг текст');
  const changed = await worm.vaultCheck([{ path: fileA, sha256: shaA }]);
  assert.equal(changed.problems[0].working, 'changed', 'различен хеш се казва „changed“');
  assert.equal(changed.problems[0].sealed, 'ok');
  ok('подменен файл: „работен: changed“, а не тихо „ok“');

  // ── 7. Връщане върху съществуващ файл иска изрично разрешение ─────────────
  const refuse = await worm.vaultRestore({ path: fileA, sha256: shaA });
  assert.equal(refuse.ok, false);
  assert.equal(refuse.reason, 'TARGET_EXISTS', 'връщането не подменя мълчаливо чуждо съдържание');
  assert.equal(fs.readFileSync(fileA, 'utf8'), 'друг текст', 'файлът е недокоснат');
  const forced = await worm.vaultRestore({ path: fileA, sha256: shaA }, { force: true });
  assert.equal(forced.ok, true);
  assert.equal(forced.replaced, true);
  assert.equal(sha256(fs.readFileSync(fileA)), shaA, 'с изрично разрешение се връща печатът');
  ok('връщане върху съществуващ файл: отказ без `force`, подмяна с `force`');

  // ── 8. Липсващ печат и липсващ хеш се различават от грешка ────────────────
  const noSeal = await worm.vaultRestore({ path: path.join(portalDir, 'x'), sha256: 'f'.repeat(64) });
  assert.equal(noSeal.reason, 'SEAL_MISSING', 'няма такъв обект в печата');
  const noDigest = await worm.vaultRestore({ path: path.join(portalDir, 'x'), sha256: 'късо' });
  assert.equal(noDigest.reason, 'NO_DIGEST', 'без валиден SHA-256 не се търси');
  ok('липсващ печат → SEAL_MISSING; липсващ хеш → NO_DIGEST');

  // ── 9. Архивирането ПЪЛНИ печата (и на Windows, където `chmod` е изключен) ──
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-vault-manifest-'));
  const portal2 = path.join(root2, 'p_2');
  await fsp.mkdir(portal2, { recursive: true });
  const b1 = Buffer.from('първи файл от манифеста');
  const b2 = Buffer.from('втори файл от манифеста');
  await fsp.writeFile(path.join(portal2, 'f_1'), b1);
  await fsp.writeFile(path.join(portal2, 'f_2'), b2);
  const worm2 = create({ filesRoot: root2, audit: (name, details) => events.push({ name, details }) });
  const portal = { id: 'p_2', files: [{ id: 'f_1', contentId: 'CT-1', sha256: sha256(b1) }, { id: 'f_2', contentId: 'CT-2', sha256: sha256(b2) }] };
  const manifest = { files: [{ path: 'f_1', content_id: 'CT-1', sha256: sha256(b1) }, { path: 'f_2', content_id: 'CT-2', sha256: sha256(b2) }] };
  await worm2.sealManifest(portal, manifest, portal2);
  const stats2 = await worm2.vaultStats();
  assert.equal(stats2.objects, 2, 'и двата файла от манифеста са в печата, получено: ' + JSON.stringify(stats2));
  assert.equal(stats2.bytes, b1.length + b2.length, 'обемът е сборът на двата файла');
  const copyEvent = events.find((e) => e.name === 'worm.sealed.copy');
  assert.ok(copyEvent, 'одитът казва колко копия са направени');
  assert.deepEqual({ found: copyEvent.details.found, copies: copyEvent.details.copies }, { found: 2, copies: 2 });
  // Изтриваме единия работен файл: печатът остава и връщането работи и тук.
  await fsp.rm(path.join(portal2, 'f_1'));
  const check2 = await worm2.vaultCheck([{ path: path.join(portal2, 'f_1'), sha256: sha256(b1) }]);
  assert.equal(check2.problems[0].sealed, 'ok');
  assert.equal((await worm2.vaultRestore({ path: path.join(portal2, 'f_1'), sha256: sha256(b1) })).ok, true);
  assert.deepEqual(fs.readFileSync(path.join(portal2, 'f_1')), b1, 'байтовете са възстановени');
  ok('`sealManifest` пълни печата по манифеста (и на Windows) и връщането работи');

  // ── 10. Без печат се казва NO_VAULT, а не се пише другаде ─────────────────
  const bare = create({ filesRoot: '', vaultRoot: '' });
  assert.equal((await bare.vaultPut(fileLi, sha256(Buffer.from('подменено съдържание')))).reason, 'NO_VAULT');
  assert.deepEqual(await bare.vaultStats(), { available: false, reason: 'NO_VAULT', objects: 0, bytes: 0 });
  ok('без печат: NO_VAULT (нищо не се записва мълчаливо)');

  for (const dir of [root, root2]) fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS sealed-vault: ' + cases.length + ' проверки — ' + cases.join('; '));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
