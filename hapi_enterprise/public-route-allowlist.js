'use strict';
// Allowlist за ПУБЛИЧНИЯ Gateway listener (`PUBLIC_GATEWAY_PORT`, в add-on-а 8088).
//
// Защо: този listener е отворен към интернет, а досега блокираше само три групи пътища
// (`/admin`, `/ui`, `/generator`). Всичко останало — включително административни API-та,
// които се добавят в бъдеще — минаваше, стига да не започва с тези три думи. Тук е
// обратното: разрешено е САМО изброеното, а всичко друго получава 404 (не 403 — не се
// издава и че пътят съществува).
//
// Правилото е ЕДНО и се проверява от `tests/public-route-allowlist.cjs`: нов публичен
// маршрут се добавя тук, заедно с тест. Ако маршрутът не е в списъка, той не съществува
// за външния свят, дори да работи на Ingress listener-а.
//
// Методите са част от правилото: `GET /api/v1/p/<id>/package` не е същото като
// `POST …/package` (вторият строи ZIP). `HEAD` се приема навсякъде, където има `GET`.
const GET = 'GET', POST = 'POST';

const RULES = [
  // ── Публични страници и техните ресурси ───────────────────────────────────
  { method: GET, re: /^\/$/, why: 'информационната страница с връзка към публичното API' },
  { method: GET, re: /^\/p\/[^/]+\/?$/, why: 'страницата на портала (там води QR кодът)' },
  { method: GET, re: /^\/portal\.html$/, why: 'страницата на портала за конкретна папка' },
  { method: GET, re: /^\/portal\.html:[A-Za-z0-9_-]{1,90}(\/[^\\]*)?$/, why: 'същата страница във вида `/portal.html:<папка>` (донорски формат, без прокси)' },
  { method: GET, re: /^\/portal\.js$/, why: 'скриптът на страницата' },
  { method: GET, re: /^\/portal\.css$/, why: 'стиловете на страницата' },
  { method: GET, re: /^\/portal-i18n\.js$/, why: 'речникът BG/EN/DE' },
  { method: GET, re: /^\/secret\/?$/, why: 'страницата на тайна връзка (ключът е само във фрагмента)' },
  { method: GET, re: /^\/secret-view\.js$/, why: 'декриптирането на тайната в браузъра' },
  { method: GET, re: /^\/qr\/[A-Za-z0-9_-]{1,64}$/, why: 'публичната страница на регистриран QR артефакт' },
  { method: GET, re: /^\/s\/[A-Za-z0-9_-]{1,64}$/, why: '„Бърз линк“ към един файл' },
  { method: GET, re: /^\/site\/[^/]+\/[^/]+\/?[\s\S]*$/, why: 'регистриран HTML проект на портала' },
  // Вход по публичен токен за ЕДИН портал: издава краткотрайна бисквитка и пренасочва.
  // Токенът се проверява в базата (изтекъл/отнет → 404), затова пътят е публичен, а
  // достъпът — не.
  { method: GET, re: /^\/t\/[A-Za-z0-9_-]{20,120}$/, why: 'вход по токен за конкретен портал' },
  // OIDC входът (Pocket ID и др.): и двата пътя са публични по необходимост — те СА входът.
  // Правата се решават СЛЕД проверения ID token, не от адреса.
  { method: GET, re: /^\/api\/v1\/auth\/oidc\/login$/, why: 'начало на OIDC входа (пренасочва към доставчика)' },
  { method: GET, re: /^\/api\/v1\/auth\/oidc\/callback$/, why: 'връщане от OIDC доставчика' },

  // ── Публичното API на порталите ───────────────────────────────────────────
  // `…/files/<id>/download`, `/manifest`, `/openapi.json`, `/qr.svg`, `/tree`, `/storage`
  // и `…/package/<token>` минават оттук; достъпът пак се решава от портала (токен,
  // подпис, ключ на файл, видимост).
  { method: GET, re: /^\/api\/v1\/p\/[^/]+(\/[\s\S]*)?$/, why: 'публичното API на портала' },
  { method: POST, re: /^\/api\/v1\/p\/[^/]+\/package$/, why: 'поискване на ZIP пакет от страницата' },
  { method: POST, re: /^\/api\/v1\/p\/[^/]+\/files\/[^/]+\/rating$/, why: 'оценка на файл от посетител' },
  { method: GET, re: /^\/api\/v1\/portals$/, why: 'каталогът на публичните портали' },

  // ── „Бърз линк“ (Send-lite) ───────────────────────────────────────────────
  { method: POST, re: /^\/api\/v1\/sends\/[A-Za-z0-9_-]{1,64}\/access$/, why: 'парола/достъп до „Бърз линк“' },
  { method: GET, re: /^\/api\/v1\/sends\/[A-Za-z0-9_-]{1,64}\/file$/, why: 'еднократното сваляне по билет' },

  // ── Тайни връзки: проба и разкриване ──────────────────────────────────────
  { method: GET, re: /^\/api\/v2\/secrets\/[a-f0-9]{64}$/, why: 'проба колко прегледа остават (без да ги харчи)' },
  { method: POST, re: /^\/api\/v2\/secrets\/[a-f0-9]{64}\/reveal$/, why: 'разкриване на тайната (ключът остава в браузъра)' },

  // ── Вход/изход: нужни са, за да отвори получател частен портал ────────────
  // Без тях `require_portal_token` правеше порталите недостъпни за всички, а входът е
  // ограничен по акаунт и по peer (вж. `loginFailures` в server.js).
  { method: POST, re: /^\/api\/v1\/auth\/login$/, why: 'вход на потребител (дава сесия за портал)' },
  { method: POST, re: /^\/api\/v1\/auth\/logout$/, why: 'изход' },
  { method: GET, re: /^\/api\/v1\/auth\/me$/, why: 'коя сесия е предявена' },

  // ── Public API Gateway (PG-6): отделен канал, собствена токен схема ───────
  { method: GET, re: /^\/api\/public\/v1\/portals\/[^/]+\/?$/, why: 'изгледът на портала в публичния gateway' },
  { method: GET, re: /^\/api\/public\/v1\/portals\/[^/]+\/files$/, why: 'файловете в публичния gateway' },
  { method: GET, re: /^\/api\/public\/v1\/files\/[^/]+\/access$/, why: 'решение за достъп до файл' },
  { method: GET, re: /^\/api\/public\/v1\/files\/[^/]+\/download$/, why: 'сваляне през публичния gateway' },
];

