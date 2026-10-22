'use strict';
// Download Access Control (FD-0) — централни правила за достъпност на изтегляне.
//
// Йерархия: system → storage → portal → folder → file → user/role → token → session.
// Сливане: НАЙ-СТРОГАТА политика печели; достъп се дава само ако всички проверки минат.
// Чист JS (UMD) — един и същ код за backend-а и за GUI прегледа на решението.
(function () {
  const SCHEMA_VERSION = '1.0';

  const MODES = [
    { id: 'FREE', rank: 1, label: 'Свободно изтегляне', short: 'FREE' },
    { id: 'KEY_REQUIRED', rank: 2, label: 'Достъп с индивидуален ключ', short: 'KEY_REQUIRED' },
    { id: 'AUTHENTICATED', rank: 3, label: 'Само вписани потребители', short: 'AUTHENTICATED' },
    { id: 'PRIVATE', rank: 4, label: 'Само изрично разрешени', short: 'PRIVATE' },
    { id: 'DISABLED', rank: 5, label: 'Изтеглянето е забранено', short: 'DISABLED' },
  ];
  const MODES_BY_ID = MODES.reduce((acc, m) => Object.assign(acc, { [m.id]: m }), {});

  const LEVELS = ['system', 'storage', 'portal', 'folder', 'file', 'user', 'token', 'session'];

  const VISIBILITY = [
    { id: 'public', label: 'Public — показва се в каталога' },
    { id: 'hidden', label: 'Hidden — само с адрес и ключ' },
  ];

  const PERMISSIONS = [
    { id: 'files.read', label: 'Преглед на файл' },
    { id: 'files.download', label: 'Изтегляне' },
    { id: 'reports.export', label: 'Експорт на отчет' },
    { id: 'evidence.export', label: 'Експорт на доказателства' },
    { id: 'templates.export', label: 'Експорт на шаблони' },
    { id: 'audit.export', label: 'Експорт на логове' },
    { id: 'backups.create', label: 'Създаване на архив' },
    { id: 'bulk.export', label: 'Групов експорт' },
  ];
  const PERMISSION_IDS = PERMISSIONS.map((p) => p.id);

  const DEFAULT_POLICY = {
    mode: 'FREE',
    roles: [],
    expires_at: null,
    max_downloads: null,
    password: false,
    verify_on_serve: true,
    audit: true,
    window: null,
    ip: { allow: [], deny: [] },
    concurrency: 2,
    rate_per_hour: 60,
    one_time: false,
    inherits: true,
  };

  const DEFAULT_SYSTEM = { allow_downloads: true, public_gateway: true };

  // ── Нормализация ───────────────────────────────────────────────────────────
  function normalizePolicy(input) {
    const src = input && typeof input === 'object' ? input : {};
    const mode = MODES_BY_ID[src.mode] ? src.mode : DEFAULT_POLICY.mode;
    const toInt = (v, def) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
    };
    const ip = src.ip && typeof src.ip === 'object' ? src.ip : {};
    return {
      mode,
      roles: Array.isArray(src.roles) ? src.roles.map(String) : [],
      expires_at: src.expires_at ? String(src.expires_at) : null,
      max_downloads: src.max_downloads == null ? null : toInt(src.max_downloads, null),
      password: Boolean(src.password),
      verify_on_serve: src.verify_on_serve === false ? false : true,
      audit: src.audit === false ? false : true,
      window: normalizeWindow(src.window),
      ip: {
        allow: Array.isArray(ip.allow) ? ip.allow.map(String) : [],
        deny: Array.isArray(ip.deny) ? ip.deny.map(String) : [],
      },
      concurrency: src.concurrency == null ? null : toInt(src.concurrency, null),
      rate_per_hour: src.rate_per_hour == null ? null : toInt(src.rate_per_hour, null),
      one_time: Boolean(src.one_time),
      inherits: src.inherits === false ? false : true,
    };
  }

  function normalizeWindow(win) {
    if (!win) return null;
    const from = String(win.from || '');
    const to = String(win.to || '');
    const ok = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
    if (!ok(from) || !ok(to)) return null;
    return { from, to };
  }

  function validatePolicy(input) {
    const src = input && typeof input === 'object' ? input : {};
    const errors = [];
    if (src.mode != null && !MODES_BY_ID[src.mode]) errors.push(`Непознат режим: ${src.mode}`);
    if (src.expires_at && Number.isNaN(Date.parse(src.expires_at))) errors.push('expires_at не е валидна дата');
    if (src.max_downloads != null && (!Number.isInteger(src.max_downloads) || src.max_downloads < 1)) {
      errors.push('max_downloads трябва да е цяло число ≥ 1');
    }
    if (src.window && !normalizeWindow(src.window)) errors.push('window трябва да е {from,to} във формат HH:MM');
    else if (src.window && normalizeWindow(src.window).from >= normalizeWindow(src.window).to) {
      // Прозорец, който пресича полунощ (22:00→06:00), не се поддържа: при сечение
      // на слоеве той става „празен“ и достъпът спира безшумно за цялото денонощие.
      // По-добре ясна грешка при запис, отколкото заключена врата без обяснение.
      errors.push('window.from трябва да е преди window.to (прозорец през полунощ не се поддържа — задай два прозореца)');
    }
    if (src.roles && !Array.isArray(src.roles)) errors.push('roles трябва да е масив');
    if (src.ip && src.ip.allow && !Array.isArray(src.ip.allow)) errors.push('ip.allow трябва да е масив');
    if (src.mode === 'PRIVATE' && (!Array.isArray(src.roles) || src.roles.length === 0)) {
      errors.push('PRIVATE изисква поне една роля');
    }
    return { ok: errors.length === 0, errors };
  }

  // ── Сливане на слоеве (най-строгото печели) ───────────────────────────────
  function rank(mode) {
    return (MODES_BY_ID[mode] && MODES_BY_ID[mode].rank) || 0;
  }

  function minDefined(values, def) {
    const nums = values.filter((v) => v != null);
    return nums.length ? Math.min(...nums) : def;
  }

  function intersectWindows(a, b) {
    if (!a) return b;
    if (!b) return a;
    const from = a.from > b.from ? a.from : b.from;
    const to = a.to < b.to ? a.to : b.to;
    return { from, to, empty: from >= to };
  }

  function intersectLists(a, b) {
    if (!a.length) return b.slice();
    if (!b.length) return a.slice();
    return a.filter((v) => b.includes(v));
  }

  /**
   * Слива слоеве политики (в йерархичен ред). Резултатът е политика, която не може
   * да бъде по-слаба от който и да е от входовете.
   */
  function merge(layers) {
    const list = (Array.isArray(layers) ? layers : [layers])
      .filter(Boolean)
      .map(normalizePolicy);
    const out = {
      mode: 'FREE',
      roles: [],
      expires_at: null,
      max_downloads: null,
      password: false,
      verify_on_serve: false,
      audit: false,
      window: null,
      ip: { allow: [], deny: [] },
      concurrency: null,
      rate_per_hour: null,
      one_time: false,
      inherits: true,
    };
    for (const p of list) {
      if (rank(p.mode) > rank(out.mode)) out.mode = p.mode;
      // Ролите се СЕЧАТ, не се обединяват. При PRIVATE достъп се дава само на роля,
      // позволена от ВСЕКИ слой; обединение би разрешило повече от най-стриктен слой
      // (слой „финанси“ + слой „ЧР“ не значи достъп за двете).
      out.roles = intersectLists(out.roles, p.roles);
      if (p.expires_at) {
        const t = Date.parse(p.expires_at);
        if (!Number.isNaN(t) && (out.expires_at === null || t < Date.parse(out.expires_at))) {
          out.expires_at = new Date(t).toISOString();
        }
      }
      out.max_downloads = minDefined([out.max_downloads, p.max_downloads], null);
      out.password = out.password || p.password;
      out.verify_on_serve = out.verify_on_serve || p.verify_on_serve;
      out.audit = out.audit || p.audit;
      out.one_time = out.one_time || p.one_time;
      out.window = intersectWindows(out.window, p.window);
      if (out.ip.allow.length || p.ip.allow.length) out.ip.allow = intersectLists(out.ip.allow, p.ip.allow);
      out.ip.deny = [...new Set([...out.ip.deny, ...p.ip.deny])];
      out.concurrency = minDefined([out.concurrency, p.concurrency], DEFAULT_POLICY.concurrency);
      out.rate_per_hour = minDefined([out.rate_per_hour, p.rate_per_hour], DEFAULT_POLICY.rate_per_hour);
    }
    if (out.concurrency == null) out.concurrency = DEFAULT_POLICY.concurrency;
    if (out.rate_per_hour == null) out.rate_per_hour = DEFAULT_POLICY.rate_per_hour;
    return out;
  }

  // ── Токени ─────────────────────────────────────────────────────────────────
  function tokenState(token, now) {
    if (!token) return 'missing';
    const t = now instanceof Date ? now.getTime() : Number(now || Date.now());
    if (token.revoked) return 'revoked';
    if (token.not_before && t < Date.parse(token.not_before)) return 'not_started';
    if (token.expires_at && t >= Date.parse(token.expires_at)) return 'expired';
    const max = token.max_uses == null ? null : Number(token.max_uses);
    if (max != null && Number(token.uses || 0) >= max) return 'exhausted';
    return 'active';
  }

  /** Атомарно отчитане на използване: връща НОВ обект (без мутация на входа). */
  function useToken(token, now) {
    const state = tokenState(token, now);
    if (state !== 'active') return { ok: false, reason: state, token: null };
    const next = Object.assign({}, token, {
      uses: Number(token.uses || 0) + 1, last_used_at: new Date(
        now instanceof Date ? now.getTime() : Number(now || Date.now()),
      ).toISOString()
    });
    return { ok: true, reason: '', token: next };
  }

  function revokeToken(token) {
    return Object.assign({}, token || {}, { revoked: true, revoked_at: new Date().toISOString() });
  }

  // ── Видимост × достъпност ─────────────────────────────────────────────────
  const BEHAVIOUR = {
    'public:FREE': { listed: true, downloadable: true, label: 'Показва се и се изтегля свободно' },
    'public:KEY_REQUIRED': { listed: true, downloadable: true, requiresKey: true, label: 'Показва се, но изисква ключ' },
    'public:AUTHENTICATED': { listed: true, downloadable: true, requiresLogin: true, label: 'Показва се, изисква вход' },
    'public:PRIVATE': { listed: true, downloadable: true, requiresLogin: true, requiresRole: true, label: 'Показва се, само за разрешени' },
    'public:DISABLED': { listed: true, downloadable: false, label: 'Показва се информационно, без изтегляне' },
    'hidden:FREE': { listed: false, downloadable: true, label: 'Само с адрес, свободно' },
    'hidden:KEY_REQUIRED': { listed: false, downloadable: true, requiresKey: true, label: 'Само с валиден адрес и ключ' },
    'hidden:AUTHENTICATED': { listed: false, downloadable: true, requiresLogin: true, label: 'Само с адрес и вход' },
    'hidden:PRIVATE': { listed: false, downloadable: true, requiresLogin: true, requiresRole: true, label: 'Само с адрес и изрично разрешение' },
    'hidden:DISABLED': { listed: false, downloadable: false, label: 'Няма публичен достъп' },
  };

  function behaviour(visibility, mode) {
    const vis = visibility === 'hidden' ? 'hidden' : 'public';
    const key = `${vis}:${MODES_BY_ID[mode] ? mode : 'DISABLED'}`;
    return Object.assign({ visibility: vis, mode, listed: false, downloadable: false }, BEHAVIOUR[key]);
  }

  // ── Решение за достъп ──────────────────────────────────────────────────────
  function withinWindow(policy, now) {
    if (!policy.window) return { ok: true, reason: '' };
    if (policy.window.empty) return { ok: false, reason: 'window-empty' };
    // Изкривен прозорец (from >= to) е счупена политика, а не „отворено“ — казваме го
    // изрично, за да не изглежда като нормален отказ „извън работно време“.
    if (policy.window.from >= policy.window.to) return { ok: false, reason: 'window-invalid' };
    const d = now instanceof Date ? now : new Date(now || Date.now());
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const inside = hhmm >= policy.window.from && hhmm < policy.window.to;
    return { ok: inside, reason: inside ? '' : 'window-closed' };
  }

  function ipAllowed(policy, ip) {
    const value = String(ip || '');
    if (policy.ip.deny.length && policy.ip.deny.includes(value)) return { ok: false, reason: 'ip-denied' };
    if (policy.ip.allow.length && !policy.ip.allow.includes(value)) return { ok: false, reason: 'ip-not-allowed' };
    return { ok: true, reason: '' };
  }

  function effectivePermissions(user) {
    const own = Array.isArray(user && user.permissions) ? user.permissions : [];
    // Публичният посетител няма вътрешни права: получава само четене и изтегляне.
    if (!user || !user.id) return ['files.read', 'files.download'];
    return [...new Set(own)];
  }

  /**
   * Пълно решение за достъп.
   * ctx: { policy | layers, permission, visibility, now, system, storage, user, token, session, passwordOk }
   * → { allowed, mode, reason, checks[], behaviour, requires[] }
   */
  function decide(ctx) {
    const c = ctx && typeof ctx === 'object' ? ctx : {};
    const policy = c.policy ? normalizePolicy(c.policy) : merge(c.layers || []);
    const visibility = c.visibility === 'hidden' ? 'hidden' : 'public';
    const now = c.now instanceof Date ? c.now : new Date(c.now || Date.now());
    const permission = c.permission || 'files.download';
    const system = Object.assign({}, DEFAULT_SYSTEM, c.system || {});
    const storage = Object.assign({ available: true }, c.storage || {});
    const user = c.user && typeof c.user === 'object' ? c.user : {};
    const token = c.token || null;
    const session = c.session && typeof c.session === 'object' ? c.session : {};
    const checks = [];
    const add = (id, ok, detail) => {
      checks.push({ id, ok: Boolean(ok), detail: detail || '' });
      return Boolean(ok);
    };

    add('system-allow', system.allow_downloads !== false, 'Глобална забрана за изтегляния');
    add('storage-available', storage.available !== false, 'Хранилището не е достъпно');
    add('mode-enabled', policy.mode !== 'DISABLED', 'Политиката е DISABLED');
    add('expiry', !policy.expires_at || Date.parse(policy.expires_at) > now.getTime(), 'Достъпът е изтекъл');

    const perms = effectivePermissions(user);
    add('permission', perms.includes(permission), `Липсва право ${permission}`);

    const needsLogin = policy.mode === 'AUTHENTICATED' || policy.mode === 'PRIVATE';
    add('authenticated', !needsLogin || Boolean(user.id), 'Изисква се вписан потребител');
    if (policy.mode === 'PRIVATE') {
      const roles = Array.isArray(user.roles) ? user.roles : [];
      add('role', policy.roles.length > 0 && roles.some((r) => policy.roles.includes(r)), 'Липсва разрешена роля');
    }

    const needsKey = policy.mode === 'KEY_REQUIRED';
    const tokenCode = tokenState(token, now);
    if (needsKey) add('token-active', tokenCode === 'active', `Ключ: ${tokenCode}`);
    else if (token) add('token-valid', tokenCode === 'active', `Ключ: ${tokenCode}`);

    const win = withinWindow(policy, now);
    add('window', win.ok, win.reason);
    const ipres = ipAllowed(policy, session.ip);
    add('ip', ipres.ok, ipres.reason);

    if (policy.max_downloads != null) {
      const used = Number((token && token.uses) || session.uses || 0);
      add('quota', used < policy.max_downloads, `Изчерпан лимит (${used}/${policy.max_downloads})`);
    } else if (policy.one_time) {
      const used = Number((token && token.uses) || session.uses || 0);
      add('quota', used < 1, 'Еднократна връзка вече използвана');
    }
    const rateLimit = policy.rate_per_hour == null ? DEFAULT_POLICY.rate_per_hour : policy.rate_per_hour;
    const concurrencyLimit = policy.concurrency == null ? DEFAULT_POLICY.concurrency : policy.concurrency;
    if (session.downloadsThisHour != null) {
      add('rate', Number(session.downloadsThisHour) < rateLimit, 'Над лимита за час');
    }
    if (session.concurrent != null) {
      add('concurrency', Number(session.concurrent) < concurrencyLimit, 'Над лимита едновременни изтегляния');
    }
    if (policy.password) add('password', c.passwordOk === true, 'Изисква се парола (само backend)');

    const failed = checks.filter((x) => !x.ok);
    const requires = [];
    if (needsKey) requires.push('key');
    if (needsLogin) requires.push('login');
    if (policy.roles.length) requires.push('role');
    if (policy.password) requires.push('password');

    return {
      allowed: failed.length === 0,
      mode: policy.mode,
      reason: failed.length ? failed[0].id : '',
      detail: failed.length ? failed[0].detail : '',
      checks,
      requires,
      behaviour: behaviour(visibility, policy.mode),
      policy,
    };
  }

  // ── Състояние за GUI ───────────────────────────────────────────────────────
  function stateOf(policyInput, ctx) {
    const policy = normalizePolicy(policyInput);
    const c = ctx && typeof ctx === 'object' ? ctx : {};
    const now = c.now instanceof Date ? c.now : new Date(c.now || Date.now());
    if (policy.mode === 'DISABLED') return 'disabled';
    if (policy.expires_at && Date.parse(policy.expires_at) <= now.getTime()) return 'expired';
    if (c.token && c.token.revoked) return 'revoked';
    if (tokenState(c.token, now) === 'exhausted' || (policy.max_downloads != null && c.token && Number(c.token.uses || 0) >= policy.max_downloads)) {
      return 'exhausted';
    }
    if (policy.mode === 'KEY_REQUIRED') return 'key';
    if (policy.mode === 'FREE') return 'public';
    return 'restricted';
  }

  const STATE_LABEL = {
    public: 'Публичен',
    key: 'Изисква ключ',
    restricted: 'Ограничен',
    expired: 'Изтекъл',
    revoked: 'Отозван',
    exhausted: 'Изчерпан лимит',
    disabled: 'Забранен',
  };

  // ── Report Studio артефакти ────────────────────────────────────────────────
  function artifactAccess(art) {
    const a = art && typeof art === 'object' ? art : {};
    const kind = a.kind || 'final-pdf';
    const verified = a.verified === true;
    const hasStartStop = a.hasStart === true && a.hasStop === true;
    const base = { kind, permission: 'reports.export', status: 'READY', blocked: false, note: '' };
    switch (kind) {
      case 'draft-pdf':
        return Object.assign(base, {
          permission: 'files.read',
          status: 'DRAFT',
          note: 'Чернова — не може да се публикува като удостоверен документ.',
        });
      case 'final-pdf':
        if (!verified) {
          return Object.assign(base, {
            status: 'INCOMPLETE',
            blocked: true,
            note: 'PDF не е удостоверен: липсва успешно генериране/проверка.',
          });
        }
        return base;
      case 'manifest':
        return Object.assign(base, { permission: 'reports.export' });
      case 'tsa-token':
        return Object.assign(base, {
          permission: 'evidence.export',
          status: hasStartStop ? 'READY' : 'INCOMPLETE',
          blocked: !hasStartStop,
          note: hasStartStop ? '' : 'Липсва START или STOP токен.',
        });
      case 'originals':
        return Object.assign(base, {
          permission: 'evidence.export',
          note: 'По-строга политика от обикновен отчет.',
        });
      case 'evidence-package':
        return Object.assign(base, {
          permission: 'evidence.export',
          status: hasStartStop && verified ? 'READY' : 'INCOMPLETE',
          blocked: false,
          note: hasStartStop && verified ? '' : 'Диагностичен пакет с непълен статус.',
        });
      default:
        return Object.assign(base, { status: 'UNKNOWN', blocked: true, note: `Непознат артефакт: ${kind}` });
    }
  }

  function summary(policyInput) {
    const p = normalizePolicy(policyInput);
    const bits = [p.mode];
    if (p.expires_at) bits.push(`до ${p.expires_at.slice(0, 10)}`);
    if (p.max_downloads != null) bits.push(`макс ${p.max_downloads}`);
    if (p.password) bits.push('парола');
    if (p.one_time) bits.push('еднократен');
    return bits.join(' · ');
  }

  const API = {
    SCHEMA_VERSION,
    MODES,
    MODES_BY_ID,
    LEVELS,
    VISIBILITY,
    PERMISSIONS,
    PERMISSION_IDS,
    DEFAULT_POLICY,
    DEFAULT_SYSTEM,
    STATE_LABEL,
    normalizePolicy,
    normalizeWindow,
    validatePolicy,
    rank,
    merge,
    tokenState,
    useToken,
    revokeToken,
    behaviour,
    decide,
    stateOf,
    withinWindow,
    ipAllowed,
    artifactAccess,
    summary,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  globalThis.HapiDownloadAccess = API;
})();
