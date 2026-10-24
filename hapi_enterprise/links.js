'use strict';
// ЕДИНСТВЕНОТО място, където се строят адресите на hAPI.
//
// Защо: до 0.69.48 адресите се строеха на седем места по три различни правила —
// `server.js` (portalApiUrl/portalLandingUrl), `send.js` (`'/s/' + id`), `server.js`
// (HTML проектите: относително, веднъж с наклон в края и веднъж без), `api-spec.js`
// (`${prefix}/…`), `ui/portals.js`, `ui/secret-share.js` и `ui/files-manager.js` (всяко
// със свой „базов адрес“). Оттам идваше и усещането, че „файлът на портала е неясно къде
// се намира“: един и същ портал имаше три различни записа в зависимост от секцията.
//
// Договорът (виж `documentation/02_TO_BE_ARCHITECTURE/LINK_AND_STORAGE_CONTRACT.md`):
//   • всеки адрес е ОТНОСИТЕЛЕН път, започващ с '/', а базовият адрес се добавя САМО от
//     функция, която го приема изрично (`withBase`);
//   • пътят е `/p/<id>` за човешката страница и `/api/v1/p/<slug>` за API-то — id и slug
//     НЕ се разменят;
//   • адрес, който сочи папка (HTML проект), завършва с '/', а същият адрес без '/' е
//     само за `Location:`/`Cookie Path`; и двете идват от ЕДНА функция (`htmlProject`);
//   • нищо не се строи с `+ '/x/' +` извън този файл — това се проверява от
//     `tests/links-contract.cjs`.
//
// Модулът е чист: без `fs`, без състояние, работи и в браузър (UMD в края).
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Маха наклоните в края; `undefined` → ''. */
function trimBase(base) {
  return String(base == null ? '' : base).replace(/\/+$/, '');
}

/** `encodeURIComponent`, но устойчив на невалиден вход. */
function seg(value) {
  return encodeURIComponent(String(value == null ? '' : value));
}

/** Относителен път + базов адрес. Празен базов адрес → относителен път. */
function withBase(base, path) {
  const b = trimBase(base);
  const p = String(path || '');
  if (!p) return b;
  return b + (p.startsWith('/') ? p : '/' + p);
}

/** Пълният адрес ли е (има схема)? */
function isAbsolute(value) {
  return SCHEME.test(String(value || ''));
}

// ── Публични адреси ─────────────────────────────────────────────────────────

/**
 * Човешката страница на портала: `/p/<id>` (id, не slug — старите линкове със slug
 * остават валидни чрез `portalIdentity`).
 */
function portalLandingPath(p) {
  const key = (p && (p.id || p.slug)) || '';
  return '/p/' + seg(key);
}

/** Публичното API на портала: `/api/v1/p/<slug>` (slug, не id). */
function portalApiPath(p) {
  return '/api/v1/p/' + seg((p && p.slug) || '');
}

/** Ресурс от публичното API на портала (`manifest`, `openapi.json`, `qr.svg`, …). */
function portalApiFilePath(p, name) {
  const tail = String(name || '').replace(/^\/+/, '');
  return portalApiPath(p) + (tail ? '/' + tail : '');
}

/** Регистриран HTML проект на портала: `/site/<slug>/<projectId>/` (папка → с наклон). */
function htmlProjectPath(p, projectId) {
  return '/site/' + seg((p && p.slug) || '') + '/' + seg(projectId) + '/';
}

/** Същият път БЕЗ наклон в края — за `Location:` и `Cookie Path`. */
function htmlProjectBasePath(p, projectId) {
  return htmlProjectPath(p, projectId).replace(/\/$/, '');
}

/** Еднократна връзка за изпращане: `/s/<id>`. */
function sendPath(id) {
  return '/s/' + seg(id);
}

/** Тайна връзка: целият път и ключът живеят СЛЕД `#` и не се изпращат по мрежата. */
function secretLink({ base, path, id, key } = {}) {
  const page = String(path || '/secret');
  const fragment = String(id || '') + String(key || '');
  return withBase(base, page) + '#' + fragment;
}

// ── Административни адреси ──────────────────────────────────────────────────

