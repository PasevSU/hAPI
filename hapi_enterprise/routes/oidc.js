'use strict';
// OIDC вход — компонент на HTTP слоя.
//
//   GET /api/v1/auth/oidc/login     — пренасочва към доставчика (Pocket ID, Keycloak, …)
//   GET /api/v1/auth/oidc/callback  — код → токен → проверка → сесия на hAPI
//
// Правила:
//   • изключено без конфигурация → 404, а не „почти работи“;
//   • `state` се харчи веднъж и само на сървъра (без него callback-ът е CSRF врата);
//   • identity-то се взема от ПРОВЕРЕНИЯ ID token, не от query параметри;
//   • ролята идва от групите (`HAPI_OIDC_ADMIN_GROUP`), а групите извън разрешените → 403;
//   • сесията е обикновена hAPI сесия + HttpOnly бисквитка `hapi_sso` (без токен в адреса).
function create(deps) {
  const { json, fail, audit, oidc, metadataStore, keyDigest, newSessionToken, cookieSecure, baseUrl } = deps;
  const discovery = oidc.createDiscovery();
  const jwks = oidc.createJwks();
  const flows = oidc.createFlows();

  const cfg = () => oidc.config(process.env);

  /** Сесия + бисквитка. Токенът НЕ влиза в адреса (иначе остава в историята и в логовете). */
  function issueSession(req, res, user, scopes) {
    const token = newSessionToken();
    metadataStore.createSession(keyDigest(token), user, null);
    res.setHeader('Set-Cookie', oidc.sessionCookie(req, token, cookieSecure(req)));
    return { token, username: user, scopes };
  }

  async function handle({ req, res, url, method }) {
    if (method !== 'GET') return false;
    const path = url.pathname;
    if (path !== '/api/v1/auth/oidc/login' && path !== '/api/v1/auth/oidc/callback') return false;
    const config = cfg();
    if (!config.enabled) { fail(res, 404, 'OIDC is not configured'); return true }

    if (path === '/api/v1/auth/oidc/login') {
      const meta = await discovery(config.issuer).catch((e) => { void e; return null });
      if (!meta) { fail(res, 502, 'OIDC discovery failed'); return true }
      const flow = flows.start(config);
      const target = new URL(meta.authorization_endpoint);
      target.searchParams.set('response_type', 'code');
      target.searchParams.set('client_id', config.clientId);
      target.searchParams.set('redirect_uri', flow.redirectUrl);
      target.searchParams.set('scope', config.scopes.join(' '));
      target.searchParams.set('state', flow.state);
      target.searchParams.set('nonce', flow.nonce);
      target.searchParams.set('code_challenge', flow.challenge);
      target.searchParams.set('code_challenge_method', 'S256');
      void audit('auth.oidc.start', { issuer: config.issuer });
      res.writeHead(302, { Location: target.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end();
      return true;
    }

    // ── callback ───────────────────────────────────────────────────────────
    const error = url.searchParams.get('error');
    if (error) {
      void audit('auth.oidc.denied', { reason: error, detail: url.searchParams.get('error_description') || '' });
      fail(res, 401, 'OIDC login was refused by the provider');
      return true;
    }
    const flow = flows.take(url.searchParams.get('state'));
    if (!flow) { void audit('auth.oidc.denied', { reason: 'state' }); fail(res, 400, 'Unknown or expired login state'); return true }
    const code = url.searchParams.get('code') || '';
    if (!code) { fail(res, 400, 'Authorization code is missing'); return true }

    let claims;
    try {
      const meta = await discovery(config.issuer);
      const form = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: flow.redirectUrl,
        client_id: config.clientId,
        code_verifier: flow.verifier,
      });
      if (config.clientSecret) form.set('client_secret', config.clientSecret);
      const res2 = await fetch(meta.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: form.toString(),
      });
      if (!res2.ok) throw Object.assign(new Error('Token exchange failed'), { status: 401, code: 'OIDC_TOKEN_ENDPOINT' });
      const tokens = await res2.json();
      if (!tokens || !tokens.id_token) throw Object.assign(new Error('No ID token'), { status: 401, code: 'OIDC_TOKEN' });
      let keys = await jwks(meta.jwks_uri);
      try {
        claims = oidc.verifyIdToken(tokens.id_token, { keys, issuer: config.issuer, audience: config.clientId, nonce: flow.nonce });
      } catch (e) {
        // Ротация на ключ: презареждаме ВЕДНЪЖ и пробваме пак. Всяка друга грешка остава.
        if (e.code !== 'OIDC_TOKEN_KID') throw e;
        keys = await jwks(meta.jwks_uri, { force: true });
        claims = oidc.verifyIdToken(tokens.id_token, { keys, issuer: config.issuer, audience: config.clientId, nonce: flow.nonce });
      }
    } catch (e) {
      void audit('auth.oidc.failed', { reason: e.code || 'error' });
      fail(res, e.status || 401, e.message || 'OIDC login failed');
      return true;
    }

    const username = String(claims.preferred_username || claims.email || claims.sub || '').trim().toLowerCase().slice(0, 64);
    if (!/^[a-z0-9_.@-]{1,64}$/.test(username)) { fail(res, 400, 'The provider did not return a usable username'); return true }
    const groups = oidc.groupsOf(config, claims);
    const role = oidc.roleFor(config, groups);
    if (!role) {
      void audit('auth.oidc.denied', { username, reason: 'groups', groups: groups.length });
      fail(res, 403, 'This account is not allowed to sign in here');
      return true;
    }
    const scopes = role === 'admin' ? ['admin', 'read', 'download'] : ['read', 'download'];

    const existing = metadataStore.getUser(username);
    if (existing && existing.active === false) {
      void audit('auth.oidc.denied', { username, reason: 'inactive' });
      fail(res, 403, 'This account is disabled');
      return true;
    }
    if (!existing) {
      if (!config.autoProvision) {
        void audit('auth.oidc.denied', { username, reason: 'not-provisioned' });
        fail(res, 403, 'No local account for ' + username + ' (set HAPI_OIDC_AUTO_PROVISION=1 to create one)');
        return true;
      }
      // Паролата е случайна и неизползваема: входът е само през доставчика.
      const unusable = 'oidc:' + require('node:crypto').randomBytes(24).toString('base64url');
      metadataStore.createUser(username, unusable, scopes);
    } else if (role === 'admin' && !(existing.scopes || []).includes('admin')) {
      metadataStore.updateUser(username, { scopes });
    }

    const session = issueSession(req, res, username, scopes);
    void audit('auth.oidc.login', { username, role, groups: groups.length, issuer: config.issuer });
    if (url.searchParams.get('format') === 'json') {
      return json(res, 200, { token: session.token, username, scopes, role, cookie: 'hapi_sso', base: baseUrl(req) });
    }
    res.writeHead(302, { Location: '/ui/?sso=1', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end();
    return true;
  }

  return { handle, config: cfg };
}

module.exports = { create };
