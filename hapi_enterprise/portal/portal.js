"use strict";
// Публична страница на портала — това, което се отваря при сканиране на QR кода.
//
// Работи само с четящото публично API (/api/v1/p/<slug>): заглавие, описание, контакт,
// файлове с размер/дата/версия/SHA-256 и правила за достъп. Никакви външни ресурси —
// страницата се отваря и на телефон без интернет до add-on-а (само до него).
// Сигурност: всички стойности се вмъкват с textContent (без innerHTML), за да не може
// име на файл или описание да инжектира HTML/скрипт.

const $ = (id) => document.getElementById(id);
// ── Език на страницата (PP-14) ───────────────────────────────────────────────
// Речникът е в `portal-i18n.js`. Езикът идва от адреса (`?lang=en`), после от
// запазения избор на посетителя, иначе български. Всички текстове минават оттук —
// никой низ не се сглобява на ръка в кода, за да не се чупи преводът.
const I18N = globalThis.HapiPortalI18n || null;
const LANG_KEY = "hapi.portalLang";
function resolveLang() {
  const fromUrl = new URL(location.href).searchParams.get("lang");
  if (I18N && I18N.isLang(fromUrl)) return I18N.pick(fromUrl);
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (I18N && I18N.isLang(saved)) return I18N.pick(saved);
  } catch {
    // Няма хранилище (частен режим) — остава езикът от адреса или подразбирането.
  }
  const html = document.documentElement && document.documentElement.getAttribute("lang");
  return I18N ? I18N.pick(html) : "bg";
}
let LANG = resolveLang();
/** Текст по ключ (с `{заместители}`). Без речник остава българският от речника. */
const T = (key, vars) => (I18N ? I18N.t(LANG, key, vars) : key);
/** Съществително за вид артефакт в текущия език. */
const nounOf = (kind) => (I18N ? I18N.nouns(LANG)[kind] || I18N.nouns(LANG).file : { one: "файл", many: "файла", capMany: "Файлове", for: "файлове" });

/**
 * Ако речникът не е зареден (стар кеш или непълен пакет), опитваме се да го добавим,
 * вместо да покажем ключове вместо думи. Без него остават българските текстове от HTML.
 */
function ensureDictionary() {
  if (globalThis.HapiPortalI18n || typeof document === "undefined") return;
  try {
    const script = document.createElement("script");
    script.src = "/portal-i18n.js";
    script.addEventListener("load", () => {
      if (!globalThis.HapiPortalI18n) return;
      LANG = resolveLang();
      applyLanguage();
    });
    document.head.append(script);
  } catch {
    // Без речник страницата остава четима на български (текстовете са в HTML).
  }
}
ensureDictionary();
// ── Адреси (LINK_AND_STORAGE_CONTRACT.md, правила 2, 4 и 6) ──────────────────
// Страницата НЕ строи адреси: сървърът записва в `#hapi-boot` базовия адрес и пътя на
// публичното API, изчислени от hapi_enterprise/links.js. Затова всеки линк, който
// посетителят копира, е абсолютен и верен и зад прокси с префикс — докато
// `location.origin + "/p/"` даваше адрес без префикса.
const boot = (() => {
  const el = $("hapi-boot");
  const data = (el && el.dataset) || {};
  const trim = (v) =>
    String(v == null ? "" : v)
      .trim()
      .replace(/\/+$/, "");
  return { base: trim(data.base), api: trim(data.api), folder: trim(data.folder), folders: trim(data.folders) };
})();
// Част от заявката, която НЕ бива да се губи при отваряне на подпапка (подписан достъп / токен).
const keptQuery = () => {
  const src = new URL(location.href).searchParams;
  const out = new URLSearchParams();
  for (const key of ["expires", "sig", "portal_token"]) {
    const value = src.get(key);
    if (value) out.set(key, value);
  }
  return out.toString();
};
// Токен за частен портал (от линка/QR) — с него се отварят и защитените портали.
const token = new URL(location.href).searchParams.get("portal_token") || "";
const apiBase = boot.api;
/** Абсолютен адрес за копиране и споделяне: базовият адрес идва от сървъра. */
const absolute = (path) =>
  (boot.base || String(location.origin || "")) + String(path || "");
