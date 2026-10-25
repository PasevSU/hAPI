'use strict';
// WORM ЗА ОСНОВНОТО ХРАНИЛИЩЕ — файл, който е влязъл в доказателство, не се презаписва
// (docs/plan/17, F7-3).
//
// ЗАЩО СЪЩЕСТВУВА
// Досега WORM имаше само ВТОРОТО копие: `mirror-target.js` пише с `Object Lock` в режим
// `COMPLIANCE` и отказва триене. Основното хранилище (`<DATA_DIR>/files/<portal>/<file>`)
// нямаше нищо: файл можеше да бъде презаписан на диска, а манифестът на QR архива щеше да
// сочи към байтове, които вече не са същите. Това е точно разликата между „пазим копие“ и
// „доказателството е проверимо“.
//
// КАКВО ПРАВИ (и какво НЕ може)
//   • Когато файл стане доказателство (влязъл е в манифест на архивирана QR ревизия),
//     байтовете му се заключват с `chmod 0444` — само за четене за собственика, групата и
//     останалите. Оттам нататък `writeFile` без `unlink` се проваля с `EACCES`/`EPERM`.
//     Прави се на всяка платформа: измерено е, че NTFS също налага забрана за запис (виж
//     бележката при константите по-долу), а старото изключване за Windows беше базирано на
//     вярно за минало наблюдение, което вече не е вярно.
//   • `verify` проверява, че всеки защитен файл НАИСТИНА е само за четене, и казва кои не са
//     — разминаване се вижда, вместо да се предполага.
//   • При преместване/копиране на доказателство защитата се сваля СЪЗНАТЕЛНО (викащият
//     изрично я отключва), защото иначе легитимна операция би се проваляла с неясна грешка.
//
// ПЕЧАТЪТ — ЗАЩО ИЗТРИВАНЕТО ВЕЧЕ НЕ УНИЩОЖАВА ДОКАЗАТЕЛСТВОТО
//   `chmod` спира презаписването, но не и изтриването: собственикът на директорията пак може
//   да `unlink`-не файла. Досега това значеше, че `rm` на един файл убива доказателството, а
//   `verify` само го ОТЧИТА — констатация след загуба не е защита.
//   Затова при архивиране байтовете на всяко доказателство се слагат и в ПЕЧАТ:
//   `<filesRoot>/.worm/<sha256>`, адресиран по съдържанието си. Изтриването на работния файл
//   вече не унищожава байтовете — `vaultCheck` показва „работен: липсва, печат: наличен“, а
//   `vaultRestore` ги връща и проверява хеша при връщането.
//
// ГРАНИЦАТА, КОЯТО СЕ КАЗВА НА ГЛАС
//   Печатът пази байтовете от изтриване, но НЕ прави файла физически неизтриваем: който има
//   права върху `.worm`, може да изтрие и него. Това е „доказателството оцелява единично
//   изтриване и се връща“, не „никоя роля не може да го изтрие“. Затова тук НЕ се твърди
//   „WORM като Object Lock“: истинското неизменяемо съхранение иска файлова система с
//   append-only атрибут или външно хранилище с Object Lock — и точно това има второто копие
//   (`mirror-target.js`, режим `COMPLIANCE`). Цената на печата е ясна: доказателствата се
//   пазят два пъти на диска.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const READ_ONLY = 0o444;
const WRITABLE = 0o600;
// Печатът живее до файловете, но в собствена папка с точка отпред — `portal-qr.walk()`
// пропуска имена, започващи с точка, така че печатът никога не влиза в нов манифест.
const VAULT_NAME = '.worm';
const SHA256_RE = /^[0-9a-f]{64}$/;
// ЗАКЛЮЧВАНЕТО РАБОТИ И НА WINDOWS — ИЗМЕРЕНО, НЕ ДОПУСНАТО.
// До 0.69.87 тук стоеше `SUPPORTED = platform !== 'win32'` с обяснение, че `chmod 0444`
// прави файла неизтриваем за `fs.rm` дори с `force` и това чупи почистването. Измерено на
// Node 24.19 / NTFS (D:) преди да се махне:
//   • `writeFile` и `appendFile` върху файл с 0444 → **EPERM** (защитата работи);
//   • `unlink` на такъв файл → **минава** (Node ползва POSIX семантика за триене);
//   • `rmSync(dir, { recursive, force })` с такива файлове вътре → **минава** (почистването
//     не се чупи).
// Тоест старият коментар беше верен за друга версия на Node и обратен по посока: заключването
// не пречи на триенето, а пази от презапис. Затова платформената врата е махната: на Windows
// защитата се прилагаше НЕЗАЩО, а `verify` отчиташе всичко като записваемо.

