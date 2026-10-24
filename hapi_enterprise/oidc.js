'use strict';
// OIDC вход (authorization code + PKCE, S256) — без външни зависимости.
//
// Защо сами: hAPI няма npm зависимости по правило, а проверката на ID token е математика,
// не библиотека. Затова тук има ТОЧНО толкова крипто, колкото е нужно, и нищо повече:
//   • `state` се пази САМО на сървъра и се харчи веднъж (иначе callback-ът е CSRF врата);
//   • `nonce` се проверява срещу запазения за конкретния вход (иначе токен от друг вход);
//   • `alg` се приема САМО `RS256` — `none` и HS* са класическият обход;
//   • `iss`, `aud`, `exp` се проверяват срещу конфигурацията, не срещу самия токен;
//   • JWKS се кешира, но при непознат `kid` се презарежда веднъж (ротация на ключ).
//
// Конфигурацията е през среда (без нови опции в config.yaml), защото това е настройка на
// доставчика, не на портала: HAPI_OIDC_ISSUER, HAPI_OIDC_CLIENT_ID, HAPI_OIDC_CLIENT_SECRET,
// HAPI_OIDC_REDIRECT_URL, HAPI_OIDC_ADMIN_GROUP, HAPI_OIDC_ALLOWED_GROUPS,
// HAPI_OIDC_GROUPS_CLAIM, HAPI_OIDC_AUTO_PROVISION.
const crypto = require('node:crypto');

const CODE = 'OIDC_PKCE_RS256';
const FLOW_TTL_MS = 5 * 60 * 1000;
const MAX_FLOWS = 500;
const JWKS_TTL_MS = 60 * 60 * 1000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

/** Конфигурацията: включено е само когато има issuer, client id и адрес за връщане. */
function config(env = process.env) {
  const issuer = String(env.HAPI_OIDC_ISSUER || '').trim().replace(/\/+$/, '');
  const clientId = String(env.HAPI_OIDC_CLIENT_ID || '').trim();
  const redirectUrl = String(env.HAPI_OIDC_REDIRECT_URL || '').trim();
  const list = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    enabled: Boolean(issuer && clientId && redirectUrl),
    issuer,
    clientId,
    clientSecret: String(env.HAPI_OIDC_CLIENT_SECRET || ''),
    redirectUrl,
    scopes: String(env.HAPI_OIDC_SCOPES || 'openid profile email groups').split(/\s+/).filter(Boolean),
    groupsClaim: String(env.HAPI_OIDC_GROUPS_CLAIM || 'groups').trim() || 'groups',
    adminGroup: String(env.HAPI_OIDC_ADMIN_GROUP || '').trim(),
    allowedGroups: list(env.HAPI_OIDC_ALLOWED_GROUPS),
    autoProvision: String(env.HAPI_OIDC_AUTO_PROVISION || '') === '1',
    code: CODE,
  };
}

/** Разрешени ли са тези групи? Празен списък „разрешени“ значи „всяка удостоверена група“. */
function permitted(cfg, groups) {
  if (cfg.adminGroup && groups.includes(cfg.adminGroup)) return true;
  if (!cfg.allowedGroups.length) return true;
  return groups.some((g) => cfg.allowedGroups.includes(g));
}

/** Ролята идва от групите, не от самия потребител: админската група дава `admin`. */
function roleFor(cfg, groups) {
  if (!permitted(cfg, groups)) return null;
  return cfg.adminGroup && groups.includes(cfg.adminGroup) ? 'admin' : 'viewer';
}

/** Шаблон на бисквитката за SSO сесия — HttpOnly, за да не я чете скрипт. */
function sessionCookie(req, token, secure) {
  const base = `hapi_sso=${token}; Path=/; HttpOnly; SameSite=Lax`;
  return secure ? base + '; Secure' : base;
}

/** Стойност на бисквитка по име (без зависимости). */
function cookie(req, name) {
  const raw = String((req && req.headers && req.headers.cookie) || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    return part.slice(i + 1).trim();
  }
  return '';
}

