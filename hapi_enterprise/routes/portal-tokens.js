'use strict';
// Публични токени за един портал (Stage D) — HTTP слоят.
//
//   GET    /t/<token>                              → бисквитка + пренасочване към портала
//   GET    /admin/api/portals/<id>/tokens          → списък (без отпечатъци)
//   POST   /admin/api/portals/<id>/tokens          → издаване (токенът се вижда ВЕДНЪЖ)
//   DELETE /admin/api/portals/<id>/tokens/<tid>    → отнемане (и на произлезлите сесии)
//
// Защо токенът се показва само веднъж: в базата стои SHA-256 отпечатък. Ако се показваше
// и после, изтекъл backup или лог би бил достатъчен, за да се влезе в портала.
//
// Договор като на останалите компоненти: `handle()` връща `true`, когато заявката е за
// този компонент (и е приключена), и `false`, когато трябва да я поеме следващият.
function create(deps) {
  const { json, fail, parse, audit, adminGate, store, policy, resolvePortal, baseUrl, portalPath, randomToken, publish } = deps;

  const MIN_TTL_SECONDS = 60;
  const MAX_TTL_SECONDS = 366 * 24 * 3600;

  function normalizeScopes(value) {
    const list = Array.isArray(value) ? value : ['read'];
    const allowed = ['read', 'download'];
    if (!list.length || list.some((s) => !allowed.includes(s))) throw Object.assign(new Error('Invalid scopes'), { status: 400 });
    return [...new Set(list)];
  }

  function normalizeTtl(value) {
    if (value === undefined || value === null || value === '') return null; // безсрочен
    const ttl = Number(value);
    if (!Number.isInteger(ttl) || ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) {
      throw Object.assign(new Error(`ttlSeconds must be ${MIN_TTL_SECONDS}..${MAX_TTL_SECONDS}`), { status: 400 });
    }
    return ttl;
  }

  /**
   * Колко пъти може да се отвори токенът. `undefined`/`null` = без лимит (както досега);
   * число ≥ 1 = точно толкова отваряния. Лимитът се пази в базата (`portal_tokens.max_uses`).
   */
  function normalizeMaxUses(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 100000) {
      throw Object.assign(new Error('maxUses must be an integer 1..100000'), { status: 400 });
    }
    return n;
  }

  /** Публичният адрес на токена — с базата на заявката, за да е валиден и зад прокси. */
  function tokenUrl(req, token) {
    const base = String(baseUrl(req) || '').replace(/\/+$/, '');
    return `${base}/t/${encodeURIComponent(token)}`;
  }

  /**
   * Отказ по адреса, който отваря БРАУЗЪР. `/t/<токен>` се цъка от човек, затова JSON тяло
   * („{"error":"Not found"}“) е задънена улица: посетителят вижда машинен текст и не знае
   * какво да прави. Затова при `Accept: text/html` се връща кратка страница, а API клиентът
   * продължава да получава problem+json — един и същ код на отказа, различно тяло.
   * Причината НЕ се разкрива: „невалиден“, „изтекъл“ и „отнет“ изглеждат еднакво, за да не
   * може по адреса да се разбере дали токенът някога е съществувал.
   */
  function refuse(req, res, status, title, message) {
    const wantsHtml = /text\/html/i.test(String((req.headers && req.headers.accept) || ''));
    if (!wantsHtml) { fail(res, status, title); return; }
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const html = '<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
      + esc(title) + '</title><link rel="stylesheet" href="/portal.css"></head><body><main><h1>' + esc(title) + '</h1><p>'
      + esc(message) + '</p></main></body></html>';
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(html);
  }

  // eslint-disable-next-line no-unused-vars -- `url` идва по договора на компонентите, тук не е нужен
  async function handle({ req, res, url, parts, method }) {
    // ── 1. Вход по токен ─────────────────────────────────────────────────────
    if (parts[0] === 't' && parts.length === 2) {
      if (method !== 'GET') { fail(res, 405, 'Method not allowed'); return true }
      let token;
      try {
        token = decodeURIComponent(parts[1]);
      } catch {
        refuse(req, res, 404, 'Връзката не е валидна', 'Провери адреса или поискай нов от този, който ти го е дал.'); return true;
      }
      if (!/^[A-Za-z0-9_-]{20,120}$/.test(token)) {
        policy.note('tokenUnknown');
        void audit('portal.token.denied', { reason: 'malformed' });
        refuse(req, res, 404, 'Връзката не е валидна', 'Провери адреса или поискай нов от този, който ти го е дал.'); return true;
      }
      const record = store.getPortalTokenByHash(policy.digest(token));
      if (!record) {
        policy.note('tokenUnknown');
        void audit('portal.token.denied', { reason: 'unknown' });
        refuse(req, res, 404, 'Връзката не е валидна', 'Провери адреса или поискай нов от този, който ти го е дал.'); return true;
      }
      if (record.revokedAt) {
        policy.note('revokedRefused');
        void audit('portal.token.denied', { reason: 'revoked', portalId: record.portalId, tokenId: record.id });
        refuse(req, res, 404, 'Връзката не е валидна', 'Достъпът по нея е спрян. Поискай нова от този, който ти я е дал.'); return true;
      }
      if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
        policy.note('tokenExpired');
        void audit('portal.token.denied', { reason: 'expired', portalId: record.portalId, tokenId: record.id });
        refuse(req, res, 404, 'Връзката не е валидна', 'Достъпът по нея е спрян. Поискай нова от този, който ти я е дал.'); return true;
      }
      const portal = resolvePortal(record.portalId);
      if (!portal) {
        // Порталите живеят в метаданните; токен към изтрит портал не отваря нищо.
        void audit('portal.token.denied', { reason: 'portal-missing', tokenId: record.id });
        fail(res, 404, 'Not found'); return true;
      }
      // Лимитът на отварянията се брои ТУК, преди сесията: изчерпан токен не бива да дава
      // достъп. Броячът се вдига с условен UPDATE, за да не минат две едновременни заявки.
      if (record.maxUses != null && !store.usePortalToken(record.id)) {
        policy.note('tokenExhausted');
        void audit('portal.token.denied', { reason: 'exhausted', portalId: portal.id, tokenId: record.id, maxUses: record.maxUses });
        refuse(req, res, 410, 'Връзката вече е използвана', 'Тази връзка беше с ограничен брой отваряния и те са изчерпани. Поискай нова.'); return true;
      }
      const session = randomToken('ps_');
      const expiresAt = new Date(Date.now() + policy.sessionTtlSeconds * 1000).toISOString();
      store.createPortalSession(policy.digest(session), { tokenId: record.id, portalId: portal.id, expiresAt });
      const cookie = policy.sessionCookie(req, session, policy.sessionTtlSeconds);
      void audit('portal.session.issue', { portalId: portal.id, tokenId: record.id, scopes: record.scopes, secure: cookie.secure });
      const target = `${String(baseUrl(req) || '').replace(/\/+$/, '')}${portalPath(portal)}`;
      res.writeHead(302, {
        Location: target,
        'Set-Cookie': cookie.header,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      res.end();
      return true;
    }

    // ── 2. Управление на токени (само администратор) ──────────────────────────
    if (parts[0] !== 'admin' || parts[1] !== 'api' || parts[2] !== 'portals' || !parts[3]) return false;
    const tail = parts.slice(4);
    if (tail[0] === 'acl' && tail.length === 1) {
      if (!['GET', 'PUT'].includes(method)) { fail(res, 405, 'Method not allowed'); return true }
      if (!adminGate(req, res, 'users', method)) return true;
      const portalAcl = resolvePortal(parts[3]);
      if (!portalAcl) { fail(res, 404, 'Portal not found'); return true }
      if (method === 'GET') return json(res, 200, { portalId: portalAcl.id, usernames: store.getPortalUsers(portalAcl.id) }), true;
      let payload;
      try {
        payload = await parse(req);
      } catch (e) {
        fail(res, e.status || 400, e.status ? e.message : 'Invalid JSON'); return true;
      }
      const usernames = payload && payload.usernames;
      if (!Array.isArray(usernames) || usernames.length > 500 || usernames.some((u) => typeof u !== 'string' || !/^[A-Za-z0-9_.@-]{1,64}$/.test(u))) {
        fail(res, 400, 'usernames must be an array of account names'); return true;
      }
      const known = new Set((store.listUsers() || []).map((u) => u.username));
      const missing = usernames.filter((u) => !known.has(u));
      if (missing.length) { fail(res, 400, 'Unknown accounts: ' + missing.join(', ')); return true }
      const saved = store.setPortalUsers(portalAcl.id, usernames);
      void audit('portal.acl.update', { portalId: portalAcl.id, accounts: saved.length });
      return json(res, 200, { portalId: portalAcl.id, usernames: saved }), true;
    }
    if (tail[0] !== 'tokens') return false;
    if (!adminGate(req, res, 'portals', method)) return true;
    const portal = resolvePortal(parts[3]);
    if (!portal) return fail(res, 404, 'Portal not found'), true;

    if (tail.length === 1 && method === 'GET') {
      return json(res, 200, { tokens: store.listPortalTokens(portal.id), cookie: policy.snapshot().cookie }), true;
    }
    if (tail.length === 1 && method === 'POST') {
      let payload;
      try {
        payload = await parse(req);
      } catch (e) {
        fail(res, e.status || 400, e.status ? e.message : 'Invalid JSON'); return true;
      }
      let scopes, ttl, maxUses;
      try {
        scopes = normalizeScopes(payload && payload.scopes);
        ttl = normalizeTtl(payload && payload.ttlSeconds);
        maxUses = normalizeMaxUses(payload && payload.maxUses);
      } catch (e) {
        fail(res, e.status || 400, e.message); return true;
      }
      const label = String((payload && payload.label) || '').slice(0, 80);
      const token = randomToken('pt_');
      const id = randomToken('tid_').slice(0, 20);
      const expiresAt = ttl ? new Date(Date.now() + ttl * 1000).toISOString() : null;
      store.createPortalToken({ id, portalId: portal.id, tokenHash: policy.digest(token), scopes, label, expiresAt, maxUses });
      void audit('portal.token.create', { portalId: portal.id, tokenId: id, scopes, expiresAt, maxUses });
      // Издаден достъп е събитие за външния получател (напр. система, която следи кой има
      // достъп до кой портал). Токенът НЕ влиза в тялото — само че достъп е създаден.
      if (typeof publish === 'function') publish('access.created', { portalId: portal.id, kind: 'portal-token', scopes: scopes.length, expiresAt });
      // Токенът се връща ТУК и повече никъде — в базата стои само отпечатъкът.
      return json(res, 201, { id, portalId: portal.id, scopes, label, expiresAt, maxUses, token, url: tokenUrl(req, token), sessionTtlSeconds: policy.sessionTtlSeconds, cookie: policy.snapshot().cookie }), true;
    }
    if (tail.length === 2 && method === 'DELETE') {
      const revoked = store.revokePortalToken(tail[1]);
      if (!revoked) return fail(res, 404, 'Token not found'), true;
      void audit('portal.token.revoke', { portalId: portal.id, tokenId: tail[1] });
      return json(res, 200, { revoked: tail[1] }), true;
    }
    return fail(res, 404, 'Not found'), true;
  }

  return { handle };
}

module.exports = { create };
