'use strict';
// ОПИСАНИЕ НА ПОРТАЛ (configuration.yaml) — един файл на портал.
//
// Защо: днес опциите на портала живеят в базата (`p.*`), флаговете на папките — в `p.folderMeta`,
// а списъкът на файловете — в `p.files`. Три места за едно и също, плюс нищо четимо на диска.
// Планът `docs/plan/23-portal-configuration-yaml-plan.md` въвежда ЕДИН файл в папката на портала
// (`<корен>/hAPI/portals/<slug>/configuration.yaml`): декларацията на портала, която човек може да
// прочете, копира и редактира, а панелът пише през API.
//
// Този модул е ДОГОВОРЪТ и не знае нищо за HTTP, база или панел:
//   • `parse(text)`     — строг четец на YAML ПОДМНОЖЕСТВО (виж по-долу), връща `{data, problems}`;
//   • `emit(data)`      — детерминиран запис (фиксиран ред на ключовете) → стабилен diff;
//   • `validate(data)`  — списък с `{path, line, message}`; празен списък = валиден файл;
//   • `effective(data)` — подразбирания + записаното (една истина: липсващ ключ = подразбиране);
//   • `read/write`      — четене и атомарен запис с `revision`, `updated_at` и проверка на `hash`;
//   • `verify(data, entries)` — сверка с диска: липсващ · излишен · променен;
//   • `diff(a, b)`      — какво точно се мени (за `409` и за панела).
//
// ПОДМНОЖЕСТВОТО (съзнателно, заради нула runtime зависимости): обекти до 4 нива, скалари,
// bool, числа, списъци от скалари и списък от обекти с ФИКСИРАН ред на ключовете (`files:`),
// плюс коментари. Забранени: табулация, дублиран ключ, anchors/aliases, многоредови блокове,
// изрази. Файлът е конфигурация, не програма — затова непознато нещо се ОТКАЗВА с ред, а не се
// прескача: тихо прескачане на ключ е начинът една опция да изчезне, без някой да разбере.
//
// ФОРМАТ (план 26, §1): опциите са ПЛОСЪК списък от имена (`visibility`, `access_mode`,
// `ui_columns`), не дървета `portal:`/`access:`/`qr:`. Всяка опция стои ВИНАГИ с текущата си
// стойност — няма „липсва ключ = подразбиране“, защото тогава файлът не казва какво се прилага.
// `off: []` изключва опция, без да губи стойността ѝ. Старият групиран файл се разбира и се
// превежда при четене (`migrate`), за да не остане съществуващ портал без описание.

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_DEPTH = 4;
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FILE_ID = /^[A-Za-z0-9_-]{6,64}$/;
const CONTENT_ID = /^CT-[0-9a-f]{32}$/;
const ID_FIELD = /^[A-Za-z0-9_-]{0,64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

// ── Опции: ПЛОСЪК списък (план 26, §1) ────────────────────────────────────────
// Редът тук е и редът на ключовете във файла — затова diff-ът е четим, а два записа на едни и
// същи стойности дават един и същ текст. Това е и списъкът на опциите, които `off:` може да
// изключи: непознато име в `off` е грешка, а не тихо игнориране.
const DEFAULTS = {
  slug: '',
  name: '',
  visibility: 'private',
  flag: 'none',
  category: '',
  subject: '',
  notes: '',
  contact_id: '',
  case_id: '',
  parent_id: '',
  readonly: false,
  access_mode: '',
  access_review_only: false,
  access_download_requires_key: true,
  temporary_default_ttl: '24h',
  temporary_default_read_only: true,
  temporary_password_required: false,
  qr_style: 'frame',
  qr_caption: 'url',
  qr_levels_folder: true,
  qr_levels_file: true,
  qr_archive_on_change: false,
  folders_default_visible: true,
  folders_default_media: false,
  folders_default_locked: false,
  storage_subpath: '',
  storage_copy_to_folder: true,
  ui_columns: 3,
  ui_show_sizes: true,
  audit_telemetry: true,
};

const OPTION_KEYS = Object.freeze(Object.keys(DEFAULTS));
const BOOL_KEYS = Object.freeze(OPTION_KEYS.filter((key) => typeof DEFAULTS[key] === 'boolean'));
const TEXT_LIMITS = Object.freeze({ name: 160, flag: 64, category: 120, subject: 200, notes: 2000 });

const ENUMS = {
  visibility: ['public', 'private'],
  access_mode: ['', 'free', 'key', 'token'],
  temporary_default_ttl: ['1h', '6h', '24h'],
  qr_style: ['frame', 'plain'],
  qr_caption: ['url', 'title'],
  ui_columns: [2, 3, 4],
};

// ── Общи правила ───────────────────────────────────────────────────────────────
// Един източник за формите, които се проверяват и в описанието, и в папката: вторият четец
// (portal-folder.js) взима СЪЩИТЕ изрази, за да не се разминат две проверки на едно и също.
const RULES = Object.freeze({ SLUG, SHA256, FILE_ID, CONTENT_ID, ID_FIELD, ISO });

const FILE_KEYS = ['id', 'path', 'size', 'sha256', 'version', 'access', 'listed', 'mirror', 'added', 'modified', 'content_id'];
const FILE_ACCESS = ['free', 'key', 'disabled'];
// Имена, които НЕ са съдържание: те са генерирани или служебни и не влизат във `files[]`.
const RESERVED = new Set(['configuration.yaml', 'portal.html', 'api.json', 'openapi.json', '.worm']);

// ── Идентификатор `{{portal}}-{{portal_name}}-001` ────────────────────────────
// Трите части са задължителни (план 26, §1): ключът на портала, името в машинен вид и пореден
// номер с ТРИ цифри. Номерът само расте и не се използва повторно — затова `nextNumber` гледа
// най-големия издаден, а не броя на издадените (изтрит обект оставя празнина, не освобождава ред).
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sht', ъ: 'a', ь: '', ю: 'yu', я: 'ya',
};
const ID_PART = /^[a-z0-9][a-z0-9-]*$/;

