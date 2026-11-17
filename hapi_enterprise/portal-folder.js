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

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const paths = require('./paths');
const portalConfig = require('./portal-config');

/** Абсолютният път на папката на портала (на HA: /share/<slug>). */
function folderPath(storageRoot) {
  // Логическият корен (`/share`) се превежда до host път САМО тук — през `paths.js`, за да не
  // се появи „<диск>:\share“ на машина без Home Assistant (вж. `tests/storage-roots.cjs`).
  return paths.resolveStoragePath(String(storageRoot || paths.LOGICAL_ROOTS.share));
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

/**
 * Създава папката на портала (идемпотентно) и връща пътя ѝ.
 *
 * Общ корен (`/share`, `/media`, празен `storage_root`) НЕ се създава: това е папката на
 * всички портали, а на машина без Home Assistant би била `<диск>:\share`. Тогава се връща
 * `null` — порталът работи без собствена папка, както когато папката липсва.
 */
async function ensure(portal) {
  if (paths.isLogicalRoot(portal && portal.storage_root)) return null;
  const dir = folderPath(portal && portal.storage_root);
  await fsp.mkdir(dir, { recursive: true });
  // Всяка папка на портал носи СВОЕТО описание (`configuration.yaml`): портал без него е
  // просто папка. Създава се веднъж, с пълните подразбирания, за да се вижда на едно място
  // какво може да се настрои. Съществуващ файл НИКОГА не се презаписва — той е истината.
  const configFile = path.join(dir, DESCRIPTION);
  if (!fs.existsSync(configFile)) {
    try {
      // Началният файл носи ТЕКУЩИТЕ опции на портала (видимост, флаг, тема), не само
      // подразбиранията: иначе нов публичен портал изглежда частен, докато не се качи файл.
      const seed = Object.assign(portalConfig.initial({ slug: portal && portal.slug, title: portal && portal.title }), describePortal(portal));
      portalConfig.write(configFile, seed, { slug: portal && portal.slug });
    } catch (error) {
      // Само НЕВАЛИДНО описание се прескача (например портал без валиден slug): папката остава
      // без файл и го получава при първия успешен запис през API-то. Всяка друга грешка
      // (права, пълен диск) се вдига — там тишината би скрила загубени данни.
      if (error.code !== 'PORTAL_CONFIG_INVALID') throw error;
    }
  }
  return dir;
}

/**
 * Записва файл в папката на портала под свободно име.
 * @returns {Promise<{storagePath:string, name:string, bytes:number, dir:string}>}
 */
async function store(portal, name, data) {
  const dir = await ensure(portal);
  if (!dir) return null;
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
 * Съдържанието на папката на портала — това, което човек вижда до `portal.html`.
 *
 * Защо е нужно на самата страница: `portal.html` се записва В папката на портала, за да я
 * отвори човекът, който я разглежда в Home Assistant. До 0.69.107 тя изреждаше само
 * РЕГИСТРИРАНИТЕ файлове (`p.files`, качванията през API-то) и при портал върху реална папка
 * казваше „още няма файлове“, докато до нея лежаха десетки документи. Сега страницата изрежда
 * истинските папки и файлове, а адресите им водят към живия портал (`/p/<id>?folder=…`) и към
 * договора за един файл (`/tree/file?path=…`).
 *
 * Правила: скритите имена (`.` в началото) не се показват, генерираните файлове на портала
 * (`portal.html`, `api.json`, `openapi.json`) — също, а списъкът е ограничен, за да остане
 * страницата малка дори при хиляди документи.
 */
const LIST_MAX_FOLDERS = 200;
const LIST_MAX_FILES = 300;
const LIST_MAX_DEPTH = 5;

async function listTree(root) {
  const base = folderPath(root);
  const state = { folders: [], files: [], truncated: false, depthLimited: false };
  async function walk(dir, rel, depth) {
    if (state.folders.length >= LIST_MAX_FOLDERS || state.files.length >= LIST_MAX_FILES) { state.truncated = true; return }
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (state.folders.length >= LIST_MAX_FOLDERS || state.files.length >= LIST_MAX_FILES) { state.truncated = true; return }
      if (entry.name.startsWith('.')) continue;
      // Генерираните файлове живеят само в корена на папката; в подпапка същото име е документ.
      if (!rel && isGenerated(entry.name)) continue;
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        state.folders.push({ name: entry.name, path: '/' + childRel, depth });
        if (depth >= LIST_MAX_DEPTH) { state.depthLimited = true; continue }
        await walk(path.join(dir, entry.name), childRel, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fsp.stat(path.join(dir, entry.name)).catch(() => null);
      state.files.push({ name: entry.name, path: '/' + childRel, size: stat ? stat.size : 0 });
    }
  }
  await walk(base, '', 1);
  return state;
}

/**
 * Страницата `portal.html` на портала: обикновен HTML без стилове (CSP `style-src self`
 * не позволява вградени такива), който изрежда файловете и адресите им за изтегляне.
 * `tree` (от `listTree`) добавя ИСТИНСКОТО съдържание на папката — тогава страницата не
 * казва „няма файлове“, когато до нея има документи.
 */
function page(portal, base, tree = null) {
  const p = portal || {};
  const slug = String(p.slug || '');
  const root = String(base || '').replace(/\/+$/, '');
  // Изключените файлове не се показват: адресът им не работи и редът би бил подвеждащ.
  const files = (Array.isArray(p.files) ? p.files : []).filter((f) => (f.accessMode || 'FREE') !== 'DISABLED');
  const accessText = (mode) => (mode === 'KEY_REQUIRED' ? 'с ключ' : mode === 'DISABLED' ? 'изключен' : 'свободен');
  // Всяко действие е БУТОН, а до него стои информацията за файла: име, размер, отпечатък,
  // режим на достъп. Дотук редовете бяха само име-линк и човек не виждаше нищо друго.
  const rows = files
    .map((f) => {
      const url = `${root}/api/v1/p/${encodeURIComponent(slug)}/files/${encodeURIComponent(f.id)}/download`;
      const mode = f.accessMode || 'FREE';
      return `      <li><strong>${esc(f.name)}</strong> — ${Number(f.size) || 0} B · SHA-256 ${esc(
        String(f.sha256 || '').slice(0, 16),
      )}… · ${esc(accessText(mode))} · <a class="btn btn-sm" href="${esc(url)}" download>Свали</a></li>`;
    })
    .join('\n');
  // Живата страница: тя знае за ПАПКИТЕ на портала (`/tree`), докато този файл е само
  // списък от регистрираните файлове. Без тази връзка човек, отворил `portal.html` в самата
  // папка, вижда „още няма файлове“ и не разбира къде са подпапките му.
  const live = `${root}/p/${encodeURIComponent(String(p.id || slug))}`;
  // Истинското съдържание на папката: папките водят до живия портал с `?folder=`, файловете —
  // до договора за един файл (`/tree/file?path=`). Същите адреси, които дава и `api.json`.
  const folderItems = tree && tree.folders.length
    ? tree.folders
      .map((f) => `      <li><strong>${esc(f.name)}/</strong> · <a class="btn btn-sm" href="${esc(`${live}?folder=${encodeURIComponent(f.path.replace(/^\/+/, ''))}`)}">Отвори</a></li>`)
      .join('\n')
    : '';
  const fileItems = tree && tree.files.length
    ? tree.files
      .map((f) => `      <li><strong>${esc(f.name)}</strong> — ${Number(f.size) || 0} B · <a class="btn btn-sm" href="${esc(`${root}/api/v1/p/${encodeURIComponent(slug)}/tree/file?path=${encodeURIComponent(f.path)}`)}" download>Свали</a></li>`)
      .join('\n')
    : '';
  const treeBlock = folderItems || fileItems
    ? `  <p>В папката: ${tree.folders.length} папки, ${tree.files.length} файла${tree.truncated ? ' (показани са първите)' : ''}${tree.depthLimited ? `, по-дълбоки от ${LIST_MAX_DEPTH} нива не са обходени` : ''}.</p>
${folderItems ? `  <h2>Папки</h2>\n  <ul>\n${folderItems}\n  </ul>\n` : ''}${fileItems ? `  <h2>Файлове</h2>\n  <ul>\n${fileItems}\n  </ul>\n` : ''}`
    : '';
  // „още няма файлове“ остава само когато няма нито регистрирани файлове, нито съдържание.
  const empty = files.length || folderItems || fileItems ? '' : '      <li>още няма файлове</li>';
  // Поздравът е ПЪРВОТО нещо на страницата: човек трябва да разбере какво е това и кой го
  // изпраща, преди да види списък с файлове. Описанието на портала е най-добрият поздрав,
  // когато е попълнено; иначе се казва в едно изречение какво е това.
  const hello = String(p.description || p.subject || '').trim()
    || `Тук са файловете, които са споделени с вас. Портал „${String(p.title || slug)}“ на hAPI Enterprise.`;
  // Кратката информация за портала: това, което дотук се смяташе от посетителя по адресите.
  const facts = [
    `<dt>Идентификатор</dt><dd><code>${esc(String(p.id || ''))}</code></dd>`,
    p.storage_root ? `<dt>Папка</dt><dd><code>${esc(String(p.storage_root))}</code></dd>` : '',
    `<dt>Файлове в портала</dt><dd>${files.length}</dd>`,
    tree ? `<dt>В папката</dt><dd>${tree.folders.length} папки, ${tree.files.length} файла</dd>` : '',
  ].filter(Boolean).join('\n    ');
  return `<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(p.title || slug)} — портал hAPI Enterprise</title>
</head>
<body>
  <h1>Здравейте! Това е портал „${esc(p.title || slug)}“.</h1>
  <p>${esc(hello)}</p>
  <p>Портал <code>${esc(slug)}</code> на hAPI Enterprise. Файлове: ${files.length}.</p>
  <p><a class="btn btn-primary" href="${esc(live)}">Отвори портала</a> — там са папките, търсенето,
  QR кодът и всички действия.</p>
  <dl>
    ${facts}
  </dl>
${treeBlock}  <h2>Файлове, качени през портала</h2>
  <ul>
${rows || empty}
  </ul>
  <p>Цялата информация за портала е на тази страница: файловете, папките, броячите и
  отпечатъците. Страницата е генерирана от add-on-а при всяка промяна на портала и не се
  редактира на ръка.</p>
</body>
</html>
`;
}

/**
 * Началната страница на портала — `/portal.html` БЕЗ параметри.
 *
 * Защо: адресът на портала се дава на човек, а човек не знае slug и не бива да го знае.
 * Дотук `/portal.html` работеше само с `?folder=<slug>`, тоест „порталът“ нямаше адрес без
 * параметър. Тук е поздравът: един портал → неговите файлове; няколко → списък с бутони
 * „Отвори“ (всички към `/p/<id>`, тоест пак HTML на същия адрес, без отделен порт); нула →
 * едно изречение какво да се направи. Никъде няма технически адрес.
 */
function rootPage(portals, base) {
  const root = String(base || '').replace(/\/+$/, '');
  const list = (Array.isArray(portals) ? portals : []).filter(Boolean);
  const items = list
    .map((p) => {
      const count = Array.isArray(p.files) ? p.files.length : 0;
      return `      <li><strong>${esc(p.title || p.slug)}</strong> — ${count} ${count === 1 ? 'файл' : 'файла'} · ` +
        `<a class="btn btn-sm" href="${esc(`${root}/p/${encodeURIComponent(String(p.id || p.slug))}`)}">Отвори</a></li>`;
    })
    .join('\n');
  const body = list.length
    ? `  <p>${list.length === 1 ? 'Порталът е един.' : `Портали: ${list.length}.`} Всеки се отваря с бутона до името си.</p>\n  <ul>\n${items}\n  </ul>`
    : '  <p>Още няма портали. Първият се създава от панела на hAPI Enterprise.</p>';
  return `<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>hAPI Enterprise — портал</title>
</head>
<body>
  <h1>Здравейте! Това е hAPI Enterprise.</h1>
  <p>Тук са порталите с файловете, които са споделени с вас.</p>
${body}
  <p>Страницата се генерира от add-on-а; не се редактира на ръка.</p>
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
// Генерираните артефакти се трият при изтриване/преместване — затова са отделен списък от
  // описанието: `configuration.yaml` е СЪСТОЯНИЕТО на портала (опции, флагове на папките, файлове)
  // и не бива да изчезва при преместване. За дървото и двата вида НЕ са съдържание.
  const ARTIFACTS = new Set(['portal.html', 'api.json', 'openapi.json']);
  const GENERATED = ARTIFACTS;
  const DESCRIPTION = 'configuration.yaml';
  const isGenerated = (name) => ARTIFACTS.has(String(name || '')) || String(name || '') === DESCRIPTION;

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
  // Общ корен не е „папка на портала“ — договорът `/tree` там не важи (403), тоест картата
  // не бива да го обявява дори когато `/share` съществува на диска.
  if (paths.isLogicalRoot(portal && portal.storage_root)) return false;
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
  // Общ корен — сравнява се ЛОГИЧЕСКАТА стойност, не host път.
  if (paths.isLogicalRoot(portal && portal.storage_root)) return [];
  // Папката НЕ се създава тук: създаването на портал не бива да ражда папки в хранилището
  // (това е отделна опция, `portal_folder_copy`). Ако папката вече съществува — файловете
  // влизат в нея; ако не — порталът си работи както досега.
  const stat = await fsp.stat(dir).catch(() => null);
  if (!stat || !stat.isDirectory()) return [];
  // Страницата изрежда ИСТИНСКОТО съдържание на папката, а не само регистрираните файлове.
  // `listTree` очаква ЛОГИЧЕСКИЯ корен (`/share/...`) — тои самият превежда до host път.
  const tree = await listTree(portal && portal.storage_root);
  // Описанието се обновява ЗАЕДНО с артефактите: и двете са „състоянието на портала на диска“.
  // Така всяко място, което вече вика `writeArtifacts` (създаване, качване, триене, местене,
  // възстановяване), получава синхронизиран `configuration.yaml`, без да има втори списък с
  // извиквания, който да се разминава (точно това е DEF-63 по вид).
  await syncConfig(portal);
  const jobs = [['portal.html', page(portal, base, tree)]];
  if (artifacts && artifacts.record) jobs.push(['api.json', JSON.stringify(artifacts.record, null, 2)]);
  if (artifacts && artifacts.openapiText) jobs.push(['openapi.json', String(artifacts.openapiText)]);
  const written = [];
  for (const [name, content] of jobs) {
    await writeAtomic(path.join(dir, name), content);
    written.push(name);
  }
  return written;
}

/**
 * Маха ГЕНЕРИРАНИТЕ файлове от папка на портал, без да пипа документите на човека.
 *
 * Кога: порталът се изтрива или се премества в друга папка. Иначе в старата папка остава
 * `portal.html` с адрес към портал, който вече не съществува (или живее другаде), и
 * `api.json` със стария базов адрес — тоест документ, който изглежда валиден и лъже.
 *
 * `root` е `storage_root` (низ) или самият портал. Общ корен `/share`/`/media` не се пипа —
 * там генерираните файлове не се и записват.
 * @returns {Promise<string[]>} имената на премахнатите файлове
 */
async function removeArtifacts(root) {
  const dir = folderPath(typeof root === 'string' ? root : root && root.storage_root);
  if (paths.isLogicalRoot(typeof root === 'string' ? root : root && root.storage_root)) return [];
  const removed = [];
  for (const name of ARTIFACTS) {
    const full = path.join(dir, name);
    try {
      await fsp.unlink(full);
      removed.push(name);
    } catch (e) {
      // Липсващ файл не е грешка — точно това искаме. Друго (права, зает файл) се вдига,
      // за да се види в лога, вместо да се премълчи.
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return removed;
}

// ── Описание от записа (файл → база) ─────────────────────────────────────────
// `configuration.yaml` е и „настройки на портала“, и „какво има в портала“. Настройките се
// пишат от човек (или от панела); съдържанието (`files[]`) и самоличността (`portal.*`) идват
// от ЗАПИСА — тоест от базата, която е истината за това кои файлове съществуват. Затова при
// всяка промяна на портала описанието се сглобява наново: настройките се ЗАПАЗВАТ както са,
// а `portal.*` и `files[]` се обновяват. Ръчна промяна на САМИТЕ настройки оцелява.

/** Режимът на достъп в базата (`FREE`/`KEY_REQUIRED`/`DISABLED`) → езикът на описанието. */
const FILE_ACCESS_BY_MODE = Object.freeze({ FREE: 'free', KEY_REQUIRED: 'key', DISABLED: 'disabled' });
const PORTAL_VISIBILITY = new Set(['public', 'private']);
// Формите идват от договора на описанието — тук НЕ се пише втори комплект.
const { SHA256, CONTENT_ID, FILE_ID, ID_FIELD: IDENT } = portalConfig.RULES;
/** Фиксиран печат за сравнение: ревизията и датата се пишат при записа, не влизат в „променено ли е“. */
const STABLE_STAMP = '1970-01-01T00:00:00Z';

/** ISO 8601 (UTC) или празен низ — така в описанието не влиза „Invalid Date“. */
function iso(value) {
  const t = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

/**
 * Опциите, които идват от записа на портала (плосък вид, план 26).
 *
 * Връщат се ВИНАГИ — и празните стойности. Иначе изтрит идентификатор или изключен флаг щеше да
 * остане от предишния файл и описанието щеше да казва друго, отколкото базата.
 */
function describePortal(portal) {
  const slug = String((portal && portal.slug) || '');
  const name = (String((portal && portal.title) || '').trim() || slug || 'portal').slice(0, 160);
  const out = {
    slug: slug || 'portal',
    name,
    visibility: PORTAL_VISIBILITY.has(portal && portal.visibility) ? portal.visibility : 'private',
    flag: String((portal && portal.flag) || 'none'),
    category: String((portal && portal.category) || '').slice(0, 120),
    subject: String((portal && portal.subject) || '').slice(0, 200),
    notes: String((portal && (portal.notesText || portal.notes)) || '').slice(0, 2000),
    contact_id: '',
    case_id: '',
    parent_id: '',
    readonly: portal && portal.readonly === true,
  };
  // Идентификаторите се слагат само ако минават проверката — иначе цялото описание би паднало
  // заради едно чуждо поле, а то не е причина порталът да остане без описание.
  for (const [key, value] of [['contact_id', portal && portal.contactId], ['case_id', portal && portal.caseId], ['parent_id', portal && portal.parentId]]) {
    const text = String(value || '');
    if (text && IDENT.test(text)) out[key] = text;
  }
  return out;
}

/**
 * Разделът `files[]` — ГЕОГРАФИЯТА на портала: кой файл къде се намира.
 *
 * Пътят е този в папката на портала (`storagePath`), а когато файлът НЕ е в папката (шифрован
 * е, или копието е изключено) — виртуалният `/<име>`, защото там човекът го търси. Две
 * едноименни записи не могат да имат един път (проверката е без значение от регистъра),
 * затова вторият получава `-2`, `-3`… — същото правило, което `store()` прилага на диска.
 */
function describeFiles(portal) {
  const seen = new Set();
  const out = [];
  for (const file of Array.isArray(portal && portal.files) ? portal.files : []) {
    if (!file || typeof file.id !== 'string' || !FILE_ID.test(file.id)) continue;
    const sha = typeof file.sha256 === 'string' && SHA256.test(file.sha256.toLowerCase()) ? file.sha256.toLowerCase() : '';
    // Файл без валиден sha256 не може да се опише (описанието е и доказателство) — прескача се
    // мълчаливо само той, а не целият файл на портала.
    if (!sha) continue;
    const wanted = '/' + String(file.storagePath || '').replace(/^\/+/, '') || '/' + safeName(file.name);
    const base = wanted === '/' ? '/' + safeName(file.name) : wanted;
    let rel = base;
    for (let n = 2; seen.has(rel.toLowerCase()); n += 1) {
      const ext = path.posix.extname(base);
      rel = base.slice(0, base.length - ext.length) + '-' + n + ext;
    }
    seen.add(rel.toLowerCase());
    const entry = {
      id: file.id,
      path: rel,
      size: Number.isInteger(file.size) && file.size >= 0 ? file.size : 0,
      sha256: sha,
      access: FILE_ACCESS_BY_MODE[file.accessMode || 'FREE'] || 'free',
      listed: file.listed !== false,
    };
    const added = iso(file.uploadedAt);
    if (added) entry.added = added;
    const modified = iso(file.modifiedAt);
    if (modified) entry.modified = modified;
    if (typeof file.contentId === 'string' && CONTENT_ID.test(file.contentId)) entry.content_id = file.contentId;
    out.push(entry);
  }
  return out;
}

/**
 * Обновява `configuration.yaml` в папката на портала от ЗАПИСА — без да пипа настройките.
 *
 * Защо връща обект, а не „готово“: викащият (и тестът) трябва да види ДАЛИ е пипано, за да не
 * се вдига `revision` при всяка заявка. Затова запис има само когато съдържанието наистина се е
 * променило — иначе файлът и броячът на промените щяха да станат безсмислени.
 *
 * Никога не се презаписва файл, който НЕ СЕ РАЗБИРА (ръчна редакция по средата, чуждо съдържание,
 * счупен YAML): там отказът е единственият начин да не се загуби чужда работа. Отговорът тогава
 * е `{skipped:'invalid'}` с причините.
 *
 * @param {object} portal записът на портала от базата
 * @returns {Promise<{changed:boolean, revision?:number, skipped?:string, problems?:object[], issues?:object[]}>}
 */
async function syncConfig(portal) {
  const root = portal && portal.storage_root;
  // Общ корен не е папка на портала — там няма описание (както няма и артефакти).
  if (paths.isLogicalRoot(root)) return { changed: false, skipped: 'shared-root' };
  const dir = folderPath(root);
  const stat = await fsp.stat(dir).catch(() => null);
  if (!stat || !stat.isDirectory()) return { changed: false, skipped: 'no-folder' };
  const file = path.join(dir, DESCRIPTION);
  let current = null;
  if (await exists(file)) {
    let read;
    try {
      read = portalConfig.read(file, { slug: portal && portal.slug });
    } catch (error) {
      return { changed: false, skipped: 'unreadable', problems: [{ path: '', line: 0, message: error.message }] };
    }
    if (read.problems.length) return { changed: false, skipped: 'invalid', problems: read.problems };
    current = read;
  }
  const base = current ? current.data : portalConfig.initial({ slug: portal && portal.slug, title: portal && portal.title });
  const next = { ...base, ...describePortal(portal), files: describeFiles(portal) };
  // Идентификаторът се издава веднъж и се пази: смяна на заглавието не бива да прави нов обект.
  if (!next.id) next.id = portalConfig.makeId(next.slug, next.name, 1);
  const stable = (data) => portalConfig.emit({ ...data, revision: 1, updated_at: STABLE_STAMP });
  if (current && stable(next) === stable(current.data)) return { changed: false, revision: current.revision };
  try {
    const written = portalConfig.write(file, next, { slug: portal && portal.slug });
    return { changed: true, revision: written.revision };
  } catch (error) {
    // Записът от запис в базата не бива да събаря качването: невалидно описание се отчита
    // като „прескочено“ с причините, а не като изключение насред заявката.
    if (error.code === 'PORTAL_CONFIG_INVALID') return { changed: false, skipped: 'invalid-record', issues: error.issues };
    throw error;
  }
}

module.exports = { folderPath, safeName, ensure, store, remove, page, rootPage, listTree, writeArtifacts, folderReady, removeArtifacts, syncConfig, isGenerated, GENERATED, ARTIFACTS, DESCRIPTION };
