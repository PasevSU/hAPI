'use strict';
// Доказателства по ДЕЛО — компонент на HTTP слоя (план 17, F7-1 „достъп по дело“).
//
//   GET  /admin/api/evidence                    → делата и порталите, които ВИКАЩИЯТ вижда
//   POST /admin/api/evidence/assign             → { user, cases: [...] } — назначаване (само admin)
//   GET  /admin/api/evidence/assignments        → кой по кои дела е назначен (само admin)
//   GET  /admin/api/evidence/vault              → колко обекта пази ПЕЧАТЪТ на WORM (.worm/<sha256>)
//
// Защо съществува: съдебните роли имаха способности `evidence`/`custody`, но нито един маршрут
// не ги ползваше и нищо не ограничаваше видимостта по дело. Тук правата стават реални.
//
// Договор: `handle()` връща `true`, когато заявката е за този компонент (и е приключена),
// и `false`, когато трябва да я поеме следващият компонент.
function create(deps) {
  const { json, fail, parse, audit, adminGate, store, getPortals, getCases, roleOf, worm } = deps;
  const caseAccess = require('../case-access');

  /** Кой е викащият и кои дела са му зададени. */
  const caller = (req) => {
    const role = roleOf(req);
    // Ingress потребителят е името; при SSO/токен ролята е достатъчна, но назначенията се
    // търсят по име. Без име съдебна роля остава без дела — тоест без достъп (fail-closed).
    const name = String((req.headers && (req.headers['x-remote-user-name'] || req.headers['x-remote-user-id'] || req.headers['x-remote-user-display-name'])) || '').trim();
    let assignments = [];
    if (name) { try { assignments = store.getUserCases(name) } catch { assignments = [] } }
    return { role, name, assignments };
  };

  async function handle({ req, res, parts, method }) {
    if (!(parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'evidence')) return false;

    // Назначаването е АДМИНИСТРАТИВНО право: то решава кой вижда кое дело, затова е
    // `settings`, а не `evidence`.
    if (parts[3] === 'assign' || parts[3] === 'assignments') {
      if (!adminGate(req, res, 'settings', method)) return true;
      if (parts[3] === 'assignments' && method === 'GET') {
        const users = Array.isArray(getCases && getCases().users) ? [] : [];
        void users;
        const out = {};
        for (const user of store.listUsers().map((u) => u.username)) out[user] = store.getUserCases(user);
        return json(res, 200, { assignments: out }), true;
      }
      if (parts[3] === 'assign' && method === 'POST') {
        const body = await parse(req);
        const user = String((body && body.user) || '').trim();
        if (!user) return fail(res, 400, 'user is required'), true;
        const list = body && (body.cases === '*' ? ['*'] : Array.isArray(body.cases) ? body.cases : []);
        const saved = store.setUserCases(user, list.map(String));
        void audit('evidence.assign', { user, cases: saved.length, all: saved.includes('*') });
        return json(res, 200, { user, cases: saved }), true;
      }
      return fail(res, 405, 'Method not allowed'), true;
    }

    // Четенето на доказателства е способността `evidence` — тя вече е реална.
    if (!adminGate(req, res, 'evidence', method)) return true;

    // Състоянието на ПЕЧАТА (`.worm/<sha256>`): колко обекта и байта пази. Пътят до папката
    // НЕ се връща — вътрешният layout не е част от договора. `available: false` с причина е
    // по-честен отговор от „0 обекта“, който се чете като „всичко е наред“.
    if (parts[3] === 'vault' && method === 'GET') {
      if (!worm || typeof worm.vaultStats !== 'function') return fail(res, 503, 'WORM печатът не е достъпен'), true;
      const stats = await worm.vaultStats();
      return json(res, 200, {
        available: stats.available === true,
        objects: Number(stats.objects) || 0,
        bytes: Number(stats.bytes) || 0,
        reason: stats.available === true ? null : (stats.reason || 'UNKNOWN'),
      }), true;
    }

    if (!(parts.length === 3 && method === 'GET')) return fail(res, 404, 'Not found'), true;

    const me = caller(req);
    const portals = (getPortals() || []).filter((p) => p && p.status !== 'deleted');
    const allowed = caseAccess.allowedPortalIds({ role: me.role, assignments: me.assignments, portals });
    // `null` значи „без ограничение“ (не-съдебна роля) — разликата се вижда в отговора.
    const visible = allowed === null ? portals : portals.filter((p) => allowed.includes(String(p.id)));
    const why = caseAccess.explain({ role: me.role, assignments: me.assignments, portals });
    const cases = (getCases && getCases()) || [];
    const caseIds = new Set(visible.map((p) => p && p.caseId).filter(Boolean));
    return json(res, 200, {
      role: me.role,
      restricted: why.restricted,
      reason: why.reason || null,
      cases: (Array.isArray(cases) ? cases : []).filter((c) => c && caseIds.has(String(c.id))).map((c) => ({ id: c.id, title: c.title || '', status: c.status || '' })),
      portals: visible.map((p) => ({ id: p.id, slug: p.slug, title: p.title, caseId: p.caseId || null, files: Array.isArray(p.files) ? p.files.length : 0 })),
    }), true;
  }

  return { handle };
}

module.exports = { create };