/** Име в машинен вид: малки латински букви, цифри и ЕДНО тире между думите. */
function machineName(name) {
  let out = '';
  for (const ch of String(name == null ? '' : name).toLowerCase()) {
    out += Object.prototype.hasOwnProperty.call(TRANSLIT, ch) ? TRANSLIT[ch] : ch;
  }
  return out
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48)
    .replace(/-+$/, '');
}

/** Издава идентификатор; `number` е поредният номер (1 → `-001`). */
function makeId(slug, name, number) {
  const key = SLUG.test(String(slug || '')) ? String(slug) : 'portal';
  const middle = machineName(name) || 'portal';
  const n = Math.min(Math.max(Number.parseInt(number, 10) || 1, 1), 999);
  return key + '-' + middle + '-' + String(n).padStart(3, '0');
}

/** Следващият свободен номер по ВЕЧЕ ИЗДАДЕНИТЕ идентификатори (не се преизползва). */
function nextNumber(ids) {
  let max = 0;
  for (const id of ids || []) {
    const match = /-(\d{3})$/.exec(String(id));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return Math.min(max + 1, 999);
}

/** Изключена ли е опция (`off:`), без да се губи стойността ѝ. */
function isOff(data, key) {
  return Array.isArray(data && data.off) && data.off.includes(key);
}

// ── Стар (групиран) формат → плосък ────────────────────────────────────────────
// До 0.69.235 файлът беше с групи `portal:`/`access:`/`qr:`; такива файлове вече съществуват
// на диск. Четенето ги превежда, а записът винаги пише плоския вид — така никой портал не
// остава без описание заради смяна на формата.
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function isGrouped(data) {
  return isPlainObject(data) && isPlainObject(data.portal);
}

function migrate(data) {
  if (!isPlainObject(data)) return {};
  if (!isGrouped(data)) return data;
  const p = data.portal;
  const a = isPlainObject(data.access) ? data.access : {};
  const t = isPlainObject(a.temporary) ? a.temporary : {};
  const q = isPlainObject(data.qr) ? data.qr : {};
  const levels = isPlainObject(q.levels) ? q.levels : {};
  const f = isPlainObject(data.folders) ? data.folders : {};
  const fd = isPlainObject(f.defaults) ? f.defaults : {};
  const st = isPlainObject(data.storage) ? data.storage : {};
  const ui = isPlainObject(data.ui) ? data.ui : {};
  const au = isPlainObject(data.audit) ? data.audit : {};
  const out = {
    version: data.version,
    revision: data.revision,
    updated_at: data.updated_at,
    id: data.id,
    slug: p.slug,
    name: p.title,
    visibility: p.visibility,
    flag: p.flag,
    category: p.category,
    subject: p.subject,
    notes: p.notes,
    contact_id: p.contact_id,
    case_id: p.case_id,
    parent_id: p.parent_id,
    readonly: p.readonly,
    access_mode: a.mode,
    access_review_only: a.review_only,
    access_download_requires_key: a.download_requires_key,
    temporary_default_ttl: t.default_ttl,
    temporary_default_read_only: t.default_read_only,
    temporary_password_required: t.password_required,
    qr_style: q.style,
    qr_caption: q.caption,
    qr_levels_folder: levels.folder,
    qr_levels_file: levels.file,
    qr_archive_on_change: q.archive_on_change,
    folders_default_visible: fd.visible,
    folders_default_media: fd.media,
    folders_default_locked: fd.locked,
    storage_subpath: st.subpath,
    storage_copy_to_folder: st.copy_to_folder,
    ui_columns: ui.columns,
    ui_show_sizes: ui.show_sizes,
    audit_telemetry: au.telemetry,
    off: Array.isArray(data.off) ? data.off : [],
    folders: isPlainObject(f.items) ? f.items : {},
    files: Array.isArray(data.files) ? data.files : [],
  };
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  // Старият формат нямаше „всяка опция присъства винаги“ — липсващото там е подразбиране.
  // Затова преводът го допълва, за да не падне проверката заради самата смяна на формата.
  for (const key of OPTION_KEYS) if (out[key] === undefined) out[key] = structuredClone(DEFAULTS[key]);
  // Идентичността се издава веднъж при превода — за да има и старият портал своя ключ.
  if (!out.id && out.slug) out.id = makeId(out.slug, out.name, 1);
  return out;
}

// ── Четец на подмножеството ────────────────────────────────────────────────────
const isBlank = (line) => !line.trim() || line.trim().startsWith('#');
const indentOf = (line) => line.length - line.trimStart().length;

/** Скалар: кавички, bool, цяло число или гол низ. Нищо друго — иначе е грешка. */
function scalar(raw) {
  const text = raw.trim();
  if (text === '') return { ok: true, value: null };
  if (text.startsWith('"')) {
    if (text.length < 2 || !text.endsWith('"')) return { ok: false, error: 'незатворени кавички' };
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false, error: 'невалидна екранировка в низ в кавички' };
    }
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) return { ok: false, error: 'незатворени кавички' };
    return { ok: true, value: text.slice(1, -1).replace(/''/g, "'") };
  }
  if (text === 'true') return { ok: true, value: true };
  if (text === 'false') return { ok: true, value: false };
  if (text === 'null' || text === '~') return { ok: true, value: null };
  if (/^-?\d+$/.test(text)) return { ok: true, value: Number(text) };
  if (/[[\]{}&*!|>%@`:#]/.test(text)) {
    // Двоеточието и решетката са опасни голи: в YAML те отварят съответно двойка и коментар.
    return { ok: false, error: 'низ с специален знак трябва да е в кавички' };
  }
  return { ok: true, value: text };
}

/** Ключ: гол или в кавички (`folders.items."/папка"`). */
function keyOf(raw) {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'празен ключ' };
  if (text.startsWith('"')) {
    const parsed = scalar(text);
    return parsed.ok && typeof parsed.value === 'string' ? parsed : { ok: false, error: 'невалиден ключ в кавички' };
  }
  if (text.startsWith("'")) {
    const parsed = scalar(text);
    return parsed.ok && typeof parsed.value === 'string' ? parsed : { ok: false, error: 'невалиден ключ в кавички' };
  }
  if (/[:\s]/.test(text)) return { ok: false, error: 'ключът съдържа интервал или двоеточие — сложи го в кавички' };
  return { ok: true, value: text };
}

function parse(text) {
  const problems = [];
  const data = {};
  const lines = String(text == null ? '' : text).split('\n');
  // Стек от {indent, node} — обектите се строят по отстъп, както ги вижда човек.
  const stack = [{ indent: -1, node: data }];
  let listTarget = null; // списък, в който влизат `- ` редовете
  // Отстъпът на самите `- ` редове. Без него вторият елемент на списък от ОБЕКТИ се губеше:
  // полетата на първия елемент затваряха списъка и следващото `- ` оставаше „без списък“
  // (хванато от `portal-config-seed`, когато порталът получи ВТОРИ файл).
  let listIndent = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].replace(/\r$/, '');
    const lineNo = index + 1;
    if (isBlank(raw)) continue;
    if (/^\t/.test(raw) || /^ *\t/.test(raw)) {
      problems.push({ path: '', line: lineNo, message: 'табулация за отстъп — позволени са само интервали' });
      return { data: {}, problems };
    }
    const indent = indentOf(raw);
    const body = raw.trim();

    if (body.startsWith('- ')) {
      if (!listTarget) {
        problems.push({ path: '', line: lineNo, message: 'елемент на списък без списък' });
        continue;
      }
      const item = body.slice(2);
      // `- ключ: стойност` отваря обект в списъка (така се пише `files:`); `- стойност` е скалар.
      const colon = item.indexOf(': ');
      const isPair = colon > 0 && !item.startsWith('"') && !item.startsWith("'");
      if (isPair) {
        const key = keyOf(item.slice(0, colon));
        const value = scalar(item.slice(colon + 1));
        if (!key.ok) {
          problems.push({ path: '', line: lineNo, message: key.error });
          continue;
        }
        if (!value.ok) {
          problems.push({ path: key.value, line: lineNo, message: value.error });
          continue;
        }
        const entry = {};
        entry[key.value] = value.value;
        // Новият елемент стои на нивото на списъка, а не на предходния елемент.
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
        listTarget.push(entry);
        stack.push({ indent, node: entry });
      } else {
        const value = scalar(item);
        if (!value.ok) {
          problems.push({ path: '', line: lineNo, message: value.error });
          continue;
        }
        listTarget.push(value.value);
      }
      continue;
    }

    const colon = body.indexOf(':');
    if (colon < 0) {
      problems.push({ path: '', line: lineNo, message: 'ред без „:“ — очаква се „ключ: стойност“' });
      continue;
    }
    // Ключът е ИЗВЪН списъка само ако е на неговото ниво или по-нагоре; ключовете на самия
    // елемент (по-дълбок отстъп) не затварят списъка.
    if (listIndent >= 0 && indent <= listIndent) {
      listTarget = null;
      listIndent = -1;
    }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].node : data;
    const key = keyOf(body.slice(0, colon));
    if (!key.ok) {
      problems.push({ path: '', line: lineNo, message: key.error });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(parent, key.value)) {
      problems.push({ path: key.value, line: lineNo, message: 'дублиран ключ „' + key.value + '“' });
      continue;
    }
    const rest = body.slice(colon + 1).trim();
    if (rest === '') {
      // Празната стойност може да е обект или списък — решава следващият значим ред.
      const child = {};
      parent[key.value] = child;
      stack.push({ indent, node: child });
      const next = lines.slice(index + 1).find((l) => l.trim() && !l.trim().startsWith('#'));
      if (next !== undefined && next.trim().startsWith('- ')) {
        const arr = [];
        parent[key.value] = arr;
        stack[stack.length - 1] = { indent, node: arr };
        listTarget = arr;
        listIndent = indentOf(next);
        // Обектът вече не е нужен: списъкът заема мястото си.
        stack[stack.length - 1].node = arr;
      }
      continue;
    }
    if (rest === '[]') {
      parent[key.value] = [];
      continue;
    }
    if (rest === '{}') {
      parent[key.value] = {};
      continue;
    }
    const value = scalar(rest);
    if (!value.ok) {
      problems.push({ path: key.value, line: lineNo, message: value.error });
      continue;
    }
    parent[key.value] = value.value;
    if (stack.length > MAX_DEPTH + 1) {
      problems.push({ path: key.value, line: lineNo, message: 'твърде дълбоко вгнездяване (до ' + MAX_DEPTH + ' нива)' });
    }
  }
  return { data, problems };
}

// ── Запис (детерминиран) ───────────────────────────────────────────────────────
const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

function quote(value) {  // Числата и bool се пишат голи: иначе обратният прочит ги вижда като низ („true“ вместо true).
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return 'null';  const text = String(value);
  // Голите низове се пишат голи само когато са безопасни: иначе обратният прочит би ги разбрал
  // като число, bool или специален знак.
  const safe = text !== '' && !/^[\s]|[\s]$/.test(text) && !/^[*&!|>%@`"'[\]{}#]/.test(text) &&
    !/[:#]/.test(text) && !/^(true|false|null|~|-?\d+)$/.test(text);
  return safe ? text : JSON.stringify(text);
}

function emitMap(node, indent, out) {
  const pad = ' '.repeat(indent);
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined) continue;
    const name = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
    if (Array.isArray(value)) {
      if (!value.length) {
        out.push(pad + name + ': []');
        continue;
      }
      out.push(pad + name + ':');
      for (const item of value) {
        if (isScalar(item)) {
          out.push(pad + '  - ' + quote(item));
          continue;
        }
        const keys = FILE_KEYS.filter((k) => item[k] !== undefined);
        const rest = Object.keys(item).filter((k) => !FILE_KEYS.includes(k));
        const order = [...keys, ...rest];
        order.forEach((k, i) => {
          const line = '  ' + quote(k) + ': ' + quote(item[k]);
          out.push(pad + (i === 0 ? '  - ' : '    ') + line.trimStart());
        });
      }
      continue;
    }
    if (value && typeof value === 'object') {
      if (!Object.keys(value).length) {
        out.push(pad + name + ': {}');
        continue;
      }
      out.push(pad + name + ':');
      emitMap(value, indent + 2, out);
      continue;
    }
    out.push(pad + name + ': ' + quote(value));
  }
}

