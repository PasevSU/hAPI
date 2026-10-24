'use strict';
// ЕДНА политика за достъп до портал (Stage D): идентичност → портал → ресурс → действие.
//
// Защо отделен модул: досега всяка врата (`/p/<id>`, `/portal.html?folder=`, `/site/…`,
// `/api/v1/p/…`) имаше своя проверка и нов маршрут лесно оставаше без нея. Тук решението
// е едно и се вика отвсякъде; `via` казва КОЙ механизъм е пуснал заявката, за да може
// отказът да се обясни и да влезе в сензорите, без да изтича тайна.
//
// Механизмите са нарочно разделени, защото обхватът им е различен:
//   • администратор          — Ingress + RBAC (не минава оттук);
//   • потребителска сесия    — акаунт със скоупи + ACL (кои портали вижда);
//   • публичен токен         — ЕДИН портал, издава се от админа (`portal_tokens`);
//   • публична сесия         — краткотрайна бисквитка от `/t/<token>`, пак един портал;
//   • подписан адрес         — конкретен ресурс + срок (HMAC), за файл или цял портал;
//   • публичен портал        — четене без идентичност, само ако порталът е `public` и
//                              add-on-ът НЕ изисква токен.
//
// Токенът за портал НЕ се блокира от `require_portal_token`: той е точно това, което
// опцията иска. Блокират се само анонимният достъп и подписът за цял портал — същата
// логика като при подписаните файлови адреси.
const crypto = require('node:crypto');

const COOKIE_SECURE = '__Host-hapi_session';
const COOKIE_PLAIN = 'hapi_session';

function parseCookies(header) {
  const out = Object.create(null);
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[name] = part.slice(i + 1).trim();
    }
  }
  return out;
}

/** HTTPS ли е това, което вижда БРАУЗЪРЪТ? Решава се от прокси заглавките, не от порта. */
function isSecureRequest(req) {
  if (!req) return false;
  if (req.socket && req.socket.encrypted) return true;
  const proto = String((req.headers && req.headers['x-forwarded-proto']) || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

/** Сесийната бисквитка от заявката: `__Host-` името пръв, после обикновеното. */
function readSessionToken(req) {
  const cookies = parseCookies(req && req.headers ? req.headers.cookie : '');
  return cookies[COOKIE_SECURE] || cookies[COOKIE_PLAIN] || '';
}

/**
 * Бисквитка за публична сесия.
 * По HTTPS ползваме `__Host-` префикса: той изисква `Secure`, `Path=/` и забранява
 * `Domain`, тоест поддомейн не може да я подмени. По HTTP (LAN достъп) `Secure` би я
 * направил неизпращана, затова там името е обикновено — състоянието се вижда в `name`.
 */
function sessionCookie(req, token, maxAgeSeconds) {
  const secure = isSecureRequest(req);
  const name = secure ? COOKIE_SECURE : COOKIE_PLAIN;
  const parts = [`${name}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}`];
  if (secure) parts.push('Secure');
  return { name, secure, header: parts.join('; ') };
}

/** Изчистване на бисквитката (при изход или при невалидна сесия). */
function clearCookie(req) {
  const secure = isSecureRequest(req);
  const name = secure ? COOKIE_SECURE : COOKIE_PLAIN;
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return { name, secure, header: parts.join('; ') };
}

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function create({ store, signedPortal, sessionTtlSeconds = 600, requireToken = false, onDeny = null }) {
  // Броячи за сензорите: само числа, без токени, IP адреси или имена на портали.
  const denied = { tokenUnknown: 0, tokenExpired: 0, revokedRefused: 0, crossPortal: 0, scopeDenied: 0, sessionInvalid: 0 };
  /** Отказът влиза в одита с ПРИЧИНА и портал — без токен, без бисквитка, без IP. */
  const noteDenial = (reason, portal) => {
    if (typeof onDeny !== 'function') return;
    try {
      onDeny({ reason, portalId: portal && portal.id ? portal.id : '', action: 'read' });
    } catch {
      /* одитът не бива да чупи отказа */
    }
  };

  /** Празен ACL значи „всички портали“ — така старите акаунти продължават да работят. */
  function userMayPortal(username, portalId) {
    const allowed = store.getUserPortals(username) || [];
    return allowed.length === 0 || allowed.includes(portalId);
  }

  /**
   * Решението за една заявка.
   * `action` е `read` или `download`; `file` се подава само когато решението е за файл.
   */
  function decide({ req, url, portal, action = 'read', token = '' }) {
    const deny = (reason) => ({ allowed: false, via: '', reason });
    const refusal = (reason) => {
      noteDenial(reason, portal);
      return deny(reason);
    };
    // 1. Публичен портал: достъп без идентичност, но само когато add-on-ът не иска токен.
    //    Действието (изтегляне/ключ на файл) се решава после от самия файл — тук се пуска
    //    САМО порталът, не конкретен ресурс.
    if (portal.visibility === 'public' && !requireToken) return { allowed: true, via: 'public', reason: '' };
    // 2. Публична сесия (бисквитка от `/t/<token>`): един портал, скоупи от токена.
    const raw = readSessionToken(req);
    if (raw) {
      const session = store.getPortalSession(digest(raw));
      if (!session) denied.sessionInvalid += 1;
      else if (session.portalId !== portal.id) { denied.crossPortal += 1; return refusal('cross_portal') }
      else if (!session.scopes.includes(action)) { denied.scopeDenied += 1; return refusal('scope') }
      else return { allowed: true, via: 'portal-session', identity: session, reason: '' };
    }
    // 3. Потребителска сесия (Bearer или `portal_token`): скоупи + ACL по портали.
    const bearer = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '').trim();
    const userToken = bearer || (url && url.searchParams.get('portal_token')) || token || '';
    if (userToken) {
      const session = store.getSession(digest(userToken));
      if (session) {
        if (!session.scopes.includes(action)) { denied.scopeDenied += 1; return refusal('scope') }
        if (!userMayPortal(session.username, portal.id)) { denied.crossPortal += 1; return refusal('cross_portal') }
        return { allowed: true, via: 'user-session', identity: session, reason: '' };
      }
    }
    // 4. Подписан достъп за целия портал (собственикът го издава от панела).
    if (!requireToken && action === 'read' && typeof signedPortal === 'function' && signedPortal(url, portal)) {
      return { allowed: true, via: 'signed-portal', reason: '' };
    }
    return refusal('no-identity');
  }

  /** Еднакъв отказ за всички случаи: 404 без обяснение навън, причината — в сензорите. */
  function snapshot() {
    return {
      requireToken,
      sessionTtlSeconds,
      cookie: { secure: COOKIE_SECURE, plain: COOKIE_PLAIN },
      denied: { ...denied },
      activePortalSessions: store.purgeExpiredPortalAccess ? store.purgeExpiredPortalAccess().sessions : 0,
    };
  }

  return { decide, snapshot, userMayPortal, denied, sessionTtlSeconds, isSecureRequest, readSessionToken, sessionCookie, clearCookie, digest };
}

module.exports = { create, isSecureRequest, readSessionToken, sessionCookie, clearCookie, COOKIE_SECURE, COOKIE_PLAIN };
