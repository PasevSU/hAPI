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
//     останалите. Оттам нататък `writeFile` без `unlink` се проваля с `EACCES`.
//   • `verify` проверява, че всеки защитен файл НАИСТИНА е само за четене, и казва кои не са
//     — разминаване се вижда, вместо да се предполага.
//   • При преместване/копиране на доказателство защитата се сваля СЪЗНАТЕЛНО (викащият
//     изрично я отключва), защото иначе легитимна операция би се проваляла с неясна грешка.
//
// ГРАНИЦАТА, КОЯТО СЕ КАЗВА НА ГЛАС
//   `chmod` пази от ПРЕЗАПИСВАНЕ, не от ИЗТРИВАНЕ: собственикът на файла (процесът на
//   add-on-а) пак може да го изтрие, защото правата върху директорията го позволяват. Затова
//   тук НЕ се твърди „WORM като Object Lock“. Истинското неизменяемо съхранение иска
//   файлова система с append-only атрибут или външно хранилище с Object Lock — и точно това
//   има второто копие. Този модул затваря дупката „презапис без следа“, не цялата WORM тема.
const fs = require('node:fs/promises');

const READ_ONLY = 0o444;
const WRITABLE = 0o600;

function create(deps = {}) {
  const log = deps.log || { warn() { } };
  // Без одит (чист модулен тест) събитието отива в лога, а не се губи: `void` без запис би
  // направило „одитирано“ невярно твърдение.
  const audit = typeof deps.audit === 'function'
    ? deps.audit
    : (event, details) => { console.warn('WORM AUDIT (no sink)', event, JSON.stringify(details || {})) };
  const filesRoot = deps.filesRoot || '';
  const path = require('node:path');

  /**
   * Заключва ВСИЧКИ файлове от манифест на архивирана QR ревизия. Именно манифестът е
   * доказателството — затова защитата следва него, а не флаг, който някой трябва да помни
   * да сложи. Връща броя заключени, за да може одитът да каже колко, а не „готово“.
   */
  async function sealManifest(portal, manifest) {
    const files = manifest && Array.isArray(manifest.files) ? manifest.files : [];
    let sealed = 0;
    for (const entry of files) {
      const fileId = entry && (entry.file_id || entry.id);
      if (!fileId) continue;
      const out = await seal(path.join(filesRoot, portal.id, String(fileId)));
      if (out.ok) sealed += 1;
    }
    if (sealed) void audit('worm.sealed', { portalId: portal.id, files: sealed });
    return sealed;
  }

  /** Заключва байтовете: оттук нататък презаписът е `EACCES`, а не тиха подмяна. */
  async function seal(filePath) {
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

  return { seal, unseal, isSealed, verify, sealManifest, READ_ONLY, WRITABLE };
}

module.exports = { create, READ_ONLY, WRITABLE };
