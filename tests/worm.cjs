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

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-worm-'));
  const portalDir = path.join(root, 'p_1');
  await fsp.mkdir(portalDir, { recursive: true });
  const target = path.join(portalDir, 'f_1');
  await fsp.writeFile(target, 'доказателство');
  const worm = create({ filesRoot: root });

  // ── 1. Заключване: файлът става само за четене ───────────────────────────
  // Прави се на ВСЯКА платформа. До 0.69.87 на Windows беше изключено с обяснение, че
  // `chmod 0444` прави файла неизтриваем и чупи почистването. Измерено на Node 24.19 /
  // NTFS: записът пада с EPERM, `unlink` минава, `rmSync(recursive)` минава. Тоест
  // вратата беше излишна и защитата липсваше НЕЗАЩО — затова тестът вече не я очаква.
  {
    const out = await worm.seal(target);
    assert.equal(out.ok, true, 'заключването минава: ' + JSON.stringify(out));
    const stat = await fsp.stat(target);
    assert.equal(stat.mode & 0o222, 0, 'никоя роля не може да пише');
    assert.equal(stat.mode & 0o777, READ_ONLY, 'правата са точно 0444');
    assert.equal(await worm.isSealed(target), true, 'isSealed вижда РЕАЛНИТЕ права');
    ok('заключване: 0444, isSealed → true (и на Windows)');
  }

  // ── 2. Презаписът пада — това е защитата, а не флагът в метаданните ──────
  {
    await assert.rejects(
      () => fsp.writeFile(target, 'подмяна'),
      (e) => e.code === 'EACCES' || e.code === 'EPERM',
      'презаписът на защитен файл трябва да падне',
    );
    // Дописването е вторият път към същите байтове и трябва да пада също.
    await assert.rejects(
      () => fsp.appendFile(target, 'още'),
      (e) => e.code === 'EACCES' || e.code === 'EPERM',
      'дописването на защитен файл трябва да падне',
    );
    assert.equal(await fsp.readFile(target, 'utf8'), 'доказателство', 'байтовете са непокътнати');
    ok('презапис и дописване → EACCES/EPERM, байтовете остават същите');
  }

  // ── 2б. Границата, измерена: заключването НЕ спира изтриването ──────────
  // Това не е дефект, който се поправя тук — това е точната граница на `chmod`. Затова
  // се проверява, за да не се претендира повече, отколкото механизмът дава.
  {
    const tmp = path.join(portalDir, 'за-триене');
    await fsp.writeFile(tmp, 'ще бъде изтрит');
    assert.equal((await worm.seal(tmp)).ok, true);
    await fsp.unlink(tmp);
    assert.equal(fs.existsSync(tmp), false, 'заключен файл все пак може да бъде изтрит');
    ok('изтриване на заключен файл минава → пази го печатът, не `chmod`');
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
    // Манифестът на QR архива НЕ носи `file.id` — носи `path`, `content_id`, `sha256`.
    // Точно това беше дефектът: първата версия търсеше `file_id` и не заключваше НИЩО.
    const portal = {
      id: 'p_1',
      files: [
        { id: 'f_2', storagePath: 'док/две.txt', contentId: 'CT-AAA', sha256: 'aa11' },
        { id: 'f_3', storagePath: 'док/три.txt', contentId: 'CT-BBB', sha256: 'bb22' },
        { id: 'f_1', storagePath: 'едно.txt', contentId: 'CT-CCC', sha256: 'cc33' },
      ],
    };
    const manifest = {
      files: [
        { path: 'док/две.txt', content_id: 'CT-AAA', sha256: 'aa11' },
        { path: 'док/три.txt', content_id: 'CT-BBB', sha256: 'bb22' },
      ],
    };
    const sealed = await worm.sealManifest(portal, manifest, root);
    assert.equal(sealed, 2, 'заключени са точно двата от манифеста, получено: ' + sealed);
    assert.equal(await worm.isSealed(path.join(portalDir, 'f_2')), true, 'f_2 е заключен по content_id');
    assert.equal(await worm.isSealed(path.join(portalDir, 'f_3')), true, 'f_3 е заключен по content_id');
    assert.equal(await worm.isSealed(target), false, 'файлът извън манифеста не се пипа');
    ok('sealManifest: точно файловете от манифеста (по content_id), останалите — не');
  }

  // ── 4б. Манифест без `content_id` се решава по `sha256`, после по `path` ──
  {
    await fsp.writeFile(path.join(portalDir, 'f_4'), 'четвърти');
    const portal = { id: 'p_1', files: [{ id: 'f_4', storagePath: 'четири.txt', sha256: 'DD44' }] };
    // Без content_id, с ГЛАВНИ букви в sha256 — сверката трябва да е без значение на регистъра.
    assert.equal(await worm.sealManifest(portal, { files: [{ path: 'четири.txt', sha256: 'dd44' }] }, root), 1, 'по sha256, без регистър');
    assert.equal(await worm.isSealed(path.join(portalDir, 'f_4')), true);
    ok('sealManifest: без content_id → по sha256 (без значение на регистъра)');
  }

  // ── 4в. Файл от манифеста, който не се намира, е находка ─────────────────
  {
    const portal = { id: 'p_1', files: [{ id: 'f_2', storagePath: 'док/две.txt', contentId: 'CT-AAA' }] };
    const sealed = await worm.sealManifest(portal, { files: [{ path: 'няма/такъв.txt', content_id: 'CT-ZZZ' }] }, root);
    assert.equal(sealed, 0, 'нищо не се заключва за липсващ файл');
    ok('sealManifest: липсващ в портала файл не се премълчава (одит worm.seal.missing)');
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
    assert.equal(missing.reason, 'MISSING',
      'липсващ файл се казва с причина, не се премълчава: ' + missing.reason);
    assert.equal(await worm.isSealed(path.join(portalDir, 'няма-такъв')), false);
    ok('липсващ файл → MISSING, а не „готово“');
  }

  // ── 7. Почистването не се чупи от заключването ──────────────────────────
  // Точно това беше страхът, заради който защитата на Windows беше изключена. Проверява
  // се изрично: директория със заключени файлове се трие с `recursive` + `force`.
  {
    const dir = path.join(root, 'за-почистване');
    await fsp.mkdir(dir, { recursive: true });
    for (const name of ['a', 'b', 'c']) {
      const file = path.join(dir, name);
      await fsp.writeFile(file, name);
      assert.equal((await worm.seal(file)).ok, true, 'заключен: ' + name);
    }
    assert.equal(await worm.isSealed(path.join(dir, 'a')), true, 'файловете са заключени преди триенето');
    await fsp.rm(dir, { recursive: true, force: true });
    assert.equal(fs.existsSync(dir), false, 'директорията е изтрита въпреки заключването');
    ok('изтриване на директория със заключени файлове минава (затова вратата за Windows беше излишна)');
  }

  await fsp.rm(root, { recursive: true, force: true });
  console.log('PASS worm: ' + cases.length + ' проверки — ' + cases.join('; '));
})().catch((err) => {
  console.error('FAIL worm: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
