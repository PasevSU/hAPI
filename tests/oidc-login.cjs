'use strict';
// 0.69.86 — OIDC вход (authorization code + PKCE, RS256) без външни зависимости.
//
// Доставчикът е ИЗМИСЛЕН, но говори истинския протокол: откриване, /authorize с PKCE,
// /token с проверка на `code_verifier`, ID token, подписан с RSA ключ, и JWKS. Така тестът
// проверява математиката и реда на стъпките, а не „има ли бутон“.
//
// Проверява се:
//   • вход → 302 към доставчика, после callback → сесия + HttpOnly бисквитка (без токен в адрес);
//   • `/api/v1/auth/me` и `/admin/api/whoami` работят САМО с бисквитката (роля от групите);
//   • `state` се харчи веднъж (повторен callback → 400);
//   • отказ от доставчика → 401; член без админска група влиза като viewer;
//   • ID token с `alg: none` и изтекъл токен се отхвърлят (директна проверка на модула).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const { startServer } = require('./lib/gui-harness.cjs');
const oidc = require('../hapi_enterprise/oidc');

const USER = { sub: 'u-1', preferred_username: 'pasev', email: 'pasev@example.test', groups: ['hapi-admins', 'users'] };
const NOBODY = { sub: 'u-2', preferred_username: 'gost', email: 'gost@example.test', groups: ['users'] };

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)) });
});