const withAuth = (path) =>
  apiBase + path + (token ? (path.includes("?") ? "&" : "?") + "portal_token=" + encodeURIComponent(token) : "");

const MAX_LISTED = 500;
let portal = null;
let allFiles = [];
// Режим „папка“ (`?folder=` в адреса или портал със собствена папка): показва
// съдържанието на папка от портала.
let folderMode = false;
let folderFiles = [];
let folderSubs = [];
// Профил на съдържанието — всички текстове на страницата се извеждат от него.
let prof = null;

const setStatus = (text, kind) => {
  const el = $("status");
  el.textContent = text || "";
  el.hidden = !text;
  el.dataset.kind = kind || "";
};

/** Кратък адрес за шифър/идентификатор, с пълната стойност в title. */
const short = (value, keep) => {
  const s = String(value || "");
  return s.length > keep ? s.slice(0, keep) + "…" : s;
};

const fmtSize = (n) => {
  const v = Number(n) || 0;
  if (v < 1024) return v + " B";
  if (v < 1048576) return (v / 1024).toFixed(1).replace(".0", "") + " KB";
  if (v < 1073741824) return (v / 1048576).toFixed(1).replace(".0", "") + " MB";
  return (v / 1073741824).toFixed(2) + " GB";
};

const fmtDate = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const p = (x) => String(x).padStart(2, "0");
  return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear();
};

/** Час:минута — за срока на еднократния линк за пакета. */
const fmtTime = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const p = (x) => String(x).padStart(2, "0");
  return p(d.getHours()) + ":" + p(d.getMinutes());
};

/** Вид на артефакта по разширение — определя как се нарича съдържанието на портала. */
const KIND_BY_EXT = {
  pdf: "doc", doc: "doc", docx: "doc", odt: "doc", rtf: "doc", txt: "doc", md: "doc",
  xls: "doc", xlsx: "doc", ods: "doc", csv: "doc", ppt: "doc", pptx: "doc", odp: "doc",
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", svg: "image",
  bmp: "image", tif: "image", tiff: "image", heic: "image", avif: "image",
  mp3: "media", wav: "media", ogg: "media", m4a: "media", mp4: "media", mov: "media",
  mkv: "media", webm: "media", avi: "media",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive",
};
const kindOf = (name) => {
  const ext = String(name || "").split(".").pop().toLowerCase();
  return KIND_BY_EXT[ext] || "file";
};

/** Съществителни за всеки вид (през речника): 1 файл / 2 файла, 1 file / 2 files. */
const nounFor = (n, noun) => (Number(n) === 1 ? noun.one : noun.many);

/**
 * Профил на съдържанието: какви артефакти има в портала и какво може да се прави с тях.
 * От него зависят всички текстове — не се показват упътвания за липсващи неща
 * (напр. „сверявай SHA-256“, когато нито един файл няма отпечатък).
 */
function buildProfile(files, data) {
  const kinds = new Map();
  let hasHash = false,
    hasKey = false,
    hasDisabled = false,
    hasTax = false,
    hasTags = false,
    hasVersion = false,
    newest = 0;
  for (const f of files) {
    const kind = kindOf(f.name);
    kinds.set(kind, (kinds.get(kind) || 0) + 1);
    if (f.sha256) hasHash = true;
    if (f.accessMode === "KEY_REQUIRED") hasKey = true;
    if (f.accessMode === "DISABLED") hasDisabled = true;
    if (f.topic || f.category || f.group) hasTax = true;
    if ((f.tags || []).length) hasTags = true;
    if (Number(f.version) > 1) hasVersion = true;
    const t = Date.parse(f.uploadedAt || "");
    if (t > newest) newest = t;
  }
  const total = files.length;
  // Един вид артефакти → назоваваме го точно; документи + снимки → двете; иначе общо „файлове“.
  let key = "file";
  if (total && kinds.size === 1) key = [...kinds.keys()][0];
  else if (total && kinds.size === 2 && kinds.has("doc") && kinds.has("image")) key = "mixed";
  return {
    total,
    key,
    noun: nounOf(key),
    kinds,
    hasHash,
    allHash: total > 0 && files.every((f) => f.sha256),
    hasKey,
    hasDisabled,
    allDisabled: total > 0 && files.every((f) => f.accessMode === "DISABLED"),
    hasTax,
    hasTags,
    hasVersion,
    newest: newest ? new Date(newest) : null,
    isPublic: Boolean(data && data.visibility === "public"),
  };
}

