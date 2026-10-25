'use strict';
// Role-based access control over the administrative API. Three roles are resolved
// from independent bearer tokens (admin, operator, viewer). Each admin route is tagged
// with a capability; a capability maps a role to full access, read-only (GET) access,
// or no access. Routes not tagged default to admin-only.
const crypto = require('node:crypto');
// Сравнение на тайни в постоянно време. Приема низ или буфер; липсваща/празна
// стойност НЕ е равна на нищо — иначе при неконфигуриран токен заявка без
// Authorization би минала.
const toCompare = (v) => (Buffer.isBuffer(v) ? v : typeof v === 'string' ? Buffer.from(v, 'utf8') : null);
const safeEqual = (a, b) => {
  const x = toCompare(a), y = toCompare(b);
  return !!x && !!y && x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};
// capability -> { role: true (all methods) | 'read' (GET only) }
const CAPABILITIES = {
  '*': { admin: true },
  diagnostics: { admin: true, operator: 'read', viewer: 'read' },
  sensors: { admin: true, viewer: 'read' },
  metrics: { admin: true, viewer: 'read' },
  audit: { admin: true, viewer: 'read' },
  jobs: { admin: true, operator: true, viewer: 'read' },
  portals: { admin: true, operator: true, viewer: 'read' },
  cabinet: { admin: true, operator: true, viewer: 'read' },
  directory: { admin: true, operator: true, viewer: 'read' },
  cases: { admin: true, operator: true, viewer: 'read' },
  generator: { admin: true, operator: true, viewer: 'read' },
  pgp: { admin: true, operator: true, viewer: 'read' },
  packages: { admin: true, operator: true, viewer: 'read' },
  core: { admin: true, operator: true, viewer: 'read' },
  settings: { admin: true },
  qr: { admin: true },
  backup: { admin: true },
  errors: { admin: true, operator: 'read', viewer: 'read' },
  logs: { admin: true, operator: 'read', viewer: 'read' },
  profiles: { admin: true },
  storage: { admin: true, operator: true, viewer: 'read' },
  retention: { admin: true, operator: true, viewer: 'read' },
  load: { admin: true, operator: 'read', viewer: 'read' },
  whoami: {
    admin: true, operator: 'read', viewer: 'read',
    // Съдът също трябва да може да попита „кой съм и какво мога“. Без това GUI-ят не
    // получава `capabilities` за съдебните роли и показва панели, които сървърът после
    // отказва с 403. Отговорът не издава нищо чуждо: собствената роля и собствените права.
    judge: 'read', prosecutor: 'read', clerk: 'read', expert: 'read',
  },
  users: { admin: true },
  // ── Роли за съд (F7-1) ────────────────────────────────────────────────────
  // Съдът НЕ е оператор: той чете доказателства и оставя следа, но не създава портали,
  // не качва файлове и не пипа настройки. Затова тези способности са само `read` и то
  // само за трите съдебни роли. `evidence` включва портала и доказателствения изглед;
  // `custody` — одитната верига и верификацията (кой какво е правил).
  evidence: { admin: true, judge: 'read', prosecutor: 'read', clerk: 'read', expert: 'read' },
  custody: { admin: true, judge: 'read', prosecutor: 'read', clerk: 'read', expert: 'read' },
  // Експертът може да ПРЕДСТАВИ становище (не да променя доказателство): точно една
  // способност с право на запис, за да не му се дава повече, отколкото работата му иска.
  expert_opinion: { admin: true, expert: true },
};

// Всички роли, които системата познава. Извън списъка → ролята не се приема (иначе
// правописна грешка в `user_roles` тихо би дала права).
const ROLES = ['admin', 'operator', 'viewer', 'judge', 'prosecutor', 'clerk', 'expert'];
const isRole = (r) => ROLES.includes(r);

/**
 * Кои способности ролята изобщо може да ползва (без значение от метода). Нужно е на GUI-я:
 * панел, който иска способност, която ролята няма, не бива да се показва като работещ —
 * иначе човекът вижда бутон, който връща 403. Точно това иска план 18 §7 с `permissions`.
 * Една дефиниция за инстанцията, за `whoami` и за тестовете — иначе три копия се разминават.
 */
function capabilitiesOf(role) {
  if (!role) return [];
  if (role === 'admin') return Object.keys(CAPABILITIES).sort();
  return Object.keys(CAPABILITIES)
    .filter((name) => {
      const value = CAPABILITIES[name][role];
      return value === true || value === 'read';
    })
    .sort();
}

function create({ adminToken, operatorToken, viewerToken, userRoles = {}, groupRoles = {}, defaultRole = 'admin', ssoRole = null }) {
  // Администраторските права са ПО ПОДРАЗБИРАНЕ: профилите (user_roles/group_roles) са
  // незадължителни и само коригират ролята надолу (напр. {"bob":"viewer"}).
  const fallback = isRole(defaultRole) ? defaultRole : 'admin';
  const roleForUser = user => { if (!user) return null; const r = userRoles[user]; return isRole(r) ? r : null };
  const roleForGroups = groups => { for (const g of groups) { const r = groupRoles[g]; if (isRole(r)) return r } return null };
  // Home Assistant ingress подава X-Remote-User-Id / X-Remote-User-Name /
  // X-Remote-User-Display-Name (не X-Remote-User и не X-Remote-Groups). Двете „стари“
  // заглавки остават само за обратна съвместимост и за reverse proxy, който сам
  // добавя групи. Ролята се търси по име, после по id, после по display name.
  function ingressIdentity(req) {
    const h = req.headers || {}, pick = k => String(h[k] == null ? '' : h[k]).trim();
    return { id: pick('x-remote-user-id'), name: pick('x-remote-user-name'), display: pick('x-remote-user-display-name'), legacy: pick('x-remote-user') };
  }
  function resolveIngress(req) {
    if (!req.ingress) return null;
    const identity = ingressIdentity(req);
    const groups = String(req.headers['x-remote-groups'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const user = roleForUser(identity.name) || roleForUser(identity.id) || roleForUser(identity.display) || roleForUser(identity.legacy);
    return user || roleForGroups(groups) || fallback;
  }
  function resolve(req) {
    const given = (req.headers.authorization || '').replace(/^Bearer /i, '');
    if (safeEqual(given, adminToken)) return 'admin';
    if (operatorToken && safeEqual(given, operatorToken)) return 'operator';
    if (viewerToken && safeEqual(given, viewerToken)) return 'viewer';
    // SSO сесия (OIDC): ролята идва от скоупите на сесията, които сървърът е издал след
    // ПРОВЕРЕН ID token. Без такъв вход функцията връща `null` — това е само последна стъпка,
    // след токените и Ingress, за да не се разширяват правата по погрешка.
    const sso = typeof ssoRole === 'function' ? ssoRole(req) : null;
    if (sso) return sso;
    return resolveIngress(req);
  }
  function allowed(role, capability, method) {
    if (!role) return false;
    if (role === 'admin') return true;
    const c = CAPABILITIES[capability];
    if (!c) return false;
    const v = c[role];
    if (v === true) return true;
    if (v === 'read') return method === 'GET';
    return false;
  }
  return { resolve, allowed, capabilitiesOf, role: resolve, configured: Object.keys(userRoles).length > 0 || Object.keys(groupRoles).length > 0, defaultRole: fallback };
}
module.exports = { create, CAPABILITIES, ROLES, isRole, capabilitiesOf };