function emit(data) {
  // `files` се подрежда по ПЪТ (байтов ред, без locale): така два записа на едни и същи данни
  // дават един и същ текст, а diff-ът е четим. Осталите списъци пазят реда си — той е смисъл.
  const ordered = { ...data };
  if (Array.isArray(ordered.files)) {
    ordered.files = [...ordered.files].sort((a, b) => {
      const left = String((a && a.path) || '');
      const right = String((b && b.path) || '');
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }
  const out = [];
  emitMap(ordered, 0, out);
  return out.join('\n') + '\n';
}

// ── Проверка ───────────────────────────────────────────────────────────────────
function validate(data, options) {
  const opts = options || {};
  const issues = [];
  const add = (key, message) => issues.push({ path: key, line: 0, message });

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    add('', 'описанието трябва да е обект');
    return issues;
  }
  if (data.version !== 1) add('version', 'позволена е само версия 1 (други стойности не се разбират)');
  if (!Number.isInteger(data.revision) || data.revision < 1) add('revision', 'трябва да е цяло число ≥ 1');
  if (typeof data.updated_at !== 'string' || !ISO.test(data.updated_at)) add('updated_at', 'очаква се ISO 8601 дата (UTC)');

  // Всяка опция присъства ВИНАГИ — липсващ ключ не е „подразбиране“, защото тогава файлът не
  // казва какво реално се прилага. Затова отсъствието е грешка с ясно име, не тихо допълване.
  for (const key of OPTION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) add(key, 'опцията липсва — всяка опция стои във файла с текущата си стойност');
  }

  if (typeof data.slug !== 'string' || !SLUG.test(data.slug)) {
    add('slug', 'позволени са малки латински букви, цифри и тирета (2–63 знака)');
  } else if (opts.slug && data.slug !== opts.slug) {
    add('slug', 'несъвпадащо име на папка: файлът е в „' + opts.slug + '“, а казва „' + data.slug + '“');
  }

  // `{{portal}}-{{portal_name}}-001`: ключът и номерът са машинни, средата е име в машинен вид.
  if (typeof data.id !== 'string' || !/-\d{3}$/.test(data.id)) {
    add('id', 'очаква се „{{portal}}-{{portal_name}}-001“ (три части и точно три цифри)');
  } else if (typeof data.slug === 'string' && data.slug && !data.id.startsWith(data.slug + '-')) {
    add('id', 'първата част трябва да е ключът на портала „' + data.slug + '“');
  } else {
    const middle = data.id.slice((data.slug || '').length + 1, -4);
    if (!middle || !ID_PART.test(middle) || /--/.test(middle)) {
      add('id', 'втората част е машинно име: малки латински букви, цифри и ЕДНО тире между думите');
    }
  }

  if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > TEXT_LIMITS.name) {
    add('name', 'име 1–' + TEXT_LIMITS.name + ' знака');
  }
  for (const key of ['flag', 'category', 'subject', 'notes']) {
    if (typeof data[key] !== 'string' || data[key].length > TEXT_LIMITS[key]) {
      add(key, 'низ до ' + TEXT_LIMITS[key] + ' знака');
    }
  }
  for (const key of ['contact_id', 'case_id', 'parent_id']) {
    if (typeof data[key] !== 'string' || !ID_FIELD.test(data[key])) {
      add(key, 'позволен е само идентификатор (букви, цифри, „-“, „_“)');
    }
  }
  for (const key of BOOL_KEYS) {
    if (typeof data[key] !== 'boolean') add(key, 'очаква се true/false');
  }
  if (!Number.isInteger(data.ui_columns) || !ENUMS.ui_columns.includes(data.ui_columns)) add('ui_columns', 'позволени: 2, 3, 4');
  if (opts.readonly === true && data.readonly !== true) {
    add('readonly', 'копие „само за четене“ трябва да носи readonly: true');
  }
  if (opts.readonly === false && data.readonly === true) {
    add('readonly', 'четящият портал не може да е readonly');
  }

  checkEnums(data, issues);

  // `off:` е списък от ИМЕНА на опции: стойността остава, но опцията не се прилага.
  if (!Array.isArray(data.off)) add('off', 'очаква се списък (празен, когато нищо не е изключено)');
  else {
    const seen = new Set();
    data.off.forEach((name, index) => {
      if (typeof name !== 'string' || !OPTION_KEYS.includes(name)) add('off[' + index + ']', 'непозната опция „' + name + '“');
      else if (seen.has(name)) add('off[' + index + ']', 'дублирана опция „' + name + '“');
      else seen.add(name);
    });
  }

  // Флаговете на вътрешните папки са ДАННИ, не опция: един запис по път в същия файл.
  if (data.folders !== undefined && !isPlainObject(data.folders)) add('folders', 'очаква се обект „път → флагове“');
  const items = isPlainObject(data.folders) ? data.folders : {};
  for (const [rel, meta] of Object.entries(items)) {
    // Ключът на папка се пише с водеща наклонена черта („/Договори“), както е и в адреса на
    // портала (`?folder=/<път>`); самата проверка работи върху относителната част.
    if (!safeRel(rel.startsWith('/') ? rel.slice(1) : rel)) add('folders', 'невалиден път на папка: „' + rel + '“');
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      add('folders', 'флаговете на „' + rel + '“ трябва да са обект');
      continue;
    }
    for (const key of Object.keys(meta)) {
      if (!['visible', 'media', 'locked', 'reason'].includes(key)) {
        add('folders', 'непознат флаг „' + key + '“ за „' + rel + '“');
      }
    }
    for (const key of ['visible', 'media', 'locked']) {
      if (meta[key] !== undefined && typeof meta[key] !== 'boolean') add('folders', '„' + key + '“ при „' + rel + '“ е true/false');
    }
    if (meta.locked === true && (typeof meta.reason !== 'string' || !meta.reason.trim() || meta.reason.length > 500)) {
      add('folders', 'заключената папка „' + rel + '“ иска причина (1–500 знака)');
    }
  }

  const sub = data.storage_subpath;
  if (typeof sub !== 'string' || (sub !== '' && (!safeRel(sub) || sub.split('/').length > 3)) || sub.length > 160) {
    add('storage_subpath', 'позволен е празен или относителен път до 3 сегмента (без „..“)');
  }

  const files = data.files === undefined ? [] : data.files;
  if (!Array.isArray(files)) add('files', 'очаква се списък');
  else {
    if (files.length > MAX_FILES) add('files', 'повече от ' + MAX_FILES + ' записа — описанието не е за толкова файлове');
    const ids = new Set();
    const paths = new Set();
    files.forEach((file, index) => {
      const where = 'files[' + index + ']';
      if (!file || typeof file !== 'object' || Array.isArray(file)) {
        add(where, 'очаква се обект');
        return;
      }
      for (const key of Object.keys(file)) {
        if (!FILE_KEYS.includes(key)) add(where, 'непознато поле „' + key + '“');
      }
      if (typeof file.id !== 'string' || !FILE_ID.test(file.id)) add(where + '.id', 'идентификатор 6–64 знака (букви, цифри, „-“, „_“)');
      else if (ids.has(file.id)) add(where + '.id', 'дублиран идентификатор „' + file.id + '“');
      else ids.add(file.id);
      const rel = file.path;
      if (typeof rel !== 'string' || !rel.startsWith('/') || !safeRel(rel.slice(1)) || rel.slice(1).split('/').length > 10) {
        add(where + '.path', 'пътят започва с „/“, до 10 сегмента, без „..“ и контролни знаци');
      } else {
        const base = rel.split('/').pop();
        if (RESERVED.has(base) || base.startsWith('.')) add(where + '.path', '„' + base + '“ не е съдържание (генериран/служебен файл)');
        const lower = rel.toLowerCase();
        if (paths.has(lower)) add(where + '.path', 'дублиран път (без значение от регистъра): ' + rel);
        else paths.add(lower);
      }
      if (!Number.isInteger(file.size) || file.size < 0) add(where + '.size', 'очаква се цяло число ≥ 0');
      if (typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)) add(where + '.sha256', 'очаква се sha256 (64 шестнайсетични знака)');
      if (file.version !== undefined && (!Number.isInteger(file.version) || file.version < 1)) add(where + '.version', 'цяло число ≥ 1');
      if (!FILE_ACCESS.includes(file.access)) add(where + '.access', 'позволени: ' + FILE_ACCESS.join(', '));
      for (const key of ['listed', 'mirror']) {
        if (file[key] !== undefined && typeof file[key] !== 'boolean') add(where + '.' + key, 'очаква се true/false');
      }
      for (const key of ['added', 'modified']) {
        if (file[key] !== undefined && (typeof file[key] !== 'string' || !ISO.test(file[key]))) add(where + '.' + key, 'очаква се ISO 8601 дата');
      }
      if (file.content_id !== undefined && (typeof file.content_id !== 'string' || !CONTENT_ID.test(file.content_id))) {
        add(where + '.content_id', 'очаква се „CT-“ + 32 шестнайсетични знака');
      }
    });
  }
  return issues;
}