/** Кеширано откриване на endpoint-ите (`/.well-known/openid-configuration`). */
function createDiscovery({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  const cache = new Map();
  return async function discover(issuer, { force = false } = {}) {
    const hit = cache.get(issuer);
    if (!force && hit && hit.until > now()) return hit.value;
    const res = await fetchImpl(issuer + '/.well-known/openid-configuration', { headers: { accept: 'application/json' } });
    if (!res.ok) throw Object.assign(new Error('OIDC discovery failed'), { status: 502, code: 'OIDC_DISCOVERY' });
    const body = await res.json();
    if (!body || body.issuer !== issuer || !body.authorization_endpoint || !body.token_endpoint || !body.jwks_uri) {
      throw Object.assign(new Error('OIDC discovery is inconsistent'), { status: 502, code: 'OIDC_DISCOVERY' });
    }
    cache.set(issuer, { value: body, until: now() + JWKS_TTL_MS });
    return body;
  };
}

/** Кеширани ключове; `force` се ползва само когато `kid` е непознат (ротация). */
function createJwks({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  const cache = new Map();
  return async function jwks(uri, { force = false } = {}) {
    const hit = cache.get(uri);
    if (!force && hit && hit.until > now()) return hit.value;
    const res = await fetchImpl(uri, { headers: { accept: 'application/json' } });
    if (!res.ok) throw Object.assign(new Error('OIDC keys unavailable'), { status: 502, code: 'OIDC_KEYS' });
    const body = await res.json();
    const keys = Array.isArray(body && body.keys) ? body.keys.filter((k) => k && k.kty === 'RSA' && k.n && k.e) : [];
    if (!keys.length) throw Object.assign(new Error('OIDC keys are unusable'), { status: 502, code: 'OIDC_KEYS' });
    cache.set(uri, { value: keys, until: now() + JWKS_TTL_MS });
    return keys;
  };
}

/**
 * Проверка на ID token. Приема САМО `RS256`: `none` и симетричните алгоритми са отказ,
 * защото при тях „подписът“ може да се изфабрикува от клиента.
 */
function verifyIdToken(token, { keys, issuer, audience, nonce, now = Date.now() }) {
  const bad = (code, message) => Object.assign(new Error(message || code), { status: 401, code });
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw bad('OIDC_TOKEN', 'ID token is malformed');
  const [h64, p64, s64] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(h64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(p64, 'base64url').toString('utf8'));
  } catch {
    throw bad('OIDC_TOKEN', 'ID token is not JSON');
  }
  if (header.alg !== 'RS256') throw bad('OIDC_TOKEN_ALG', 'Only RS256 is accepted');
  const key = keys.find((k) => k.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
  if (!key) throw bad('OIDC_TOKEN_KID', 'Unknown signing key');
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: { kty: 'RSA', n: key.n, e: key.e }, format: 'jwk' });
  } catch {
    throw bad('OIDC_TOKEN_KID', 'Signing key is unusable');
  }
  const ok = crypto.verify('RSA-SHA256', Buffer.from(h64 + '.' + p64), publicKey, Buffer.from(s64, 'base64url'));
  if (!ok) throw bad('OIDC_TOKEN_SIGNATURE', 'ID token signature is invalid');
  if (payload.iss !== issuer) throw bad('OIDC_TOKEN_ISS', 'Wrong issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) throw bad('OIDC_TOKEN_AUD', 'Wrong audience');
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= now) throw bad('OIDC_TOKEN_EXP', 'ID token expired');
  if (nonce && payload.nonce !== nonce) throw bad('OIDC_TOKEN_NONCE', 'Wrong nonce');
  if (!payload.sub) throw bad('OIDC_TOKEN_SUB', 'No subject');
  return payload;
}

/** Групите могат да дойдат като масив или като списък със запетаи. */
function groupsOf(cfg, claims) {
  const raw = claims ? claims[cfg.groupsClaim] : null;
  if (Array.isArray(raw)) return raw.map((g) => String(g)).filter(Boolean);
  if (typeof raw === 'string') return raw.split(/[,\s]+/).map((g) => g.trim()).filter(Boolean);
  return [];
}

/**
 * Живите входове: `state` → { verifier, nonce, redirectUrl, until }. Пази се само в паметта
 * и се харчи веднъж; това е достатъчно, защото целият вход е в рамките на 5 минути.
 */
function createFlows({ now = () => Date.now(), random = (n) => crypto.randomBytes(n) } = {}) {
  const flows = new Map();
  const prune = () => { for (const [key, flow] of flows) if (flow.until <= now()) flows.delete(key) };
  return {
    start(cfg) {
      prune();
      if (flows.size >= MAX_FLOWS) throw Object.assign(new Error('Too many pending logins'), { status: 429, code: 'OIDC_BUSY' });
      const state = b64url(random(32));
      const nonce = b64url(random(32));
      const verifier = b64url(random(32));
      flows.set(state, { verifier, nonce, redirectUrl: cfg.redirectUrl, until: now() + FLOW_TTL_MS });
      return { state, nonce, verifier, redirectUrl: cfg.redirectUrl, challenge: b64url(sha256(verifier)) };
    },
    take(state) {
      const flow = flows.get(String(state || ''));
      if (!flow) return null;
      flows.delete(String(state));
      return flow.until > now() ? flow : null;
    },
    size: () => flows.size,
  };
}

module.exports = {
  CODE, FLOW_TTL_MS, config, permitted, roleFor, sessionCookie, cookie,
  createDiscovery, createJwks, createFlows, verifyIdToken, groupsOf, b64url, sha256,
};
