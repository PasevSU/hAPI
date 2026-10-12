'use strict';
// Phase 7 — portal roles and scoped credentials (judicial class).
//
// Portal roles are a separate plane from the administrative `rbac.js` roles
// (admin/operator/viewer). A portal credential is a short-lived HMAC-signed
// token carrying a subject, a role and an optional set of case ids, so access
// can be scoped per-case rather than issued as a global token. This is the
// fallback described in §13 of the Phase 7 plan (OIDC/PKCE are the IdP
// interface this layer would sit behind); it never uses ADMIN_TOKEN.
const crypto = require('node:crypto');

const ROLES = ['judge', 'prosecutor', 'clerk', 'investigator', 'expert', 'public'];
const ACTIONS = ['read', 'verify', 'download', 'upload', 'manage', 'issue'];

// Role -> permitted actions (see plan §3 table). Investigator/expert are
// additionally scoped to their assigned case ids at authorization time.
const MATRIX = {
  judge: ['read', 'verify', 'download', 'issue'],
  prosecutor: ['upload', 'read', 'verify', 'download'],
  clerk: ['upload', 'read', 'verify', 'download', 'manage'],
  investigator: ['upload', 'read', 'verify', 'download'],
  expert: ['read', 'verify', 'download', 'upload'],
  public: []
};

function safeEqualStr(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function create({ secret, ttlSeconds = 900, now = () => Date.now() } = {}) {
  if (!secret || secret.length < 24) throw Error('Portal auth secret must be at least 24 characters');

  function can(role, action) {
    if (role === 'admin') return true;
    return (MATRIX[role] || []).includes(action);
  }

  function issue({ sub, role, caseIds = [], ttlSeconds: ttl } = {}) {
    if (!ROLES.includes(role)) throw Object.assign(new Error('Invalid role'), { status: 400 });
    if (!/^[A-Za-z0-9_.@:-]{1,120}$/.test(sub || '')) throw Object.assign(new Error('Invalid subject'), { status: 400 });
    if (!Array.isArray(caseIds) || caseIds.some(c => !/^[A-Za-z0-9_-]{1,64}$/.test(c))) throw Object.assign(new Error('Invalid caseIds'), { status: 400 });
    const ttlS = Number.isInteger(ttl) ? ttl : ttlSeconds;
    if (!Number.isInteger(ttlS) || ttlS < 1 || ttlS > 86400) throw Object.assign(new Error('Invalid ttl'), { status: 400 });
    const payload = { sub, role, caseIds: [...new Set(caseIds)], exp: Math.floor(now() / 1000) + ttlS };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    return body + '.' + sig;
  }

  function verify(token) {
    if (typeof token !== 'string') return null;
    const i = token.lastIndexOf('.');
    if (i <= 0) return null;
    const body = token.slice(0, i), sig = token.slice(i + 1);
    if (!safeEqualStr(crypto.createHmac('sha256', secret).update(body).digest('base64url'), sig)) return null;
    let payload;
    try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    if (!ROLES.includes(payload.role)) return null;
    if (!Number.isSafeInteger(payload.exp) || payload.exp < Math.floor(now() / 1000)) return null;
    return payload;
  }

  // Authorize an action for a credential, enforcing the role matrix and the
  // per-case scoping of investigator/expert roles.
  function authorized(token, action, { caseId } = {}) {
    const c = verify(token);
    if (!c) return false;
    if (!can(c.role, action)) return false;
    if (c.role === 'investigator' || c.role === 'expert') {
      if (caseId && c.caseIds.length && !c.caseIds.includes(caseId)) return false;
    }
    return true;
  }

  return { can, issue, verify, authorized, ROLES, MATRIX };
}

module.exports = { create, ROLES, ACTIONS, MATRIX };
