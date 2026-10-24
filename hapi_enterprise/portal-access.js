'use strict';
// Подписан достъп до ЦЕЛИЯ портал: `<адрес>?expires=<unix>&sig=<hmac>`.
//
// Защо: портал с видимост `private` (или включено `require_portal_token`) отговаря 404 на
// `/p/<id>`, `/api/v1/p/<slug>`, `/manifest` и `/qr.svg` за всеки без ключ или сесия — нарочно,
// за да не издава, че порталът съществува. Дотогава панелът показваше точно тези адреси, тоест
// адреси, които не се отварят. Сега собственикът получава линк с подпис: получателят няма нужда
// от акаунт, а връзката спира да важи след `expires` (или при смяна на ключа за подпис).
//
// Формата е СЪЩАТА като при подписания адрес за файл (`signedValid` в server.js):
// `HMAC-SHA256(secret, "<portalId>:<expires>")`, `expires` в секунди, най-много 24 часа напред.
// Затова един подпис важи за всички адреси на портала — страница, API, манифест, QR, OpenAPI.
const crypto = require('node:crypto');

/** Колко живее подписаният адрес по подразбиране (секунди). */
const TTL_SECONDS = 3600;
/** Таван на живота — същият като при подписаните файлове. */
const MAX_TTL_SECONDS = 86400;

const nowSeconds = (now) => Math.floor((Number.isFinite(now) ? now : Date.now()) / 1000);

/** Подписът за портал и момент на изтичане. `secret` е `signingSecret` на портала. */
function sign(secret, portalId, expires) {
  return crypto.createHmac('sha256', String(secret)).update(`${String(portalId)}:${expires}`).digest('hex');
}

/**
 * Готова заявка за допълване към адрес: `{ query, expires, sig }`.
 * `query` започва с `?` (или `&`, ако адресът вече има параметри — подайте `hasQuery`).
 */
function issue(secret, portalId, { ttl = TTL_SECONDS, now, hasQuery = false } = {}) {
  const span = Math.min(Math.max(Number(ttl) || TTL_SECONDS, 1), MAX_TTL_SECONDS);
  const expires = nowSeconds(now) + span;
  const sig = sign(secret, portalId, expires);
  return { query: `${hasQuery ? '&' : '?'}expires=${expires}&sig=${sig}`, expires, sig };
}

/** Валиден ли е подписът в адреса (`expires` и `sig` като параметри на заявката)? */
function valid(searchParams, secret, portalId, now) {
  if (!searchParams || !secret) return false;
  const expires = Number(searchParams.get('expires'));
  const sig = String(searchParams.get('sig') || '');
  if (!Number.isSafeInteger(expires) || !/^[a-f0-9]{64}$/.test(sig)) return false;
  const current = nowSeconds(now);
  if (expires <= current || expires > current + MAX_TTL_SECONDS) return false;
  const expected = sign(secret, portalId, expires);
  // Сравнението е с постоянно време: подписът е тайна, не име на файл.
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Пропуска ли заявката подписан достъп до целия портал?
 * `requireToken` (настройката `require_portal_token`) ИЗКЛЮЧВА подписа — както е и при
 * подписаните адреси за файл: щом собственикът е казал „само с вход“, линк не стига.
 */
function allow(requestUrl, portal, { requireToken = false, fallbackSecret } = {}) {
  if (requireToken || !portal) return false;
  return valid(requestUrl.searchParams, portal.signingSecret || fallbackSecret, portal.id);
}

module.exports = { TTL_SECONDS, MAX_TTL_SECONDS, sign, issue, valid, allow };
