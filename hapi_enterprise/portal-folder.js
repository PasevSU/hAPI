'use strict';
// Папка на портала в хранилището: РЕАЛНИТЕ файлове, с истинските им имена.
//
// Защо съществува: качването в портал пази байтовете в data директорията под име на id
// (`files/<portalId>/<fileId>`) — на диска няма папка на портала и човек не може да намери
// файловете си. Тук всяко качване се слага и в папката на портала (`storage_root`) под
// оригиналното име, а `storagePath` се записва, за да го вижда и експлорерът.
//
// Правила:
//   • шифрованите файлове НЕ се слагат тук — иначе в /share щеше да има открит текст;
//   • едноименните не се презаписват: `име.pdf`, `име-2.pdf`, `име-3.pdf`;
//   • `portal.html` е генерирана страница на портала (списък с файловете и адресите им).

const fsp = require('node:fs/promises');
const path = require('node:path');

/** Абсолютният път на папката на портала (на HA: /share/<slug>). */
function folderPath(storageRoot) {
  return path.resolve(String(storageRoot || '/share'));
}

/** Име без път и без управляващи знаци — то става име на файл на диска. */
function safeName(name) {
  const base = path.basename(String(name == null ? '' : name).replace(/\\/g, '/'));
  // Управляващите знаци се проверяват по код, а не с регулярен израз: така няма
  // `no-control-regex` изключение и правилото остава същото (код < 32 се забранява).
  const cleaned = Array.from(base)
    .map((ch) => (ch.codePointAt(0) < 32 || ch === '/' || ch === '\\' ? '_' : ch))
    .join('')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned || 'file').slice(0, 200);
}

function candidate(name, attempt) {
  if (attempt <= 1) return name;
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  return `${stem}-${attempt}${ext}`;
}

async function exists(file) {
  return fsp.access(file).then(() => true, () => false);
}