(async () => {
  // ── 0. Ключове и „доставчик“ ─────────────────────────────────────────────
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = 'test-key-1';
  const codes = new Map();
  let whoami = USER;
  let providerError = '';

  const sign = (claims) => {
    const header = oidc.b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
    const payload = oidc.b64url(JSON.stringify(claims));
    const signature = crypto.sign('RSA-SHA256', Buffer.from(header + '.' + payload), privateKey).toString('base64url');
    return header + '.' + payload + '.' + signature;
  };

  const provider = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer,
        authorization_endpoint: issuer + '/authorize',
        token_endpoint: issuer + '/token',
        jwks_uri: issuer + '/jwks',
      });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] });
    if (url.pathname === '/authorize') {
      const redirect = url.searchParams.get('redirect_uri');
      if (providerError) {
        res.writeHead(302, { Location: redirect + '&error=' + encodeURIComponent(providerError) });
        return res.end();
      }
      // PKCE: запазваме challenge-а и го проверяваме при /token, както прави истинският сървър.
      const code = crypto.randomBytes(16).toString('hex');
      codes.set(code, { challenge: url.searchParams.get('code_challenge'), nonce: url.searchParams.get('nonce') });
      const target = new URL(redirect);
      target.searchParams.set('code', code);
      target.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { Location: target.toString() });
      return res.end();
    }
    if (url.pathname === '/token') {
      let body = '';
      req.on('data', (c) => { body += c });
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const entry = codes.get(form.get('code'));
        if (!entry) return json(400, { error: 'invalid_grant' });
        codes.delete(form.get('code'));
        const verifier = form.get('code_verifier') || '';
        if (oidc.b64url(oidc.sha256(verifier)) !== entry.challenge) return json(400, { error: 'invalid_grant', hint: 'PKCE' });
        const now = Math.floor(Date.now() / 1000);
        json(200, {
          access_token: 'at-' + crypto.randomBytes(8).toString('hex'),
          token_type: 'Bearer',
          id_token: sign({
            iss: issuer, aud: 'hapi-test', sub: whoami.sub, preferred_username: whoami.preferred_username,
            email: whoami.email, groups: whoami.groups, nonce: entry.nonce, iat: now, exp: now + 300,
          }),
        });
      });
      return;
    }
    json(404, { error: 'not found' });
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const issuer = 'http://127.0.0.1:' + provider.address().port;

  // Портът се избира ПРЕДИ старта, за да може адресът за връщане да е точен (иначе тестът
  // би проверявал подправен адрес, а не реалния поток).
  const port = await freePort();
  const redirectUrl = `http://127.0.0.1:${port}/api/v1/auth/oidc/callback?format=json`;
  const server = await startServer({
    port,
    env: {
      HAPI_OIDC_ISSUER: issuer,
      HAPI_OIDC_CLIENT_ID: 'hapi-test',
      HAPI_OIDC_REDIRECT_URL: redirectUrl,
      HAPI_OIDC_ADMIN_GROUP: 'hapi-admins',
      HAPI_OIDC_AUTO_PROVISION: '1',
    },
  });
  try {
    // ── 1. Пълният вход ────────────────────────────────────────────────────
    console.log('· вход през доставчика: login → authorize → callback → сесия');
    const start = await fetch(server.base + '/api/v1/auth/oidc/login', { redirect: 'manual' });
    assert.equal(start.status, 302, 'login пренасочва към доставчика');
    const authorize = new URL(start.headers.get('location'));
    assert.equal(authorize.origin + authorize.pathname, issuer + '/authorize');
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256', 'PKCE е S256');
    assert.ok(authorize.searchParams.get('state'), 'има state');
    assert.ok(authorize.searchParams.get('nonce'), 'има nonce');
    assert.equal(authorize.searchParams.get('redirect_uri'), redirectUrl, 'адресът за връщане е нашият');

    const toProvider = await fetch(authorize.toString(), { redirect: 'manual' });
    assert.equal(toProvider.status, 302, 'доставчикът връща към нас');
    const back = new URL(toProvider.headers.get('location'));
    assert.equal(back.searchParams.get('state'), authorize.searchParams.get('state'), 'state се връща същият');

    const done = await fetch(back.toString(), { redirect: 'manual' });
    assert.equal(done.status, 200, 'callback-ът дава сесия: ' + (await done.clone().text()).slice(0, 160));
    const session = await done.json();
    assert.equal(session.username, 'pasev');
    assert.equal(session.role, 'admin', 'групата hapi-admins дава админ');
    assert.match(session.token, /^pu_/, 'сесията е обикновен hAPI токен');
    const cookie = String(done.headers.get('set-cookie') || '');
    assert.match(cookie, /hapi_sso=/, 'бисквитката се задава');
    assert.match(cookie, /HttpOnly/, 'бисквитката е HttpOnly');
    assert.match(cookie, /SameSite=Lax/, 'и SameSite=Lax');

    // ── 2. Бисквитката е достатъчна (без токен в адреса) ────────────────────
    console.log('· сесията работи САМО с бисквитката');
    const me = await fetch(server.base + '/api/v1/auth/me', { headers: { cookie: 'hapi_sso=' + session.token } });
    assert.equal(me.status, 200, 'me отговаря по бисквитка');
    assert.equal((await me.json()).username, 'pasev');
    const who = await fetch(server.base + '/admin/api/whoami', { headers: { cookie: 'hapi_sso=' + session.token } });
    assert.equal(who.status, 200, 'админ маршрут отваря по бисквитка');
    assert.equal((await who.json()).role, 'admin', 'ролята идва от групите');

    // ── 3. Отрицателни: повторен state, отказ, член без админ група ─────────
    console.log('· повторен state, отказ от доставчика и чужда група не пускат');
    assert.equal((await fetch(back.toString(), { redirect: 'manual' })).status, 400, 'същият state не се харчи два пъти');
    providerError = 'access_denied';
    const start2 = await fetch(server.base + '/api/v1/auth/oidc/login', { redirect: 'manual' });
    const authorize2 = await fetch(start2.headers.get('location'), { redirect: 'manual' });
    const refused = await fetch(authorize2.headers.get('location'), { redirect: 'manual' });
    assert.equal(refused.status, 401, 'отказът на доставчика е 401');
    providerError = '';
    whoami = NOBODY;
    const start3 = await fetch(server.base + '/api/v1/auth/oidc/login', { redirect: 'manual' });
    const authorize3 = await fetch(start3.headers.get('location'), { redirect: 'manual' });
    const other = await fetch(authorize3.headers.get('location'), { redirect: 'manual' });
    assert.equal(other.status, 200, 'член на разрешена група влиза');
    assert.equal((await other.json()).role, 'viewer', 'без админска група ролята е само за четене');

    // ── 4. Математиката: `alg: none` и изтекъл токен се отхвърлят ───────────
    console.log('· `alg: none` и изтекъл токен не минават');
    const keys = [{ ...publicKey.export({ format: 'jwk' }), kid }];
    const noneToken = oidc.b64url(JSON.stringify({ alg: 'none' })) + '.' + oidc.b64url(JSON.stringify({ iss: issuer, aud: 'hapi-test', sub: 'x', exp: Math.floor(Date.now() / 1000) + 60 })) + '.';
    assert.throws(() => oidc.verifyIdToken(noneToken, { keys, issuer, audience: 'hapi-test' }), /RS256/, 'alg none е отказ');
    const expired = sign({ iss: issuer, aud: 'hapi-test', sub: 'x', exp: Math.floor(Date.now() / 1000) - 10 });
    assert.throws(() => oidc.verifyIdToken(expired, { keys, issuer, audience: 'hapi-test' }), /expired/, 'изтеклият токен е отказ');

    console.log('PASS oidc-login: login → authorize → callback · PKCE S256 · бисквитка вместо токен в адрес · роля от групи · state веднъж · alg none/изтекъл отказ');
  } finally {
    await server.stop().catch(() => { });
    await new Promise((resolve) => provider.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
