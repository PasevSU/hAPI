'use strict';
// ОТЧЕТ С ЕДНО НАТИСКАНЕ (ADR-0028, D2/D3): обхват → манифест, без HTTP и без рендер.
//
// Защо е отделен модул: отчетът се различава само по ОБХВАТА (портал, папка, файл), а
// съдържанието е едно и също — опис на файловете с точен размер и SHA-256, общ отпечатък на
// набора и честно изречение какво НЕ твърди отчетът. Рендърът остава в `report-render.js`
// (един източник за PDF), затова тук няма нито байт от PDF логиката.
//
// Договорът, който модулът налага:
//   • пътят е ВЪТРЕ в портала — `../` и абсолютен път се отказват (иначе отчетът щеше да
//     опише чужди файлове);
//   • празен обхват се отказва (400), а не се описва като „отчет за нула файла“;
//   • над `MAX_FILES` се отказва (413), за да не блокира заявката портал от 100 000 файла;
//   • символни връзки НЕ се следват — те водят извън портала и не са част от него.
const fsp = require('node:fs/promises');
const path = require('node:path');

// Същият договор за хеш като глобалната функция `hash` (парче по парче, sha256), за да не се
// разминават отчетът и описанието на портала. Сървърът подава `core.api.hash`; при пряко
// извикване (тестове) се ползва СЪЩИЯТ модул, а не втори `createHash`.
const hashFn = () => require('./core_module/hash').create().fn;

const TYPES = new Set(['portal', 'folder', 'file', 'selection']);
const MAX_FILES = 10000;
// Името влиза в адреса на линка (`/statik/<id>/<име>`), затова се ограничава до безопасни знаци.
const SAFE = /[^A-Za-z0-9._-]+/g;

class OneClickError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const stamp = (iso) => String(iso).replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