/** Създава папката на портала (идемпотентно) и връща пътя ѝ. */
async function ensure(portal) {
  const dir = folderPath(portal && portal.storage_root);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Записва файл в папката на портала под свободно име.
 * @returns {Promise<{storagePath:string, name:string, bytes:number, dir:string}>}
 */
async function store(portal, name, data) {
  const dir = await ensure(portal);
  const wanted = safeName(name);
  for (let attempt = 1; attempt <= 500; attempt += 1) {
    const candidateName = candidate(wanted, attempt);
    const full = path.join(dir, candidateName);
    if (!full.startsWith(dir + path.sep)) throw Object.assign(new Error('Invalid path'), { status: 400 });
    if (await exists(full)) continue;
    try {
      // `wx` — файлът се създава само ако вече не съществува; при състезание се пробва
      // следващото име, вместо да се презапише чужд файл.
      await fsp.writeFile(full, data, { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if (e.code === 'EEXIST') continue;
      throw e;
    }
    return { storagePath: '/' + candidateName, name: candidateName, bytes: data.length, dir };
  }
  throw Object.assign(new Error('Too many files with the same name'), { status: 409 });
}

/** Маха файла от папката на портала (по `storagePath` от записа на файла). */
async function remove(portal, storagePath) {
  const rel = String(storagePath || '').replace(/^\/+/, '');
  if (!rel) return false;
  const dir = folderPath(portal && portal.storage_root);
  const full = path.resolve(dir, ...rel.split('/'));
  if (!full.startsWith(dir + path.sep)) return false;
  await fsp.rm(full, { force: true });
  return true;
}

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Страницата `portal.html` на портала: обикновен HTML без стилове (CSP `style-src self`
 * не позволява вградени такива), който изрежда файловете и адресите им за изтегляне.
 */
function page(portal, base) {
  const p = portal || {};
  const slug = String(p.slug || '');
  const root = String(base || '').replace(/\/+$/, '');
  // Изключените файлове не се показват: адресът им не работи и редът би бил подвеждащ.
  const files = (Array.isArray(p.files) ? p.files : []).filter((f) => (f.accessMode || 'FREE') !== 'DISABLED');
  const rows = files
    .map((f) => {
      const link = `${root}/api/v1/p/${encodeURIComponent(slug)}/files/${encodeURIComponent(f.id)}/download`;
      const mode = f.accessMode || 'FREE';
      const note = mode === 'FREE' ? 'свободен' : mode === 'KEY_REQUIRED' ? 'изисква ключ' : 'изключен';
      return `      <li><a href="${esc(link)}">${esc(f.name)}</a> — ${Number(f.size) || 0} B · ${esc(
        String(f.sha256 || '').slice(0, 16),
      )}… · ${note}</li>`;
    })
    .join('\n');
  // Живата страница: тя знае за ПАПКИТЕ на портала (`/tree`), докато този файл е само
  // списък от регистрираните файлове. Без тази връзка човек, отворил `portal.html` в самата
  // папка, вижда „още няма файлове“ и не разбира къде са подпапките му.
  const live = `${root}/p/${encodeURIComponent(String(p.id || slug))}`;
  return `<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(p.title || slug)} — портал hAPI Enterprise</title>
</head>
<body>
  <h1>${esc(p.title || slug)}</h1>
  <p>Портал <code>${esc(slug)}</code> на hAPI Enterprise. Файлове: ${files.length}.</p>
  <p>Живата страница (с папките и търсенето): <a href="${esc(live)}">${esc(live)}</a></p>
  <ul>
${rows || '      <li>още няма файлове</li>'}
  </ul>
  <p>Страницата е генерирана от add-on-а при всяка промяна на портала; не се редактира на ръка.
  Машиночитаемото описание е в <code>api.json</code> и <code>openapi.json</code> до нея.</p>
</body>
</html>
`;
}

/**
 * Генерираните файлове на портала, които живеят в САМАТА му папка.
 *
 * Те не са документи на човека: не влизат в списъка на папката, в експлорера, в ZIP пакета и
 * в доказателствените архиви на QR-а. Иначе всеки архив щеше да „записва“ и връща
 * `api.json`/`openapi.json`/`portal.html` заедно с документите, а броячите на папката щяха да
 * растат с три, без човекът да е добавил нищо.
 */
const GENERATED = new Set(['portal.html', 'api.json', 'openapi.json']);
const isGenerated = (name) => GENERATED.has(String(name || ''));

/** Атомарен запис в папката на портала (tmp + rename), за да не се чете половин файл. */
async function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.${require('node:crypto').randomBytes(6).toString('hex')}.tmp`;
  try {
    // 0600 като всички останали файлове на add-on-а: папката се чете от процеса и от
    // споделянето на Home Assistant, а световно достъпни права не са нужни за страница.
    await fsp.writeFile(tmp, content, { mode: 0o600 });
    await fsp.rename(tmp, file);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => { });
    throw e;
  }
}

/** Съществува ли РЕАЛНО папката на портала (за обявяване на договора `/tree` в картата). */
async function folderReady(portal) {
  const stat = await fsp.stat(folderPath(portal && portal.storage_root)).catch(() => null);
  return Boolean(stat && stat.isDirectory());
}

/**
 * Записва `portal.html` (и, ако са подадени, `api.json` / `openapi.json`) в САМАТА папка на
 * портала — до файловете на човека.
 *
 * Защо: до 0.69.102 тези файлове се записваха само в служебната директория на add-on-а
 * (`data/api/<slug>/`). Човек, който отвори папката си в Home Assistant
 * (`/share/USB/hapi/data/`), виждаше документите си и НЕ виждаше страницата на портала —
 * тоест папката не можеше да се отвори сама. Сега в нея има `portal.html`, който сочи към
 * живата страница (там се зареждат и подпапките).
 *
 * Общ корен (`/share`, `/media`) НЕ се пипа — това би сложило страница на един портал до
 * папките на всички останали. Записва се само когато порталът има собствена папка.
 * @returns {Promise<string[]>} имената на записаните файлове (празно, ако няма собствена папка)
 */
async function writeArtifacts(portal, base, artifacts = {}) {
  const dir = folderPath(portal && portal.storage_root);
  if (dir === path.resolve('/share') || dir === path.resolve('/media')) return [];
  // Папката НЕ се създава тук: създаването на портал не бива да ражда папки в хранилището
  // (това е отделна опция, `portal_folder_copy`). Ако папката вече съществува — файловете
  // влизат в нея; ако не — порталът си работи както досега.
  const stat = await fsp.stat(dir).catch(() => null);
  if (!stat || !stat.isDirectory()) return [];
  const jobs = [['portal.html', page(portal, base)]];
  if (artifacts && artifacts.record) jobs.push(['api.json', JSON.stringify(artifacts.record, null, 2)]);
  if (artifacts && artifacts.openapiText) jobs.push(['openapi.json', String(artifacts.openapiText)]);
  const written = [];
  for (const [name, content] of jobs) {
    await writeAtomic(path.join(dir, name), content);
    written.push(name);
  }
  return written;
}

module.exports = { folderPath, safeName, ensure, store, remove, page, writeArtifacts, folderReady, isGenerated, GENERATED };
