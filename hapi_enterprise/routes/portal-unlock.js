'use strict';
// ОТКЛЮЧВАНЕ НА ЗАКЛЮЧЕН ПОРТАЛ С ПАРОЛА (0.69.210) — HTTP слоят.
//
//   POST /api/v1/p/<slug>/unlock   { password }  →  { query, expires }
//
// Защо съществува: до 0.69.210 един портал беше или публичен, или „само с ключ/токен“ —
// тоест човек без издаден ключ не можеше да влезе, а издателят не можеше да даде проста
// парола. Сега заключеният портал иска парола и връща ПОДПИСАН достъп за същия портал
// (`?expires=…&sig=…`), който страницата носи в следващите си заявки. Това преизползва
// съществуващия договор за подписан достъп вместо да въвежда втори начин за достъп.
//
// Граници:
//   • паролата НЕ влиза в адрес, лог или одит — само в тялото на POST и само за сверка;
//   • паролата се пази като `scrypt$<salt>$<hash>` (`portal-term.js`), не в чист вид;
//   • опитите се броят по портал (10/минута) — иначе 8-знакова парола се подбира за минути;
//   • изтекъл портал НЕ се отключва (410), защото срокът е по-силно решение от паролата.
function create(deps) {
  const { json, fail, parse, audit, resolvePortal, portalTerm, portalAccess, fallbackSecret } = deps;

  const MAX_ATTEMPTS = 10;
  const WINDOW_MS = 60 * 1000;
  const attempts = new Map(); // portalId → { count, resetAt }

  function tooMany(portalId, now) {
    const entry = attempts.get(portalId);
    if (!entry || entry.resetAt <= now) {
      attempts.set(portalId, { count: 1, resetAt: now + WINDOW_MS });
      return false;
    }
    entry.count += 1;
    return entry.count > MAX_ATTEMPTS;
  }

  function forget(portalId) {
    attempts.delete(portalId);
  }

  async function handle({ req, res, parts, method }) {
    if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'p' || !parts[3] || parts[4] !== 'unlock' || parts.length !== 5) return false;
    if (method !== 'POST') {
      fail(res, 405, 'Method not allowed');
      return true;
    }
    const portal = resolvePortal(parts[3]);
    if (!portal) {
      fail(res, 404, 'Not found');
      return true;
    }
    if (!portalTerm.active(portal)) {
      void audit('portal.unlock.denied', { portalId: portal.id, reason: 'expired' });
      fail(res, 410, 'Portal expired');
      return true;
    }
    if (portal.access !== 'locked') {
      fail(res, 400, 'Portal is not locked');
      return true;
    }
    const now = Date.now();
    if (tooMany(portal.id, now)) {
      void audit('portal.unlock.denied', { portalId: portal.id, reason: 'rate-limited' });
      fail(res, 429, 'Too many attempts');
      return true;
    }
    let body;
    try {
      body = await parse(req);
    } catch {
      fail(res, 400, 'Invalid JSON');
      return true;
    }
    const password = body && typeof body.password === 'string' ? body.password : '';
    if (!portalTerm.verifyPassword(password, portal.passwordHash)) {
      void audit('portal.unlock.denied', { portalId: portal.id, reason: 'wrong-password' });
      fail(res, 401, 'Invalid password');
      return true;
    }
    forget(portal.id);
    const access = portalAccess.issue(portal.signingSecret || fallbackSecret, portal.id);
    void audit('portal.unlock.ok', { portalId: portal.id, expires: access.expires });
    return json(res, 200, { query: access.query, expires: access.expires });
  }

  return { handle, MAX_ATTEMPTS, WINDOW_MS };
}

module.exports = { create };
