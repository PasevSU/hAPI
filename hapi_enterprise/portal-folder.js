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
  <ul>
${rows || '      <li>още няма файлове</li>'}
  </ul>
  <p>Страницата е генерирана от add-on-а при всяка промяна на портала; не се редактира на ръка.
  Машиночитаемото описание е в <code>api.json</code> и <code>openapi.json</code> до нея.</p>
</body>
</html>
`;
}

module.exports = { folderPath, safeName, ensure, store, remove, page };