function checkEnums(data, issues) {
  for (const [dotted, allowed] of Object.entries(ENUMS)) {
    const parts = dotted.split('.');
    let node = data;
    for (const part of parts.slice(0, -1)) node = node && typeof node === 'object' ? node[part] : undefined;
    if (!node || typeof node !== 'object') continue;
    const key = parts[parts.length - 1];
    if (node[key] === undefined) continue;
    if (!allowed.includes(node[key])) {
      issues.push({ path: dotted, line: 0, message: 'позволени: ' + allowed.map((v) => (v === '' ? '„“' : v)).join(', ') });
    }
  }
}

/** Относителен път, който не може да излезе от папката си. */
function safeRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 400) return false;
  if (rel.includes('\\')) return false;
  // Контролните знаци се проверяват по КОД, а не с регулярен израз: `no-control-regex` е
  // основателно правило (такъв израз е невидим при четене) и не бива да се потиска.
  for (const ch of rel) if (ch.charCodeAt(0) < 0x20) return false;
  return rel.split('/').every((seg) => seg && seg !== '.' && seg !== '..' && !seg.endsWith('.') && !seg.endsWith(' '));
}

// ── Ефективни стойности ────────────────────────────────────────────────────────
/** Подразбирания + записаното (плосък вид). `access_mode` по подразбиране следва видимостта. */
function effective(data) {
  const source = migrate(data || {});
  const out = {};
  for (const key of OPTION_KEYS) {
    out[key] = source[key] === undefined ? structuredClone(DEFAULTS[key]) : source[key];
  }
  if (!out.access_mode) out.access_mode = out.visibility === 'public' ? 'free' : 'key';
  out.off = Array.isArray(source.off) ? source.off.slice() : [];
  // Флаговете по път са ДАННИ и остават както са във файла; подразбиранията са плоски опции.
  out.folders = isPlainObject(source.folders) ? structuredClone(source.folders) : {};
  return out;
}