function create(deps = {}) {
  const log = deps.log || { warn() { } };
  // Без одит (чист модулен тест) събитието отива в лога, а не се губи: `void` без запис би
  // направило „одитирано“ невярно твърдение.
  const audit = typeof deps.audit === 'function'
    ? deps.audit
    : (event, details) => { console.warn('WORM AUDIT (no sink)', event, JSON.stringify(details || {})) };
  const filesRoot = deps.filesRoot || '';
  // Печатът: `<filesRoot>/.worm`, освен ако не е зададен изрично (тест или друг том).
  // Празен `vaultRoot` значи „няма печат“ — тогава `vaultPut` го казва с `NO_VAULT`,
  // вместо да пише някъде другаде.
  const vaultRoot = deps.vaultRoot === undefined
    ? (filesRoot ? path.join(filesRoot, VAULT_NAME) : '')
    : (deps.vaultRoot ? path.resolve(deps.vaultRoot) : '');

  /** SHA-256 на файл, четен на парчета — доказателствата не се събират в паметта. */
  function hashFile(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fsSync.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  function vaultPathFor(sha) {
    return path.join(vaultRoot, sha);
  }

  /**
   * Слага байтовете в печата. Името е хешът на съдържанието, затова повторно слагане на
   * същите байтове е безобидно (`wx` → `EEXIST` значи „вече е там“, не грешка).
   * Ако манифестът носи `sha256` и той не съвпада с прочетеното, НЕ се записва печат:
   * печат с чужда стойност би „потвърдил“ файл, който вече е подменен.
   */
  async function vaultPut(filePath, expectedSha) {
    if (!vaultRoot) return { ok: false, reason: 'NO_VAULT' };
    let sha;
    try {
      sha = await hashFile(filePath);
    } catch (e) {
      return { ok: false, reason: e.code === 'ENOENT' ? 'MISSING' : (e.code || 'ERROR') };
    }
    const declared = expectedSha ? String(expectedSha).toLowerCase() : '';
    if (declared && SHA256_RE.test(declared) && declared !== sha) {
      return { ok: false, reason: 'SHA_MISMATCH', sha256: sha };
    }
    try {
      await fs.mkdir(vaultRoot, { recursive: true });
      await fs.copyFile(filePath, vaultPathFor(sha), fsSync.constants.COPYFILE_EXCL);
      return { ok: true, sha256: sha, created: true };
    } catch (e) {
      // `EEXIST`: съдържанието вече е в печата — файл с този хеш не се презаписва.
      if (e.code === 'EEXIST') return { ok: true, sha256: sha, created: false };
      return { ok: false, reason: e.code || 'ERROR' };
    }
  }

  /**
   * Състоянието на всяко доказателство по ДВЕ места: работния файл и печата. Точно това
   * отличава „отчетено след загуба“ от „знаем къде са байтовете“.
   */
  async function vaultCheck(entries) {
    const problems = [];
    let checked = 0;
    for (const entry of entries || []) {
      if (!entry || !entry.path) continue;
      checked += 1;
      const declared = entry.sha256 ? String(entry.sha256).toLowerCase() : '';
      const expected = SHA256_RE.test(declared) ? declared : '';
      let working;
      try {
        const sha = await hashFile(entry.path);
        working = !expected || sha === expected ? 'ok' : 'changed';
      } catch {
        working = 'missing';
      }
      let sealed = 'unknown';
      if (expected && vaultRoot) {
        try {
          sealed = (await hashFile(vaultPathFor(expected))) === expected ? 'ok' : 'changed';
        } catch {
          sealed = 'missing';
        }
      }
      problems.push({ path: entry.path, sha256: expected, working, sealed });
    }
    const lost = problems.filter((p) => p.working !== 'ok');
    if (lost.length) void audit('worm.vault.problems', { checked, lost: lost.length });
    return { checked, problems, ok: lost.length === 0 };
  }

  /**
   * Връща байтовете от печата. По подразбиране НЕ пипа съществуващ работен файл: връщането
   * върху нещо, което някой е сложил там, би било подмяна, а не възстановяване. Затова
   * презапис иска изрично `force`.
   */
  async function vaultRestore(entry, options) {
    const force = Boolean(options && options.force);
    if (!vaultRoot) return { ok: false, reason: 'NO_VAULT' };
    if (!entry || !entry.path) return { ok: false, reason: 'NO_PATH' };
    const declared = entry.sha256 ? String(entry.sha256).toLowerCase() : '';
    if (!SHA256_RE.test(declared)) return { ok: false, reason: 'NO_DIGEST' };
    const from = vaultPathFor(declared);
    let copySha;
    try {
      copySha = await hashFile(from);
    } catch {
      return { ok: false, reason: 'SEAL_MISSING' };
    }
    if (copySha !== declared) return { ok: false, reason: 'SEAL_CORRUPT' };
    let present;
    try {
      await fs.stat(entry.path);
      present = true;
    } catch {
      present = false;
    }
    if (present && !force) return { ok: false, reason: 'TARGET_EXISTS' };
    // Първо настрана, после на място: прекъснато връщане не оставя половин файл.
    const staging = entry.path + '.restore-' + process.pid + '.tmp';
    try {
      await fs.mkdir(path.dirname(entry.path), { recursive: true });
      await fs.copyFile(from, staging);
      await fs.rename(staging, entry.path);
    } catch (e) {
      await fs.rm(staging, { force: true }).catch(() => undefined);
      return { ok: false, reason: e.code || 'ERROR' };
    }
    void audit('worm.vault.restored', { path: entry.path, sha256: declared, replaced: present });
    return { ok: true, restored: true, sha256: declared, replaced: present };
  }

  /** Колко обекта и байта пази печатът — за диагностика, без да се обхожда цялото дърво. */
  async function vaultStats() {
    if (!vaultRoot) return { available: false, reason: 'NO_VAULT', objects: 0, bytes: 0 };
    let names;
    try {
      names = await fs.readdir(vaultRoot);
    } catch (e) {
      return { available: false, reason: e.code === 'ENOENT' ? 'EMPTY' : (e.code || 'ERROR'), objects: 0, bytes: 0 };
    }
    let bytes = 0;
    let objects = 0;
    for (const name of names) {
      if (!SHA256_RE.test(name)) continue;
      try {
        const stat = await fs.stat(vaultPathFor(name));
        objects += 1;
        bytes += stat.size;
      } catch {
        continue;
      }
    }
    return { available: true, objects, bytes, root: vaultRoot };
  }

  /**
   * Заключва ВСИЧКИ файлове от манифест на архивирана QR ревизия. Именно манифестът е
   * доказателството — затова защитата следва него, а не флаг, който някой трябва да помни
   * да сложи.
   *
   * Пътят е ключов: манифестът носи `path` ОТНОСИТЕЛНО ПАПКАТА НА ПОРТАЛА
   * (`portalRoot(storage_root)`), не `file.id` и не `files/`. Първата версия търсеше
   * `file_id` в `filesRoot` и тихо не заключваше нищо — затова `rootAbs` е задължителен вход,
   * а `tests/portal-qr-archive.cjs` проверява РЕАЛНИЯ режим на файловете след архивиране.
   */
  async function sealManifest(portal, manifest, rootAbs) {
    const entries = manifest && Array.isArray(manifest.files) ? manifest.files : [];
    const owned = Array.isArray(portal && portal.files) ? portal.files : [];
    const byContent = new Map(), bySha = new Map(), byPath = new Map();
    for (const file of owned) {
      if (!file || !file.id) continue;
      if (file.contentId) byContent.set(String(file.contentId), file);
      if (file.sha256) bySha.set(String(file.sha256).toLowerCase(), file);
      if (file.storagePath) byPath.set(String(file.storagePath).replace(/^\/+/, ''), file);
    }
    let sealed = 0;
    let copied = 0;
    let found = 0;
    const missing = [];
    for (const entry of entries) {
      if (!entry || !entry.path) continue;
      const rel = String(entry.path).replace(/^\/+/, '');
      // Първо по пътя в папката на портала: манифестът Е това, което е на диска.
      const candidates = [];
      if (rootAbs) candidates.push(path.join(rootAbs, ...rel.split('/')));
      const known = (entry.content_id && byContent.get(String(entry.content_id)))
        || (entry.sha256 && bySha.get(String(entry.sha256).toLowerCase()))
        || byPath.get(rel);
      // Файл, който е в портала и има `storagePath`, се взима и оттам — за инсталации, в
      // които файлът е качен през API (в `files/`), а не сложен ръчно в папката.
      if (known && known.storagePath) candidates.push(path.join(filesRoot, portal.id, String(known.id)));
      let done = false;
      for (const target of candidates) {
        // Наличието се проверява ИЗРИЧНО, а не по резултата на `seal()`: заключването може
        // да не мине (липсващ файл, права), а файлът да си е на мястото. Първата версия
        // смяташе всеки неуспех на `seal()` за „липсва“ и одитът крещеше `worm.seal.missing`
        // за файлове, които са си там.
        let present;
        try {
          present = (await fs.stat(target)).isFile();
        } catch {
          present = false;
        }
        if (!present) continue;
        // Двете защити се правят заедно, защото пазят от различни неща: `seal` от презапис,
        // печатът от изтриване (заключването не спира `unlink` на нито една платформа).
        if ((await seal(target)).ok) sealed += 1;
        const copy = await vaultPut(target, entry.sha256);
        if (copy.ok) copied += 1;
        else if (copy.reason !== 'NO_VAULT') log.warn('worm.vault.failed', { ns: 'worm', reason: copy.reason });
        done = true;
        break;
      }
      if (done) found += 1; else missing.push(rel);
    }
    if (sealed) void audit('worm.sealed', { portalId: portal.id, files: sealed });
    // Печатът се отчита винаги, когато има намерени файлове — включително с `copies: 0`
    // (няма печат), за да не изглежда „готово“, когато нищо не е запазено.
    if (found) void audit('worm.sealed.copy', { portalId: portal.id, found, copies: copied });
    if (missing.length) void audit('worm.seal.missing', { portalId: portal.id, files: missing.slice(0, 20), count: missing.length });
    return sealed;
  }

  /** Заключва байтовете: оттук нататък презаписът е `EACCES`/`EPERM`, а не тиха подмяна. */
  async function seal(filePath) {
    // Без платформена врата: `chmod 0444` на NTFS също дава EPERM при запис (виж
    // измерванията при константите по-горе), а триенето остава възможно — тоест
    // заключването не създава проблем с почистването, което старата врата избягваше.
    try {
      await fs.chmod(filePath, READ_ONLY);
      return { ok: true };
    } catch (e) {
      // Липсващ файл не е „заключен“ — това е разлика, която трябва да се види.
      if (e.code === 'ENOENT') return { ok: false, reason: 'MISSING' };
      log.warn('worm.seal.failed', { ns: 'worm', err: e.code || e.message });
      return { ok: false, reason: e.code || 'ERROR' };
    }
  }

  /**
   * Сваля защитата съзнателно — преди легитимна операция (преместване, копиране, нова
   * версия). Извиква се САМО от маршрут, който вече е проверил правото.
   */
  async function unseal(filePath) {
    try {
      await fs.chmod(filePath, WRITABLE);
      return { ok: true };
    } catch (e) {
      if (e.code === 'ENOENT') return { ok: false, reason: 'MISSING' };
      return { ok: false, reason: e.code || 'ERROR' };
    }
  }

  /** Само за четене ли е файлът (проверка на РЕАЛНИТЕ права, не на флаг в метаданните). */
  async function isSealed(filePath) {
    try {
      const stat = await fs.stat(filePath);
      // `0o222` са битовете за запис; нула значи „никоя роля не може да пише“.
      return (stat.mode & 0o222) === 0;
    } catch {
      return false;
    }
  }

  /**
   * Проверка на цялото хранилище: кои защитени файлове НЕ са само за четене. Връща списък с
   * причини, за да може `integrity-scan` да ги покаже, вместо да каже „всичко е наред“.
   */
  async function verify(entries) {
    const problems = [];
    let checked = 0;
    for (const entry of entries || []) {
      if (!entry || !entry.path) continue;
      checked += 1;
      if (!(await isSealed(entry.path))) problems.push({ fileId: entry.fileId || '', portalId: entry.portalId || '', reason: 'WRITABLE' });
    }
    if (problems.length) void audit('worm.verify.failed', { checked, writable: problems.length });
    return { checked, problems, ok: problems.length === 0 };
  }

  return {
    seal,
    unseal,
    isSealed,
    verify,
    sealManifest,
    vaultPut,
    vaultCheck,
    vaultRestore,
    vaultStats,
    READ_ONLY,
    WRITABLE,
    vaultRoot,
  };
}

module.exports = { create, READ_ONLY, WRITABLE, VAULT_NAME };