/** Административен път: `/admin/api/<tail>`. */
function adminApiPath(tail) {
  const t = String(tail || '').replace(/^\/+/, '');
  return '/admin/api' + (t ? '/' + t : '');
}

/** Административен адрес с базов адрес (за панела и скриптовете). */
function adminApi(base, tail) {
  return withBase(base, adminApiPath(tail));
}

/** Панелът: `/ui/` (винаги с наклон — това е папка). */
function panelPath() {
  return '/ui/';
}

// ── Базов адрес от заявка/страница ──────────────────────────────────────────

/**
 * Базовият адрес от HTTP заявка. `public_base_url` (настройка/опция) има приоритет:
 * зад Home Assistant Ingress адресът на заявката е вътрешният на Supervisor и не се
 * отваря отвън.
 * @param {{headers?: object, publicBaseUrl?: string}} input
 */
function baseFromRequest(input = {}) {
  const configured = trimBase(input.publicBaseUrl);
  if (configured) return configured;
  const headers = input.headers || {};
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  if (!host || !/^[A-Za-z0-9.\-:[\]]{1,255}$/.test(host)) return '';
  const proto = String(headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return (proto === 'https' ? 'https' : 'http') + '://' + host;
}

/**
 * Базовият адрес от адреса на страницата (`/ui/index.html`, `/ui/`, `/admin/…` или
 * Ingress префикс). Ползва се от панела, за да строим същите адреси като сървъра.
 * @param {{protocol?: string, origin?: string, pathname?: string}} where
 */
function baseFromLocation(where = {}) {
  const protocol = String(where.protocol || '');
  if (!protocol || protocol === 'file:') return '';
  const path = String(where.pathname || '');
  const base = path
    .replace(/\/ui(\/index\.html)?\/?$/, '')
    .replace(/\/admin(\/.*)?$/, '')
    .replace(/\/p\/[^/]+\/?$/, '')
    .replace(/\/secret\/?$/, '')
    .replace(/\/+$/, '');
  return trimBase(String(where.origin || '') + base);
}

/**
 * Нормализира `folder` от адреса: относителен път без воден/заден наклон, без `..`.
 * Невалиден път → '' (тогава страницата показва портала, не папка).
 */
function portalFolderRel(value) {
  const rel = String(value == null ? '' : value)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (!rel || rel.split('/').some((part) => !part || part === '.' || part === '..')) return '';
  return rel;
}

/**
 * `?folder=<rel>` за страницата на портала: QR кодът казва КОЯ папка да се зареди.
 * Празна/невалидна стойност → празен низ (адресът остава само порталът).
 */
function portalFolderQuery(value) {
  const rel = portalFolderRel(value);
  return rel ? '?folder=' + seg(rel) : '';
}

/** `portalLandingPath` + `?folder=` — адресът, който влиза в QR кода. */
function portalLandingFolderPath(p, folder) {
  return portalLandingPath(p) + portalFolderQuery(folder);
}

/**
 * Добавя параметри към адрес, без да задвоява `?` — `joinQuery('/p/x', '?folder=a', '?expires=1')`
 * дава `/p/x?folder=a&expires=1`. Празните части се прескачат.
 */
function joinQuery(pathname, ...queries) {
  let out = String(pathname == null ? '' : pathname);
  for (const query of queries) {
    const part = String(query == null ? '' : query).replace(/^[?&]+/, '');
    if (!part) continue;
    out += (out.includes('?') ? '&' : '?') + part;
  }
  return out;
}

const LINKS = {
  trimBase,
  withBase,
  isAbsolute,
  joinQuery,
  portalLandingPath,
  portalApiPath,
  portalApiFilePath,
  portalFolderQuery,
  portalFolderRel,
  portalLandingFolderPath,
  htmlProjectPath,
  htmlProjectBasePath,
  sendPath,
  secretLink,
  adminApiPath,
  adminApi,
  panelPath,
  baseFromRequest,
  baseFromLocation,
};

if (typeof module !== 'undefined' && module.exports) module.exports = LINKS;
if (typeof globalThis !== 'undefined' && typeof window !== 'undefined') globalThis.HapiLinks = LINKS;