/** Прилага текстовете според профила на съдържанието (след като данните са заредени). */
function applyWording(p) {
  const noun = p.noun;
  const hasFiles = p.total > 0;

  $("visibility").textContent = hasFiles
    ? T("visibility.for", { what: noun.for })
    : p.isPublic
      ? T("visibility.public")
      : T("visibility.private");
  $("files-title").textContent = hasFiles ? noun.capMany : T("files.title.other");

  // Прескачането към списъка има смисъл само когато има списък.
  const skip = $("skip");
  skip.textContent = hasFiles ? T("nav.skip.files", { what: noun.for }) : T("nav.skip.content");
  skip.hidden = !hasFiles;

  // Търсенето се показва само когато има какво да се търси, а подсказката —
  // само по полетата, които наистина съществуват в тези файлове.
  $("toolbar").hidden = p.total <= 3;
  $("q").placeholder = p.hasTags
    ? T("files.search.placeholder.tags")
    : p.hasTax
      ? T("files.search.placeholder.tax")
      : T("files.search.placeholder.plain");
  $("q-label").textContent = $("q").placeholder;

  // Бележки под QR кода — само за неща, които са налични в портала.
  const notes = [];
  if (p.allHash) notes.push(T("qr.note.allHash"));
  else if (p.hasHash) notes.push(T("qr.note.someHash"));
  if (p.hasKey) notes.push(T("qr.note.hasKey"));
  if (p.allDisabled) notes.push(T("qr.note.allDisabled"));
  const note = $("qr-note");
  note.textContent = notes.join(" ");
  note.hidden = notes.length === 0;

  $("qr-hint").textContent = p.isPublic && !token ? T("qr.hint.public") : T("qr.hint.private");

  const details = [];
  if (hasFiles) details.push(p.total + " " + nounFor(p.total, noun));
  if (p.newest) details.push(T("footer.updated", { date: fmtDate(p.newest.toISOString()) }));
  details.push(T("footer.owner"));
  const strong = document.createElement("strong");
  strong.textContent = "hAPI Enterprise";
  $("foot-note").replaceChildren(
    document.createTextNode(T("footer.served")),
    strong,
    document.createTextNode(" · " + details.join(" · ") + "."),
  );
}

/** Копиране с резервен вариант за стари браузъри/несигурен контекст. */
async function copy(value, okText) {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
    else {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.className = "sr-only";
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setStatus(okText || T("copy.ok"), "ok");
  } catch {
    setStatus(T("copy.blocked"), "err");
  }
}

/** Малка икона (вграден SVG — без шрифт-икони и без мрежови заявки). */
function icon(name) {
  const paths = {
    download: '<path d="M12 3.5v11"/><path d="M7.5 10L12 14.5 16.5 10"/><path d="M4.5 20h15"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5h-9a2 2 0 0 0-2 2v9"/>',
    lock: '<rect x="4.6" y="10.6" width="14.8" height="9.4" rx="2"/><path d="M8.2 10.6V7.6a3.8 3.8 0 0 1 7.6 0v3"/>',
    file: '<path d="M6 3.4h8.2l3.8 3.8v13.4H6z"/><path d="M14 3.6v3.8h3.8"/>',
    shield: '<path d="M12 3.2l7.4 3v6.1c0 4-3 7.4-7.4 8.5-4.4-1.1-7.4-4.5-7.4-8.5V6.2z"/><path d="M8.8 12.2l2.4 2.4 4-4"/>',
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "ico");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.innerHTML = paths[name] || paths.file;
  return svg;
}