/** `HEAD` върви с `GET`: мониторинг и браузъри го пращат вместо него. */
const methodOf = (method) => {
  const m = String(method || '').toUpperCase();
  return m === 'HEAD' ? GET : m;
};

/** Нормализира пътя: без завършващи наклони, без празни сегменти, без `%00`. */
function normalize(pathname) {
  const raw = String(pathname == null ? '' : pathname);
  if (!raw.startsWith('/') || raw.includes('\0')) return null;
  // `..` и `.` се свиват от сървъра при маршрутирането; тук не им се позволява да
  // „избягат“ от публичния списък (напр. `/api/v1/p/x/../../admin`).
  const parts = [];
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (!parts.length) return null; parts.pop(); continue; }
    let decoded;
    try { decoded = decodeURIComponent(segment) } catch { return null }
    if (decoded === '.' || decoded === '..' || decoded.includes('\0') || decoded.includes('/')) return null;
    parts.push(decoded);
  }
  return '/' + parts.join('/');
}

/** Разрешена ли е заявка от ПУБЛИЧНИЯ listener? `{ ok, why }`. */
function check(pathname, method) {
  const path = normalize(pathname);
  if (path === null) return { ok: false, why: 'невалиден път' };
  const m = methodOf(method);
  for (const rule of RULES) {
    if (rule.method === m && rule.re.test(path)) return { ok: true, why: rule.why, path };
  }
  return { ok: false, why: 'не е в списъка на публичните маршрути', path };
}

const allow = (pathname, method) => check(pathname, method).ok;

module.exports = { allow, check, normalize, RULES };