// ── Сверка с диска ─────────────────────────────────────────────────────────────
/**
 * @param {object} data описание
 * @param {Array<{path: string, sha256?: string, danger?: string}>} entries какво има на диска
 */
function verify(data, entries) {
  const listed = new Map();
  for (const file of (data && data.files) || []) {
    if (file && typeof file.path === 'string') listed.set(file.path, file);
  }
  const missing = [];
  const changed = [];
  const unreadable = [];
  const onDisk = new Set();
  for (const entry of entries || []) {
    if (!entry || typeof entry.path !== 'string') continue;
    const base = entry.path.split('/').pop() || '';
    if (RESERVED.has(base) || base.startsWith('.')) continue;
    onDisk.add(entry.path);
    if (!listed.has(entry.path)) continue;
    if (entry.unreadable) {
      unreadable.push(entry.path);
      continue;
    }
    if (typeof entry.sha256 === 'string' && entry.sha256 !== listed.get(entry.path).sha256) changed.push(entry.path);
  }
  for (const rel of listed.keys()) if (!onDisk.has(rel)) missing.push(rel);
  const extra = [...onDisk].filter((rel) => !listed.has(rel));
  return {
    ok: !missing.length && !extra.length && !changed.length && !unreadable.length,
    missing,
    extra,
    changed,
    unreadable,
  };
}