/** Един ред „етикет: стойност“ в метаданните на файла. */
function metaItem(label, value, opts) {
  const li = document.createElement("li");
  if (opts && opts.mono) li.className = "mono";
  li.textContent = label ? label + ": " + value : value;
  if (opts && opts.title) li.title = opts.title;
  return li;
}

/** Изтегляне: FREE → директно; KEY_REQUIRED → с ключ в X-File-Key. */
async function downloadFile(file, key) {
  setStatus(T("file.status.downloading", { name: file.name }));
  try {
    const headers = {};
    if (key) headers["X-File-Key"] = key;
    const url = withAuth("/files/" + encodeURIComponent(file.id) + "/download");
    const res = await fetch(url, { headers, referrerPolicy: "no-referrer" });
    if (res.status === 403) {
      setStatus(key ? T("file.status.badKey") : T("file.status.needKey"), "err");
      return;
    }
    if (!res.ok) {
      setStatus(T("file.status.http", { status: res.status }), "err");
      return;
    }
    const blob = await res.blob();
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    setStatus(T("file.status.started", { name: file.name }), "ok");
  } catch {
    setStatus(T("file.status.offline"), "err");
  }
}

/** Абсолютен адрес за изтегляне на файл (пази порталния токен, ако има такъв). */
const downloadUrlFor = (file) =>
  absolute(withAuth("/files/" + encodeURIComponent(file.id) + "/download"));

/**
 * Резюме на портала (PP-03/PP-06): какво представлява и какво съдържа —
 * брой файлове, общ обем, вид на артефактите, дата и режим на достъп.
 * Текстовете следват договора в documentation/04_FUNCTION_SPECIFICATIONS/PORTAL_PAGE_CONTRACT.md.
 */