const safeBase = (value, fallback) => {
  const clean = String(value == null ? '' : value).replace(SAFE, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  return clean || fallback;
};

/** Отсяда от корена на портала; `null` значи „извън портала“ (никога не се приема). */
function insideOf(root, target) {
  const rel = path.relative(root, target);
  if (!rel) return '';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/** Обхожда папката рекурсивно и връща файловете с размер и SHA-256, подредени по име. */
async function collect(absDir, { hash }) {
  const out = [];
  let skipped = 0;
  const walk = async (dir, prefix) => {
    const names = (await fsp.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of names) {
      const abs = path.join(dir, entry.name);
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) {
        skipped += 1; // външна връзка: не е част от портала, не влиза в отчета
        continue;
      }
      if (entry.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const hashed = await hash.file(abs);
      out.push({ name: rel, bytes: hashed.bytes, sha256: hashed.hex });
      if (out.length > MAX_FILES) {
        throw new OneClickError('TOO_MANY_FILES', 413, `Обхватът е над ${MAX_FILES} файла — отчетът не се строи`);
      }
    }
  };
  await walk(absDir, '');
  return { entries: out, skipped };
}

/**
 * Строи манифеста на отчета за даден обхват. Не рендира и не пише нищо на диска.
 * @param {{type: string, dir?: string, rel?: string, portal?: object, createdAt?: string, hash?: object,
 *          sources?: Array<{abs: string, name: string}>}} opts
 *   `sources` е списъкът на ФАЙЛОВЕТЕ НА ПОРТАЛА от регистъра (`files/<portalId>/<fileId>`); когато
 *   е подаден, обхождането на папка не се прави — порталът има регистър, а папката има дърво.
 * @returns {Promise<{manifest: object, data: object, hashes: object, entries: Array, totals: object, scope: string, path: string, name: string}>}
 */
async function build({ type, dir = null, rel = '', portal = {}, createdAt = new Date().toISOString(), hash = null, sources = null, paths = null }) {
  const scope = String(type || '');
  if (!TYPES.has(scope)) throw new OneClickError('BAD_SCOPE', 400, 'Обхватът е portal, folder, file или selection');

  const hasher = hash && typeof hash.file === 'function' && typeof hash.basis === 'function' ? hash : hashFn();
  let entries = [];
  let skipped = 0;
  let target = null;
  let inside = '';

  if (Array.isArray(paths)) {
    // ИЗБРАНИ файлове (панелът „Дърво“): пътищата са относителни в портала и всяко едно
    // минава през същата проверка за изход — списъкът не е „доверен“, защото идва от екрана.
    if (!dir) throw new OneClickError('BAD_SCOPE', 400, 'Липсва папка на портала');
    const root = path.resolve(dir);
    if (!paths.length) throw new OneClickError('EMPTY_SCOPE', 400, 'Няма избрани файлове');
    for (const one of paths) {
      const abs = path.resolve(root, String(one || ''));
      const relInside = insideOf(root, abs);
      if (relInside === null || !relInside) throw new OneClickError('PATH_OUTSIDE_PORTAL', 400, 'Пътят излиза извън портала');
      const stat = await fsp.lstat(abs).catch((e) => {
        if (e.code === 'ENOENT') throw new OneClickError('NOT_FOUND', 404, 'Избран файл липсва: ' + relInside);
        throw e;
      });
      if (stat.isSymbolicLink() || !stat.isFile()) throw new OneClickError('NOT_A_FILE', 400, 'Избраният път не е файл: ' + relInside);
      const hashed = await hasher.file(abs);
      entries.push({ name: relInside, bytes: hashed.bytes, sha256: hashed.hex });
      if (entries.length > MAX_FILES) {
        throw new OneClickError('TOO_MANY_FILES', 413, `Обхватът е над ${MAX_FILES} файла — отчетът не се строи`);
      }
    }
  } else if (Array.isArray(sources)) {
    // Портал: описани са файловете от РЕГИСТЪРА, всеки премерен наново от диска — отчетът не
    // бива да повтаря стар хеш от записа, ако файлът е сменен или изчезнал.
    for (const source of sources) {
      const hashed = await hasher.file(source.abs);
      entries.push({ name: String(source.name), bytes: hashed.bytes, sha256: hashed.hex });
      if (entries.length > MAX_FILES) {
        throw new OneClickError('TOO_MANY_FILES', 413, `Обхватът е над ${MAX_FILES} файла — отчетът не се строи`);
      }
    }
  } else {
    if (!dir) throw new OneClickError('BAD_SCOPE', 400, 'Липсва папка на портала');
    const root = path.resolve(dir);
    target = path.resolve(root, String(rel || ''));
    inside = insideOf(root, target);
    if (inside === null) throw new OneClickError('PATH_OUTSIDE_PORTAL', 400, 'Пътят излиза извън портала');

    let stat;
    try {
      stat = await fsp.lstat(target);
    } catch (e) {
      if (e.code === 'ENOENT') throw new OneClickError('NOT_FOUND', 404, 'Няма такъв файл или папка в портала');
      throw e;
    }
    if (stat.isSymbolicLink()) throw new OneClickError('SYMLINK_SCOPE', 400, 'Символна връзка не е част от портала');
    if (scope === 'file' && !stat.isFile()) throw new OneClickError('NOT_A_FILE', 400, 'Обхватът „файл“ иска файл');
    if (scope === 'folder' && !stat.isDirectory()) throw new OneClickError('NOT_A_FOLDER', 400, 'Обхватът „папка“ иска папка');
    if (scope === 'portal') throw new OneClickError('BAD_SCOPE', 400, 'Отчетът за портал иска регистъра на портала');

    if (stat.isFile()) {
      const hashed = await hasher.file(target);
      entries = [{ name: path.basename(target), bytes: hashed.bytes, sha256: hashed.hex }];
    } else {
      const found = await collect(target, { hash: hasher });
      entries = found.entries;
      skipped = found.skipped;
    }
  }
  if (!entries.length) throw new OneClickError('EMPTY_SCOPE', 400, 'Обхватът е празен — няма какво да описва отчетът');

  const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  // Отпечатък на НАБОРА: редът влиза в сметката, затова „същите файлове“ и „същият набор“ са
  // различни твърдения (виж `core_module/hash.js#basis`).
  const basis = hasher.basis(entries.map((entry) => ({ sha256: entry.sha256, name: entry.name })));

  const baseName = scope === 'portal'
    ? safeBase(portal.slug, 'portal')
    : scope === 'selection'
      ? 'selected'
      : safeBase(path.basename(target), scope);
  const name = 'report-' + scope + '-' + baseName + '-' + stamp(createdAt) + '.pdf';
  const where = scope === 'portal'
    ? portal.title || portal.slug || ''
    : scope === 'selection'
      ? 'избрани файлове: ' + entries.length
      : inside || path.basename(target);

  const manifest = {
    schemaVersion: 1,
    profile: 'oneclick-' + scope,
    page: { format: 'A4', orientation: 'portrait', marginsMm: [15, 15, 15, 15] },
    branding: { organization: String(portal.title || portal.slug || 'hAPI Enterprise'), qr: false },
    print: { pageNumbers: true, headerFooter: true, footerNote: 'NO TRUST — VERIFY EVERYTHING' },
    blocks: [
      { id: 'b-start', type: 'rfc3161-start', locked: true, label: 'RFC 3161 START' },
      {
        id: 'b-title',
        type: 'title',
        value: scope === 'portal' ? 'ОТЧЕТ ЗА ПОРТАЛ' : scope === 'folder' ? 'ОТЧЕТ ЗА ПАПКА' : scope === 'file' ? 'ОТЧЕТ ЗА ФАЙЛ' : 'ОТЧЕТ ЗА ИЗБРАНИ ФАЙЛОВЕ',
        subtitle: where,
      },
      {
        id: 'b-meta',
        type: 'metadata',
        items: [
          { key: 'Портал', value: String(portal.title || '') },
          { key: 'Обхват', value: scope },
          { key: 'Път', value: where },
          { key: 'Файлове', value: String(entries.length) },
          { key: 'Байтове', value: String(bytes) },
          { key: 'Генериран', value: String(createdAt) },
        ],
      },
      {
        id: 'b-files',
        type: 'table',
        source: 'records:files',
        columns: ['Файл', 'Байтове', 'SHA-256'],
      },
      { id: 'b-hash', type: 'hash-table', algorithms: ['SHA256'] },
      {
        id: 'b-basis',
        type: 'text',
        value:
          'Отпечатък на набора (SHA-256 по подредените двойки „хеш + име“): ' +
          basis +
          (skipped ? ` · пропуснати символни връзки: ${skipped}` : ''),
      },
      {
        id: 'b-legal',
        type: 'legal',
        value:
          'Отчетът описва файловете към момента на генериране с точния им размер и SHA-256. ' +
          'Той не удостоверява произход и не съдържа времеви печат освен ако такъв не е поискан изрично.',
      },
      { id: 'b-stop', type: 'rfc3161-stop', locked: true, label: 'RFC 3161 STOP' },
    ],
  };

  return {
    manifest,
    data: { 'records:files': entries.map((entry) => [entry.name, String(entry.bytes), entry.sha256]) },
    hashes: { SHA256: basis },
    entries,
    totals: { files: entries.length, bytes, skipped },
    scope,
    path: scope === 'portal' ? '' : inside,
    name,
  };
}

module.exports = { build, OneClickError, MAX_FILES, TYPES };