// ── Разлика ────────────────────────────────────────────────────────────────────
function flatten(node, prefix, out) {
  for (const [key, value] of Object.entries(node || {})) {
    const dotted = prefix ? prefix + '.' + key : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, dotted, out);
    else out.set(dotted, JSON.stringify(value));
  }
  return out;
}

function diff(before, after) {
  const a = flatten(before, '', new Map());
  const b = flatten(after, '', new Map());
  const out = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(key) !== b.get(key)) {
      out.push({ path: key, from: a.has(key) ? JSON.parse(a.get(key)) : undefined, to: b.has(key) ? JSON.parse(b.get(key)) : undefined });
    }
  }
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

// ── Четене и запис ─────────────────────────────────────────────────────────────
/**
 * Чете и проверява. `digest` се подава от викащия (`core.api.hash.digest`) — модулът не въвежда
 * втори начин за смятане на хеш. Стар (групиран) файл се превежда към плоския вид и се отбелязва
 * с `legacy: true`, за да знае панелът, че следващият запис ще смени формата.
 */
function read(absPath, options) {
  const opts = options || {};
  const text = fs.readFileSync(absPath, 'utf8');
  const bytes = Buffer.byteLength(text, 'utf8');
  const parsed = parse(text);
  const legacy = isGrouped(parsed.data);
  const data = legacy ? migrate(parsed.data) : parsed.data;
  const problems = parsed.problems.slice();
  if (bytes > MAX_BYTES) problems.push({ path: '', line: 0, message: 'файлът е над ' + MAX_BYTES + ' байта' });
  if (!problems.length) problems.push(...validate(data, opts));
  return {
    text,
    data,
    problems,
    legacy,
    revision: Number.isInteger(data.revision) ? data.revision : 0,
    hash: typeof opts.digest === 'function' ? opts.digest(text) : null,
  };
}