function paintSummary(_portal) {
  const total = prof.total;
  const bytes = allFiles.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
  const kinds = [...prof.kinds.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const kindText = kinds.map(([k, n]) => n + " " + nounFor(n, nounOf(k))).join(", ");
  const accessNote = !total
    ? ""
    : prof.allDisabled
      ? T("summary.allDisabled")
      : prof.hasKey
        ? T("summary.hasKey")
        : "";

  const what = prof.isPublic ? T("access.public") : T("access.private");
  let text;
  if (!total) text = T("summary.empty", { what });
  else if (total === 1) text = T("summary.one", { what: prof.noun.one, size: fmtSize(bytes) });
  else text = T("summary.many", { n: total, what: prof.noun.many, size: fmtSize(bytes) });
  $("summary").textContent = text + (kindText ? T("summary.kinds", { kinds: kindText }) : "") + accessNote;

  const items = [
    T("summary.chip.files", { n: total }),
    T("summary.chip.bytes", { size: fmtSize(bytes) }),
  ];
  if (kindText) items.push(T("summary.chip.kinds", { kinds: kindText }));
  if (prof.newest) items.push(T("summary.chip.updated", { date: fmtDate(prof.newest.toISOString()) }));
  items.push(T("summary.chip.access", { access: prof.isPublic ? T("access.public") : T("access.private") }));
  $("summary-list").replaceChildren(
    ...items.map((value) => {
      const li = document.createElement("li");
      li.className = "chip";
      li.textContent = value;
      return li;
    }),
  );
}

/** Карта на един файл: име, метаданни, SHA-256 и действие според политиката. */
function fileCard(file) {
  const li = document.createElement("li");
  li.className = "file";
  if (file.accessMode === "DISABLED") li.classList.add("is-disabled");

  const head = document.createElement("div");
  head.className = "file-head";
  const glyph = document.createElement("span");
  glyph.className = "file-glyph";
  glyph.append(icon("file"));
  const title = document.createElement("h3");
  title.className = "file-name";
  title.textContent = file.name;
  head.append(glyph, title);
  li.append(head);

  const meta = document.createElement("ul");
  meta.className = "file-meta";
  const tax = [file.topic, file.category, file.group].filter(Boolean).join(" / ");
  if (tax) meta.append(metaItem("", tax));
  meta.append(metaItem("", fmtSize(file.size)));
  if (Number(file.version) > 1) meta.append(metaItem("v", String(file.version)));
  const date = fmtDate(file.uploadedAt);
  if (date) meta.append(metaItem("", date));
  if (file.encrypted) meta.append(metaItem("", T("file.meta.encrypted")));
  if (file.accessMode === "KEY_REQUIRED") meta.append(metaItem("", T("file.meta.key")));
  li.append(meta);

  if (file.sha256) {
    const hash = document.createElement("p");
    hash.className = "file-hash";
    hash.title = T("file.sha.title", { full: file.sha256 });
    const label = document.createElement("span");
    label.className = "mono";
    label.textContent = T("file.sha.label", { short: short(file.sha256, 16) });
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "icon-btn";
    copyBtn.title = T("file.sha.copy");
    copyBtn.setAttribute("aria-label", T("file.sha.copyFor", { name: file.name }));
    copyBtn.append(icon("copy"));
    copyBtn.addEventListener("click", () => copy(file.sha256, T("file.sha.copied")));
    hash.append(label, copyBtn);
    li.append(hash);
  }

  const actions = document.createElement("div");
  actions.className = "file-actions";
  // PP-04: адресът за изтегляне се ИЗПИСВА като текст и се копира. Забраненият файл
  // не показва адрес — адрес, който връща 403, е подвеждащ.
  if (file.accessMode !== "DISABLED") {
    const link = document.createElement("p");
    link.className = "file-link";
    const label = document.createElement("span");
    label.className = "file-link-label";
    label.textContent =
      file.accessMode === "KEY_REQUIRED" ? T("file.link.labelKey") : T("file.link.label");
    const code = document.createElement("code");
    code.className = "mono";
    code.textContent = downloadUrlFor(file);
    const copyLink = document.createElement("button");
    copyLink.type = "button";
    copyLink.className = "icon-btn";
    copyLink.title = T("file.link.copy");
    copyLink.setAttribute("aria-label", T("file.link.copyFor", { name: file.name }));
    copyLink.append(icon("copy"));
    copyLink.addEventListener("click", () => copy(downloadUrlFor(file), T("file.link.copied")));
    link.append(label, code, copyLink);
    li.append(link);
  }
  if (file.accessMode === "DISABLED") {
    const blocked = document.createElement("span");
    blocked.className = "chip chip-warn";
    blocked.textContent = T("file.disabled");
    actions.append(blocked);
  } else if (file.accessMode === "KEY_REQUIRED") {
    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "off";
    input.className = "key-input";
    input.placeholder = T("file.key.placeholder");
    input.setAttribute("aria-label", T("file.key.aria", { name: file.name }));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary";
    btn.append(icon("lock"), document.createTextNode(T("file.download.key")));
    btn.addEventListener("click", () => downloadFile(file, input.value.trim()));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") downloadFile(file, input.value.trim());
    });
    actions.append(input, btn);
  } else {
    // PP-05: истински линк с `download` — натискането стартира сваляне дори без JS.
    const a = document.createElement("a");
    a.className = "btn btn-primary";
    a.href = withAuth("/files/" + encodeURIComponent(file.id) + "/download");
    a.setAttribute("download", file.name);
    a.append(icon("download"), document.createTextNode(T("file.download")));
    actions.append(a);
  }
  li.append(actions);
  return li;
}

/**
 * PP-03: карта на файл от ПАПКАТА на портала (`?folder=` в адреса).
 * Файлът не е регистриран в портала — има само път в папката, затова изтеглянето минава
 * през един контролиран маршрут (`/tree/file?path=`), а не през отделен публичен адрес.
 */
