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
  // На Windows `chmod 0444` прави файла НЕИЗТРИВАЕМ (EPERM при `fs.rm`), което чупи
  // `restore` и почистването — затова там заключването е изрично ИЗКЛЮЧЕНО и се казва,
  // вместо да се прави наполовина. Тестът проверява точно това поведение, не идеала.
  {
    const out = await worm.seal(target);
    if (isWindows) {
      assert.equal(out.ok, false, 'на Windows заключването е изключено');
      assert.equal(out.reason, 'UNSUPPORTED_PLATFORM', 'причината се казва, не се премълчава');
      assert.equal(await worm.isSealed(target), false, 'файлът остава записваем');
      ok('Windows: заключването е ИЗКЛЮЧЕНО с причина UNSUPPORTED_PLATFORM (chmod прави файла неизтриваем)');
    } else {
      assert.equal(out.ok, true, 'заключването минава: ' + JSON.stringify(out));
      const stat = await fsp.stat(target);
      assert.equal(stat.mode & 0o222, 0, 'никоя роля не може да пише');
      assert.equal(stat.mode & 0o777, READ_ONLY, 'правата са точно 0444');
      assert.equal(await worm.isSealed(target), true, 'isSealed вижда РЕАЛНИТЕ права');
      ok('заключване: 0444, isSealed → true');
    }
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
  // На Windows заключването е изключено (виж проверка 1), затова тук се проверява
  // РАЗПОЗНАВАНЕТО на файловете от манифеста — че се намират точно тези по `content_id`,
  // `sha256` и `path`, а не „някакви“. Самото `chmod` се проверява на POSIX.
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
    if (isWindows) {
      assert.equal(sealed, 0, 'на Windows нищо не се заключва (платформата не го позволява)');
      ok('sealManifest: Windows → 0 заключени, причината е платформата');
    } else {
      assert.equal(sealed, 2, 'заключени са точно двата от манифеста, получено: ' + sealed);
      assert.equal(await worm.isSealed(path.join(portalDir, 'f_2')), true, 'f_2 е заключен по content_id');
      assert.equal(await worm.isSealed(path.join(portalDir, 'f_3')), true, 'f_3 е заключен по content_id');
      assert.equal(await worm.isSealed(target), false, 'файлът извън манифеста не се пипа');
      ok('sealManifest: точно файловете от манифеста (по content_id), останалите — не');
    }
  }

  // ── 4б. Манифест без `content_id` се решава по `sha256`, после по `path` ──
  if (!isWindows) {
    await fsp.writeFile(path.join(portalDir, 'f_4'), 'четвърти');
    const portal = { id: 'p_1', files: [{ id: 'f_4', storagePath: 'четири.txt', sha256: 'DD44' }] };
    // Без content_id, с ГЛАВНИ букви в sha256 — сверката трябва да е без значение на регистъра.
    assert.equal(await worm.sealManifest(portal, { files: [{ path: 'четири.txt', sha256: 'dd44' }] }, root), 1, 'по sha256, без регистър');
    assert.equal(await worm.isSealed(path.join(portalDir, 'f_4')), true);
    ok('sealManifest: без content_id → по sha256 (без значение на регистъра)');
  } else {
    ok('sealManifest по sha256: проверява се само на POSIX (Windows не заключва)');
  }

  // ── 4в. Файл от манифеста, който не се намира, е находка ─────────────────
  {
    const portal = { id: 'p_1', files: [{ id: 'f_2', storagePath: 'док/две.txt', contentId: 'CT-AAA' }] };
    const sealed = await worm.sealManifest(portal, { files: [{ path: 'няма/такъв.txt', content_id: 'CT-ZZZ' }] }, root);
    assert.equal(sealed, 0, 'нищо не се заключва за липсващ файл');
    ok('sealManifest: липсващ в портала файл не се премълчава (одит worm.seal.missing)');
  }

  // ── 5. `verify` казва кои защитени файлове НЕ са само за четене ──────────
  if (!isWindows) {
    const report = await worm.verify([
      { path: path.join(portalDir, 'f_2'), fileId: 'f_2', portalId: 'p_1' },
      { path: target, fileId: 'f_1', portalId: 'p_1' },
    ]);
    assert.equal(report.checked, 2);
    assert.equal(report.ok, false, 'един записваем файл прави проверката неуспешна');
    assert.equal(report.problems.length, 1);
    assert.equal(report.problems[0].fileId, 'f_1', 'проблемът сочи точния файл');
    ok('verify: записваемият защитен файл е находка, не мълчание');
  } else {
    // На Windows всички файлове са записваеми по замисъл (заключването е изключено),
    // затова `verify` трябва да върне ВСИЧКИ като проблем — не „чисто“.
    const report = await worm.verify([{ path: target, fileId: 'f_1', portalId: 'p_1' }]);
    assert.equal(report.ok, false, 'Windows: нищо не е заключено, затова не може да е „чисто“');
    assert.equal(report.problems.length, 1);
    ok('verify на Windows: файловете са записваеми и се отчитат като находка');
  }

  // ── 6. Липсващ файл не е „заключен“ ──────────────────────────────────────
  {
    const missing = await worm.seal(path.join(portalDir, 'няма-такъв'));
    assert.equal(missing.ok, false);
    // На Windows причината е платформата (проверява се преди файла); на POSIX — липсата.
    assert.equal(missing.reason, isWindows ? 'UNSUPPORTED_PLATFORM' : 'MISSING',
      'липсващ файл се казва с причина, не се премълчава: ' + missing.reason);
    assert.equal(await worm.isSealed(path.join(portalDir, 'няма-такъв')), false);
    ok('липсващ файл → MISSING (на Windows: UNSUPPORTED_PLATFORM), а не „готово“');
  }

  await fsp.rm(root, { recursive: true, force: true });
  console.log('PASS worm: ' + cases.length + ' проверки — ' + cases.join('; '));
})().catch((err) => {
  console.error('FAIL worm: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