const ISO_NOW = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Атомарен запис: проверка → нов `revision` → временен файл → преименуване.
 * `expectHash` пази от запис върху чужда промяна (моделът „чекпойнт“ на панела).
 *
 * Подаденият обект може да е частичен (панелът праща само смененото): записът слива
 * подразбиранията, ТЕКУЩИЯ файл и промяната — и винаги пише ПЛОСКИЯ вид.
 */
function write(absPath, data, options) {
  const opts = options || {};
  const current = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
  // Ревизията е на ДИСКА, не на подадения обект: файл, който още го няма, става ревизия 1, а
  // всеки следващ запис е „предишната + 1“. Иначе панел, който прати старо копие, би върнал
  // брояча назад и чекпойнтът би загубил смисъл.
  const previous = current ? Number.parseInt(String(parse(current).data.revision), 10) || 0 : 0;
  const onDisk = current ? migrate(parse(current).data) : {};
  const incoming = migrate(data || {});
  const merged = { ...structuredClone(DEFAULTS), ...onDisk, ...incoming };
  // Ключът и името идват от портала само когато файлът още го няма — те не са „опция по избор“.
  // При съществуващ файл празна стойност остава празна и проверката ще я откаже: тихото
  // допълване би скрило точно това, което човек е изтрил.
  if (!current) {
    if (!merged.slug) merged.slug = opts.slug || '';
    if (!merged.name) merged.name = opts.title || merged.slug;
  }
  // Идентичността не се губи и не се преиздава: издава се веднъж, от ключа и името.
  const id = typeof merged.id === 'string' && merged.id ? merged.id : makeId(merged.slug, merged.name, opts.number || 1);
  const next = { version: 1, revision: previous + 1, updated_at: ISO_NOW(), id };
  for (const key of OPTION_KEYS) next[key] = merged[key];
  next.off = Array.isArray(merged.off) ? merged.off : [];
  next.folders = isPlainObject(merged.folders) ? merged.folders : {};
  next.files = Array.isArray(merged.files) ? merged.files : [];
  const issues = validate(next, opts);
  if (issues.length) {
    const err = new Error('PORTAL_CONFIG_INVALID: описанието не минава проверката (' + issues.length + ')');
    err.code = 'PORTAL_CONFIG_INVALID';
    err.issues = issues;
    throw err;
  }
  if (opts.expectHash) {
    const currentHash = typeof opts.digest === 'function' ? opts.digest(current) : null;
    if (currentHash !== opts.expectHash) {
      const err = new Error('PORTAL_CONFIG_CONFLICT: файлът е променен между четенето и записа');
      err.code = 'PORTAL_CONFIG_CONFLICT';
      err.currentHash = currentHash;
      err.diff = diff(migrate(parse(current).data), next);
      throw err;
    }
  }
  const text = emit(next);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = absPath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, absPath);
  return { text, hash: typeof opts.digest === 'function' ? opts.digest(text) : null, revision: next.revision };
}

/** Начален файл за нов портал: пълните подразбирания, за да се вижда всичко на едно място. */
function initial(options) {
  const opts = options || {};
  const slug = opts.slug || 'portal';
  const name = String(opts.title || opts.name || slug).trim().slice(0, TEXT_LIMITS.name) || slug;
  return {
    version: 1,
    revision: 1,
    updated_at: ISO_NOW(),
    id: opts.id || makeId(slug, name, opts.number || 1),
    ...structuredClone(DEFAULTS),
    slug,
    name,
    off: [],
    folders: {},
    files: [],
  };
}

module.exports = {
  DEFAULTS,
  OPTION_KEYS,
  ENUMS,
  RULES,
  FILE_KEYS,
  RESERVED,
  MAX_BYTES,
  MAX_FILES,
  machineName,
  makeId,
  nextNumber,
  isOff,
  migrate,
  isGrouped,
  parse,
  emit,
  validate,
  effective,
  verify,
  diff,
  read,
  write,
  initial,
};