function folderCard(file) {
  const li = document.createElement("li");
  li.className = "file";
  const head = document.createElement("div");
  head.className = "file-head";
  const glyph = document.createElement("span");
  glyph.className = "file-glyph";
  glyph.append(icon("file"));
  const title = document.createElement("h3");
  title.className = "file-name";
  title.textContent = file.name;
  head.append(glyph, title);
  li.append(head);

  const meta = document.createElement("ul");
  meta.className = "file-meta";
  meta.append(metaItem("", fmtSize(file.size)));
  const date = fmtDate(file.modifiedAt);
  if (date) meta.append(metaItem("", date));
  li.append(meta);

  const actions = document.createElement("div");
  actions.className = "file-actions";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn";
  btn.textContent = T("file.download");
  btn.addEventListener("click", () => void downloadByPath(file.path, file.name));
  actions.append(btn);
  li.append(actions);
  return li;
}

/** Изтегляне по път в папката: същият blob-подход, без изложен адрес за всеки файл. */
async function downloadByPath(filePath, name) {
  setStatus(T("file.status.downloading", { name }));
  try {
    const res = await fetch(withAuth("/tree/file?path=" + encodeURIComponent("/" + filePath)), {
      referrerPolicy: "no-referrer",
    });
    if (res.status === 404) {
      setStatus(T("file.status.missing", { name }), "err");
      return;
    }
    if (!res.ok) {
      setStatus(T("file.status.http", { status: res.status }), "err");
      return;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    setStatus(T("file.status.started", { name }), "ok");
  } catch {
    setStatus(T("file.status.offline"), "err");
  }
}

/**
 * Режим „папка“: когато адресът носи `?folder=`, страницата показва СЪДЪРЖАНИЕТО на тази
 * папка от портала (QR кодът я определя). Регистрираните файлове остават като резервен
 * вариант, ако папката не е достъпна.
 */
async function loadFolder(rel) {
  const res = await fetch(withAuth("/tree?path=" + encodeURIComponent("/" + rel)), { referrerPolicy: "no-referrer" });
  if (!res.ok) return false;
  const data = await res.json().catch(() => null);
  if (!data || !Array.isArray(data.files)) return false;
  folderMode = true;
  folderFiles = data.files.map((f) => ({ name: f.name, path: f.path, size: f.size, modifiedAt: f.modifiedAt }));
  folderSubs = Array.isArray(data.folders) ? data.folders.map((f) => ({ name: f.name, path: f.path })) : [];
  paint("");
  const head = $("files-title");
  if (head) head.textContent = rel ? T("folder.title", { path: "/" + rel }) : (portal && portal.title) || T("files.title.other");
  return true;
}

function paint(filter) {
  const q = String(filter || "").trim().toLocaleLowerCase();
  const source = folderMode ? folderFiles : allFiles;
  const list = q
    ? source.filter((f) =>
      [f.name, f.topic, f.category, f.group, (f.tags || []).join(" ")]
        .join(" ")
        .toLocaleLowerCase()
        .includes(q),
    )
    : source;
  const box = $("files");
  if (folderMode) {
    const rows = list.map(folderCard);
    // Регистриран файл, който НЕ е сложен в папката (качен през панела при изключено
    // копиране), не бива да изчезва само защото страницата е в режим „папка“: показва се
    // със собствения си адрес. Едно и също име се брои веднъж (папката е истината).
    const onDisk = new Set(folderFiles.map((f) => f.name));
    for (const file of allFiles) if (!onDisk.has(file.name)) rows.push(fileCard(file));
    if (!q) {
      for (const sub of folderSubs) {
        const li = document.createElement("li");
        li.className = "file";
        const link = document.createElement("a");
        link.className = "file-name";
        link.href =
          location.pathname +
          "?folder=" +
          encodeURIComponent(sub.path) +
          (keptQuery() ? "&" + keptQuery() : "");
        link.textContent = "📁 " + sub.name;
        li.append(link);
        rows.unshift(li);
      }
    }
    box.replaceChildren(...rows);
    $("empty").hidden = rows.length > 0;
    if (!rows.length) $("empty").textContent = T("folder.empty");
    $("count").textContent = rows.length + (rows.length === 1 ? " файл" : " файла");
    if (rows.length) setStatus("");
    return;
  }
  box.replaceChildren(...list.map(fileCard));
  $("empty").hidden = list.length > 0;
  if (!list.length) {
    // Различен текст за празен портал и за празно търсене.
    $("empty").textContent = allFiles.length
      ? T("files.empty.filtered", { what: prof.noun.for })
      : prof.isPublic
        ? T("files.empty.public")
        : T("files.empty.private");
  }
  const total = allFiles.length;
  $("count").textContent = !total
    ? ""
    : list.length === total
      ? total + " " + nounFor(total, prof.noun)
      : list.length + " " + T("files.count.of") + " " + total;
  if (list.length || !total) setStatus("");
}

/**
 * PP-12: иска пакет на целия портал и тръгва към еднократния му адрес.
 * Сървърът решава какво влиза в него (само файловете без ключ) — страницата не гадае.
 */
async function requestPackage() {
  const btn = $("package-btn");
  const note = $("package-note");
  btn.disabled = true;
  note.hidden = false;
  note.textContent = T("package.working");
  try {
    const res = await fetch(withAuth("/package"), { method: "POST", referrerPolicy: "no-referrer" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body && body.error ? body.error : T("package.error"));
    const when = fmtTime(body.download && body.download.expiresAt);
    const skipped = Array.isArray(body.excluded) ? body.excluded.length : 0;
    note.textContent =
      (when ? T("package.ready", { when }) : T("package.ready.noTime")) +
      (skipped ? T("package.skipped", { n: skipped, what: nounFor(skipped, nounOf("file")) }) : "") +
      T("package.starting");
    location.href = body.download.url;
  } catch (err) {
    note.textContent = String(err && err.message ? err.message : err);
  } finally {
    btn.disabled = false;
  }
}

function paintPortal(data) {
  const base = data.title || T("doc.title");
  // Заглавието на раздела назовава артефактите само когато има такива.
  document.title = prof && prof.total ? base + " · " + prof.noun.for : base;
  $("title").textContent = data.title || T("doc.title");
  const desc = String(data.description || data.subject || "").trim();
  $("description").textContent = desc;
  $("description").hidden = !desc;

  const badges = [];
  if (data.visibility === "public") badges.push([T("badge.public"), "chip-ok"]);
  if (data.category) badges.push([data.category, ""]);
  if (data.flag && data.flag !== "none") {
    const known = ["info", "important", "urgent", "archive"];
    const label = known.includes(data.flag) ? T("flag." + data.flag) : data.flag;
    badges.push([label, data.flag === "urgent" ? "chip-err" : "chip-warn"]);
  }
  const ul = $("badges");
  ul.replaceChildren(
    ...badges.map(([text, cls]) => {
      const li = document.createElement("li");
      li.className = ("chip " + (cls || "")).trim();
      li.textContent = text;
      return li;
    }),
  );

  const c = data.contact;
  if (c && (c.name || c.organization || c.email || c.phone)) {
    const parts = [c.name, c.organization, c.department].filter(Boolean).join(" · ");
    const el = $("contact");
    el.replaceChildren();
    if (parts) el.append(document.createTextNode(parts));
    if (c.email) {
      const a = document.createElement("a");
      a.href = "mailto:" + c.email;
      a.textContent = c.email;
      el.append(document.createTextNode(parts ? " · " : ""), a);
    }
    if (c.phone) {
      const a = document.createElement("a");
      a.href = "tel:" + c.phone.replace(/[^+0-9]/g, "");
      a.textContent = c.phone;
      el.append(document.createTextNode(c.email || parts ? " · " : ""), a);
    }
    el.hidden = false;
  }

  const urls = data.urls || {};
  const apiUrl = urls.api || apiBase;
  const manifestUrl = urls.manifest || apiBase + "/manifest";
  // PP-01: идентификаторът на портала — видим и копируем. Адресът се променя със slug-а,
  // id-то остава същият, затова то е това, което се казва по телефон/в поддръжка.
  const portalId = String(data.id || "");
  const idEl = $("portal-id");
  idEl.textContent = portalId;
  idEl.title = T("header.portalId") + ": " + portalId;
  $("copy-id").addEventListener("click", () => copy(portalId, T("header.copyId.ok")));
  $("api-link").href = apiUrl + (token ? "?portal_token=" + encodeURIComponent(token) : "");
  $("manifest-link").href = manifestUrl + (token ? "?portal_token=" + encodeURIComponent(token) : "");
  $("qr").src = (urls.qr || apiBase + "/qr.svg") + (token ? "?portal_token=" + encodeURIComponent(token) : "");
  // Адресът на страницата идва от сървъра (`urls.landing`, по id) — той е този, който се
  // копира и споделя, затова е абсолютен.
  const landingUrl = urls.landing ? absolute(urls.landing) : String(location.href).split(/[?#]/)[0];
  $("portal-url").textContent = landingUrl;
  $("copy-link").addEventListener("click", () => copy(landingUrl, T("header.copyLink.ok")));

  // PP-12: пакетът се предлага само когато има файлове без ключ и е включен в add-on-а.
  const pkg = data.package || {};
  const pkgBtn = $("package-btn");
  if (pkg.enabled && Number(pkg.eligible) > 0 && urls.package) {
    pkgBtn.hidden = false;
    pkgBtn.title = T("package.button") + " — " + pkg.eligible + " " + nounFor(pkg.eligible, prof.noun);
    pkgBtn.addEventListener("click", requestPackage);
  } else {
    pkgBtn.hidden = true;
  }
}

/**
 * PP-14: прилага езика — статичните текстове от HTML, заглавието на раздела и (ако
 * данните са дошли) целият изглед. Единственото място, през което минава смяната.
 */
function applyLanguage() {
  if (I18N) I18N.apply(document, LANG);
  else document.documentElement.setAttribute("lang", LANG);
  const select = $("lang");
  if (select) select.value = LANG;
  if (!portal || !prof) {
    document.title = T("doc.title");
    return;
  }
  prof = buildProfile(allFiles, portal);
  paintPortal(portal);
  applyWording(prof);
  paintSummary(portal);
  paint($("q") ? $("q").value : "");
}

/** Смяна на езика от посетителя: запомня се и се прилага веднага, без презареждане. */
function setLanguage(value) {
  LANG = I18N && I18N.isLang(value) ? I18N.pick(value) : "bg";
  try {
    localStorage.setItem(LANG_KEY, LANG);
  } catch {
    // Без хранилище изборът важи само за тази страница.
  }
  applyLanguage();
}

(async () => {
  try {
    applyLanguage();
    const langSelect = $("lang");
    if (langSelect) langSelect.addEventListener("change", (e) => setLanguage(e.target.value));
    if (!apiBase) throw new Error(T("error.noPortal"));
    const [portalRes, filesRes] = await Promise.all([
      fetch(withAuth(""), { referrerPolicy: "no-referrer" }),
      fetch(withAuth("/files?limit=" + MAX_LISTED), { referrerPolicy: "no-referrer" }),
    ]);
    if (!portalRes.ok) throw new Error(T("error.portal"));
    if (!filesRes.ok) throw new Error(T("error.files"));
    portal = await portalRes.json();
    const listing = await filesRes.json();
    allFiles = Array.isArray(listing.files) ? listing.files : [];
    prof = buildProfile(allFiles, portal);
    paintPortal(portal);
    applyWording(prof);
    paintSummary(portal);
    paint("");
    // Порталите с СОБСТВЕНА папка се отварят направо в нея — файловете са на диска, не в
    // регистъра. `?folder=` (от QR или от подпапка) сочи папка ВЪТРЕ в нея.
    if (boot.folders === "1" || boot.folder) await loadFolder(boot.folder);
    if (listing.hasMore) {
      const more = $("more");
      more.textContent = T("files.more", {
        shown: MAX_LISTED,
        total: listing.total,
        what: nounFor(listing.total, prof.noun),
      });
      more.hidden = false;
    }
  } catch (err) {
    setStatus(String(err && err.message ? err.message : err), "err");
    $("title").textContent = T("doc.unavailable");
  }
})();

$("q").addEventListener("input", (e) => paint(e.target.value));
