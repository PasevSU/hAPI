'use strict';
// ГЛОБАЛНАТА ФУНКЦИЯ „hash“ СМЯТА ПО ЕДИН ДОГОВОР.
//
// Защо има тест: `files[].sha256` в описанието на портала, проверката на папката и пакетите ще
// разчитат на тези четири функции. Ако парчето чете цял файл, ако редът в `basis()` не значи
// нищо или ако непознат алгоритъм мине „по подразбиране“, договорът се разпада тихо — точно
// класът, който DEF-89 показа при редакцията на тайни.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const hash = require('../hapi_enterprise/core_module/hash.js').create({}, {});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-hash-'));

(async () => {
  assert.equal(hash.name, 'hash', 'модулът се казва „hash“');
  for (const key of ['digest', 'file', 'verify', 'basis']) {
    assert.equal(typeof hash.fn[key], 'function', 'hash.' + key + ' е функция');
  }

  // ── 1. Вектори: същото като всеки друг sha256 ────────────────────────────
  assert.equal(
    hash.fn.digest('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'digest("abc") дава известния sha256',
  );
  assert.equal(hash.fn.digest('abc', { algo: 'sha512' }).length, 128, 'sha512 дава 128 знака');
  assert.equal(hash.fn.digest(Buffer.alloc(0)), hash.fn.digest(''), 'празен Buffer и празен низ съвпадат');

  // ── 2. Непознат алгоритъм е ОТКАЗ, не подразбиране ───────────────────────
  for (const bad of ['md5', 'sha1', 'sha256x']) {
    assert.throws(() => hash.fn.digest('x', { algo: bad }), (e) => e.code === 'HASH_UNKNOWN_ALGO', 'отказва „' + bad + '“');
  }
  // Съобщението и полетата са ДВА източника на една истина, затова се сверяват: каталогът
  // на грешките показва само текста, а викащият чете `allowed`. Ако някой добави алгоритъм
  // само в единия, това твърдение пада — вместо потребителят да види „позволени са само …“
  // с непълен списък.
  const algoRefusal = (() => {
    try {
      hash.fn.digest('x', { algo: 'md5' });
      return null;
    } catch (error) {
      return error;
    }
  })();
  assert.equal(algoRefusal.code, 'HASH_UNKNOWN_ALGO', 'отказът носи код');
  assert.equal(algoRefusal.algo, 'md5', 'отказът казва КАКЪВ алгоритъм е поискан');
  assert.ok(Array.isArray(algoRefusal.allowed) && algoRefusal.allowed.length >= 2, 'отказът носи списъка с позволени: ' + algoRefusal.allowed);
  for (const allowed of algoRefusal.allowed) {
    assert.ok(algoRefusal.message.includes(allowed), 'съобщението изброява позволения алгоритъм „' + allowed + '“: ' + algoRefusal.message);
  }
  for (const denied of ['md5', 'sha1']) {
    assert.equal(algoRefusal.message.includes(denied), false, 'съобщението не обещава „' + denied + '“: ' + algoRefusal.message);
  }

  // ── 3. Файлът се чете на парчета и резултатът е същият ───────────────────
  const bytes = Buffer.alloc(1024 * 1024 + 7, 0x5a);
  const file = path.join(tmp, 'sample.bin');
  fs.writeFileSync(file, bytes);
  const got = await hash.fn.file(file);
  assert.equal(got.hex, hash.fn.digest(bytes), 'файлът и буферът дават един и същ хеш');
  assert.equal(got.bytes, bytes.length, 'връща и броя байтове');
  assert.equal(got.algo, 'sha256', 'подразбираният алгоритъм е sha256');
  assert.equal((await hash.fn.file(file, { chunk: 4096 })).hex, got.hex, 'по-малко парче не мени резултата');

  // ── 4. Парчето има граници (иначе „четене на парчета“ е пожелание) ───────
  for (const chunk of [1, 2048, 16 * 1024 * 1024, 'x']) {
    await assert.rejects(() => hash.fn.file(file, { chunk }), (e) => e.code === 'HASH_BAD_CHUNK', 'отказва парче „' + chunk + '“');
  }

  // ── 5. verify връща И двете страни ───────────────────────────────────────
  const ok = await hash.fn.verify(file, got.hex);
  assert.equal(ok.ok, true, 'съвпада');
  assert.equal(ok.actual, got.hex, 'връща намерения хеш');
  assert.equal(ok.expected, got.hex, 'връща очаквания хеш');
  const bad = await hash.fn.verify(file, 'a'.repeat(64));
  assert.equal(bad.ok, false, 'несъвпадението не хвърля, а се вижда');
  await assert.rejects(() => hash.fn.verify(file, 'zz'), (e) => e.code === 'HASH_BAD_EXPECTED', 'очакваният хеш се проверява');

  // ── 6. basis пази РЕДА и имената ─────────────────────────────────────────
  const one = crypto.createHash('sha256').update('1').digest('hex');
  const two = crypto.createHash('sha256').update('2').digest('hex');
  const a = hash.fn.basis([{ sha256: one, name: 'a.pdf' }, { sha256: two, name: 'b.pdf' }]);
  const b = hash.fn.basis([{ sha256: two, name: 'b.pdf' }, { sha256: one, name: 'a.pdf' }]);
  const c = hash.fn.basis([{ sha256: one, name: 'a.txt' }, { sha256: two, name: 'b.pdf' }]);
  assert.match(a, /^[0-9a-f]{64}$/, 'basis дава sha256');
  assert.notEqual(a, b, 'разменен ред = различен хеш');
  assert.notEqual(a, c, 'сменено име = различен хеш');
  assert.equal(hash.fn.basis([]), hash.fn.digest(''), 'празен списък = хеш на празното');
  assert.throws(() => hash.fn.basis([{ sha256: 'zz', name: 'a' }]), (e) => e.code === 'HASH_BAD_ENTRY', 'лош запис се отказва');
  assert.throws(() => hash.fn.basis([{ sha256: one, name: '' }]), (e) => e.code === 'HASH_BAD_ENTRY', 'празно име се отказва');

  // ── 7. Липсващ файл не се маскира ───────────────────────────────────────
  await assert.rejects(() => hash.fn.file(path.join(tmp, 'nope.bin')), (e) => e.code === 'ENOENT', 'липсващ файл дава ENOENT');

  console.log(
    'PASS core-hash: sha256/sha512 по един договор · четене на парчета с граници · verify връща двете страни · basis пази реда и имената',
  );
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });
