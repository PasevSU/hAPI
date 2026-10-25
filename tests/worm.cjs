'use strict';
// WORM за ОСНОВНОТО хранилище (F7-3) — договорът от `docs/plan/17` F7-3 и
// `documentation/04_FUNCTION_SPECIFICATIONS/WORM_MAIN_STORE.md`.
//
// Проверява се това, което защитата НАИСТИНА може да обещае:
//   • защитен файл става само за четене (`0444`) и презаписът пада с `EACCES`;
//   • `unseal` връща правото за запис — легитимна операция не се проваля с неясна грешка;
//   • `isSealed` чете РЕАЛНИТЕ права, не флаг в метаданните;
//   • `sealManifest` заключва точно файловете от манифеста и връща броя;
//   • границата се казва на глас: `chmod` пази от презапис, НЕ от изтриване.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { create, READ_ONLY } = require('../hapi_enterprise/worm.js');

const cases = [];
const ok = (label) => cases.push(label);
const isWindows = process.platform === 'win32';

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-worm-'));
  const portalDir = path.join(root, 'p_1');
  await fsp.mkdir(portalDir, { recursive: true });
  const target = path.join(portalDir, 'f_1');
  await fsp.writeFile(target, 'доказателство');
  const worm = create({ filesRoot: root });

  // ── 1. Заключване: файлът става само за четене ───────────────────────────
  {
    const out = await worm.seal(target);
    assert.equal(out.ok, true, 'заключването минава: ' + JSON.stringify(out));
    const stat = await fsp.stat(target);
    assert.equal(stat.mode & 0o222, 0, 'никоя роля не може да пише');
    assert.equal(stat.mode & 0o777, READ_ONLY, 'правата са точно 0444');
    assert.equal(await worm.isSealed(target), true, 'isSealed вижда РЕАЛНИТЕ права');
    ok('заключване: 0444, isSealed → true');
  }

  // ── 2. Презаписът пада (на POSIX; на Windows правата не се налагат така) ──
  if (!isWindows) {
    await assert.rejects(
      () => fsp.writeFile(target, 'подмяна'),
      (e) => e.code === 'EACCES' || e.code === 'EPERM',
      'презаписът на защитен файл трябва да падне',
    );
    ok('презапис на защитен файл → EACCES (подмяната не минава тихо)');
  } else {
    // Windows: `chmod` сменя само бита „само за четене“ и Node го отразява в `stat`,
    // но презаписът през `writeFile` не пада по същия начин. Това е граница на
    // платформата и се казва, вместо тестът да твърди нещо невярно.
    ok('Windows: правата се виждат в stat, но EACCES не се налага от ОС — записано в документа');
  }

  // ── 3. `unseal` връща правото за запис ───────────────────────────────────
  {
    const out = await worm.unseal(target);
    assert.equal(out.ok, true);
    assert.equal(await worm.isSealed(target), false, 'след unseal файлът е записваем');
    await fsp.writeFile(target, 'нова версия');
    assert.equal(await fsp.readFile(target, 'utf8'), 'нова версия', 'легитимната операция минава');
    ok('unseal: файлът е записваем и легитимната операция минава');
  }

  // ── 4. `sealManifest` заключва точно файловете от манифеста ──────────────
  {
    await fsp.writeFile(path.join(portalDir, 'f_2'), 'втори');
    await fsp.writeFile(path.join(portalDir, 'f_3'), 'трети');
    const sealed = await worm.sealManifest({ id: 'p_1' }, { files: [{ file_id: 'f_2' }, { id: 'f_3' }] });
    assert.equal(sealed, 2, 'заключени са точно двата от манифеста');
    assert.equal(await worm.isSealed(path.join(portalDir, 'f_2')), true);
    assert.equal(await worm.isSealed(path.join(portalDir, 'f_3')), true);
    assert.equal(await worm.isSealed(target), false, 'файлът извън манифеста не се пипа');
    ok('sealManifest: точно файловете от манифеста, останалите — не');
  }

  // ── 5. `verify` казва кои защитени файлове НЕ са само за четене ──────────
  {
    const report = await worm.verify([
      { path: path.join(portalDir, 'f_2'), fileId: 'f_2', portalId: 'p_1' },
      { path: target, fileId: 'f_1', portalId: 'p_1' },
    ]);
    assert.equal(report.checked, 2);
    assert.equal(report.ok, false, 'един записваем файл прави проверката неуспешна');
    assert.equal(report.problems.length, 1);
    assert.equal(report.problems[0].fileId, 'f_1', 'проблемът сочи точния файл');
    ok('verify: записваемият защитен файл е находка, не мълчание');
  }

  // ── 6. Липсващ файл не е „заключен“ ──────────────────────────────────────
  {
    const missing = await worm.seal(path.join(portalDir, 'няма-такъв'));
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, 'MISSING', 'липсващ файл се казва с причина, не се премълчава');
    assert.equal(await worm.isSealed(path.join(portalDir, 'няма-такъв')), false);
    ok('липсващ файл → MISSING, а не „готово“');
  }

  await fsp.rm(root, { recursive: true, force: true });
  console.log('PASS worm: ' + cases.length + ' проверки — ' + cases.join('; '));
})().catch((err) => {
  console.error('FAIL worm: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
