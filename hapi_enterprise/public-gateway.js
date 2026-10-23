'use strict';
// Public API Gateway (PG-0) — втори, независим канал за достъп.
//
// Един add-on, два канала:
//   • административен Ingress (8099) — управление, само през Home Assistant;
//   • Public API Gateway (8088) — публични портали и файлове, без HA сесия.
//
// Този модул не отваря портове. Той описва: конфигурацията на gateway-я, модела на
// порталите, маршрутите, изолацията от административни пътища и проверката
// „Public Access Test“ (симулация на външен посетител без HA сесия).
// Чист JS (UMD) — един и същ код за backend-а и за GUI-я.
(function () {
  const SCHEMA_VERSION = '1.0';
  const access = (() => {
    if (typeof require === 'function' && typeof module !== 'undefined' && module.exports) {
      try {
        return require('./download-access.js');
      } catch {
        return globalThis.HapiDownloadAccess;
      }
    }
    return globalThis.HapiDownloadAccess;
  })();

  // ── Два независими канала ─────────────────────────────────────────────────
  const CHANNELS = [
    {
      id: 'ingress',
      label: 'Административен Ingress',
      purpose: 'Управление на hAPI',
      access: 'През Home Assistant',
      auth: 'HA сесия и допълнителни права',
      users: 'Администратори и оператори',
      download: 'Управление и контрол',
      api: 'Административно',
      logs: 'Административен одит',
    },
    {
      id: 'public',
      label: 'Public API Gateway',
      purpose: 'Предоставяне на файлове и услуги',
      access: 'През публичен URL',
      auth: 'Публичен достъп, ключ или токен',
      users: 'Външни посетители и API клиенти',
      download: 'Според политиката на файла',
      api: 'Ограничено публично API',
      logs: 'Отделна история на посещенията и изтеглянията',
    },
  ];

  const GATEWAY_DEFAULTS = {
    schema_version: SCHEMA_VERSION,
    ingress: { port: 8099, stream: true, panel_admin: true, path: '/' },
    public: { port: 8088, published: false, require_https: true, domain: null, base_path: '/p/', relative: false },
    storage: { allowed_roots: ['/share', '/media'] },
    deny: {
      admin_paths: ['/admin', '/admin/api', '/hassio', '/supervisor', '/api/hassio', '/api/services', '/api/states', '/api/config'],
      prefixes: ['/config', '/ssl', '/backup', '/addons', '/addon_configs'],
      filesystem_paths: ['/etc', '/proc', '/sys', '/root', '/home', '/usr', '/var', '/dev', '/boot'],
    },
    tokens: { prefix: 'hapi_', reject_ha_jwt: true, min_length: 16, max_length: 256 },
    routes: {
      // Публичната страница се адресира с ID на портала: връзката не издава името
      // и остава валидна при преименуване на slug-а. JSON API-то работи по slug.
      portal: '/p/{id}/',
      portal_api: '/api/public/v1/portals/{slug}',
      file_api: '/api/public/v1/files/{id}',
      download: '/api/public/v1/files/{id}/download',
      qr: '/api/public/v1/portals/{slug}/qr.svg',
    },
  };

  const PORTAL_STATUS = ['active', 'paused', 'disabled'];
  const HTML_MODES = ['catalog', 'landing', 'none'];
  const PORTAL_FLAGS = ['none', 'info', 'important', 'urgent', 'archive'];
  const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

  const PORTAL_DEFAULTS = {
    id: '',
    slug: '',
    title: '',
    status: 'active',
    access: 'FREE',
    visibility: 'public',
    html: 'catalog',
    api: true,
    qr: true,
    storage_root: '/share',
    inherit: true,
    token_policy: { ttl_hours: 168, max_uses: 10, revocable: true },
  };

  function normalizeSlug(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63);
  }

  function normalizePortal(input) {
    const src = input && typeof input === 'object' ? input : {};
    const slug = normalizeSlug(src.slug || src.id || src.title);
    const mode = access && access.MODES_BY_ID[src.access] ? src.access : PORTAL_DEFAULTS.access;
    const tokenPolicy = Object.assign({}, PORTAL_DEFAULTS.token_policy, src.token_policy || {});
    return {
      id: String(src.id || slug),
      slug,
      title: String(src.title == null ? slug : src.title),
      status: PORTAL_STATUS.includes(src.status) ? src.status : PORTAL_DEFAULTS.status,
      access: mode,
      // Публични, неперсонални метаданни (контактът/делото не се издават навън).
      category: String(src.category == null ? '' : src.category),
      subject: String(src.subject == null ? '' : src.subject),
      flag: PORTAL_FLAGS.includes(src.flag) ? src.flag : 'none',
      visibility: src.visibility === 'hidden' ? 'hidden' : 'public',
      html: HTML_MODES.includes(src.html) ? src.html : PORTAL_DEFAULTS.html,
      api: src.api === false ? false : true,
      qr: src.qr === false ? false : true,
      storage_root: String(src.storage_root || PORTAL_DEFAULTS.storage_root),
      inherit: src.inherit === false ? false : true,
      token_policy: {
        ttl_hours: Number(tokenPolicy.ttl_hours) > 0 ? Number(tokenPolicy.ttl_hours) : 168,
        max_uses: Number(tokenPolicy.max_uses) > 0 ? Number(tokenPolicy.max_uses) : 10,
        revocable: tokenPolicy.revocable !== false,
      },
    };
  }

  function normalizeGateway(input) {
    const src = input && typeof input === 'object' ? input : {};
    const base = GATEWAY_DEFAULTS;
    const pub = Object.assign({}, base.public, src.public || {});
    const ing = Object.assign({}, base.ingress, src.ingress || {});
    const deny = Object.assign({}, base.deny, src.deny || {});
    return {
      schema_version: SCHEMA_VERSION,
      ingress: {
        port: Number(ing.port) || base.ingress.port,
        stream: ing.stream !== false,
        panel_admin: ing.panel_admin !== false,
        path: String(ing.path || '/'),
      },
      public: {
        port: Number(pub.port) || base.public.port,
        published: pub.published === true,
        require_https: pub.require_https !== false,
        domain: pub.domain ? String(pub.domain).toLowerCase() : null,
        base_path: String(pub.base_path || '/p/'),
        relative: pub.relative === true,
      },
      storage: {
        allowed_roots: Array.isArray(src.storage && src.storage.allowed_roots)
          ? src.storage.allowed_roots.map(String)
          : base.storage.allowed_roots.slice(),
      },
      deny: {
        admin_paths: (deny.admin_paths || []).map(String),
        prefixes: (deny.prefixes || []).map(String),
        filesystem_paths: (deny.filesystem_paths || []).map(String),
      },
      tokens: Object.assign({}, base.tokens, src.tokens || {}),
      routes: Object.assign({}, base.routes, src.routes || {}),
    };
  }

  function isUnderRoot(pathValue, roots) {
    const p = String(pathValue || '');
    if (!p.startsWith('/')) return false;
    return (roots || []).some((root) => p === root || p.startsWith(root.endsWith('/') ? root : root + '/'));
  }

  function validatePortal(input, gatewayInput) {
    const gw = normalizeGateway(gatewayInput);
    const p = normalizePortal(input);
    const errors = [];
    const warnings = [];
    if (!SLUG_RE.test(p.slug)) errors.push('slug трябва да е 2–63 знака: a-z, 0-9, „-“');
    if (!p.title.trim()) errors.push('липсва публично заглавие');
    if (!PORTAL_STATUS.includes(p.status)) errors.push('невалиден статус');
    if (!access || !access.MODES_BY_ID[p.access]) errors.push('невалиден режим на достъп');
    if (!isUnderRoot(p.storage_root, gw.storage.allowed_roots)) {
      errors.push(`storage_root „${p.storage_root}“ е извън разрешените: ${gw.storage.allowed_roots.join(', ')}`);
    }
    if (p.access === 'PRIVATE') {
      const res = access.validatePolicy({ mode: 'PRIVATE', roles: (input && input.roles) || [] });
      if (!res.ok) errors.push(...res.errors);
    }
    if (p.status === 'active' && !gw.public.published) {
      warnings.push('Публичният порт не е публикуван: порталът не е достъпен отвън.');
    }
    if (p.status === 'active' && gw.public.require_https && !gw.public.domain) {
      warnings.push('Няма публичен домейн — публичните адреси остават относителни (без хост).');
    }
    return { ok: errors.length === 0, errors, warnings, portal: p };
  }

  function publicBase(gatewayInput) {
    const gw = normalizeGateway(gatewayInput);
    // Същият origin като Home Assistant: адресите са относителни и наследяват
    // неговия домейн, порт и TLS (reverse proxy на същия host/port).
    if (gw.public.relative) return '';
    const host = gw.public.domain;
    // Без домейн НЯМА публичен адрес: не се измисля. Измисленият адрес дава връзка,
    // която никога не се отваря, а причината не се вижда от никъде (същото като W7).
    // Затова резултатът е относителен път, а панелът казва какво липсва.
    if (!host) return '';
    return `${gw.public.require_https ? 'https' : 'http'}://${host}`;
  }

  function publicUrl(portalInput, gatewayInput) {
    const p = normalizePortal(portalInput);
    // ID - адресът на човешката страница (там води QR кодът); slug - ключът за API-то.
    return `${publicBase(gatewayInput)}/p/${encodeURIComponent(p.id)}/`;
  }

  function apiUrls(portalInput, gatewayInput) {
    const p = normalizePortal(portalInput);
    const base = `${publicBase(gatewayInput)}/api/public/v1`;
    return {
      portal: `${base}/portals/${p.slug}`,
      files: `${base}/portals/${p.slug}/files`,
      qr: `${base}/portals/${p.slug}/qr.svg`,
    };
  }

  function downloadUrl(file, gatewayInput) {
    const id = encodeURIComponent(String((file && file.id) || ''));
    return `${publicBase(gatewayInput)}/api/public/v1/files/${id}/download`;
  }

  function isServed(portalInput) {
    return normalizePortal(portalInput).status === 'active';
  }

  /**
   * Слива политиките по йерархията. По-слаба политика НЕ може да отмени по-строга:
   * резултатът е винаги най-строгият от приложимите слоеве.
   */
  function resolvePolicy(input) {
    const src = input && typeof input === 'object' ? input : {};
    const layers = [];
    // Слой може да е режим ("FREE") или политика ({access|mode, roles, max_downloads, …}).
    const asPolicy = (v) => {
      if (typeof v === 'string') return { mode: v };
      if (v && typeof v === 'object' && v.mode == null && v.access) return { ...v, mode: v.access };
      return v;
    };
    if (src.system) layers.push(asPolicy(src.system));
    if (src.storage) layers.push(asPolicy(src.storage));
    if (src.portal && src.portal.access) layers.push(asPolicy(src.portal.access));
    if (src.folder && src.folder.access) layers.push(asPolicy(src.folder.access));
    // Файловият слой носи и собствени ограничения (роли, лимит, срок), не само режим.
    if (src.file && src.file.access) layers.push(asPolicy(src.file));
    const policy = access.merge(layers.length ? layers : [{ mode: 'FREE' }]);
    const visibility = (src.file && src.file.visibility) || (src.portal && src.portal.visibility) || 'public';
    const overridden = Boolean(src.file && src.file.access);
    return { policy, visibility, layers: layers.length, inherited: !overridden };
  }

  function behaviourFor(portalInput, file) {
    const p = normalizePortal(portalInput);
    const res = resolvePolicy({ portal: p, file });
    const b = access.behaviour(res.visibility, res.policy.mode);
    if (!isServed(p)) return Object.assign({}, b, { listed: false, downloadable: false, label: 'Порталът не е активен' });
    return b;
  }

  // ── Изолация ───────────────────────────────────────────────────────────────
  function isolate(pathname, gatewayInput) {
    const gw = normalizeGateway(gatewayInput);
    let raw = String(pathname == null ? '' : pathname).split('?')[0].split('#')[0];
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return { ok: false, reason: 'bad-encoding' };
    }
    raw = raw.replace(/\\/g, '/');
    if (!raw.startsWith('/')) return { ok: false, reason: 'not-absolute' };
    const segments = raw.split('/').filter(Boolean);
    if (segments.some((s) => s === '..' || s === '.')) return { ok: false, reason: 'path-traversal' };
    if (raw.startsWith('//')) return { ok: false, reason: 'unc' };
    const hits = (list) => list.some((prefix) => raw === prefix || raw.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'));
    if (hits(gw.deny.prefixes)) return { ok: false, reason: 'config-path' };
    if (hits(gw.deny.admin_paths)) return { ok: false, reason: 'admin-path' };
    if (hits(gw.deny.filesystem_paths)) return { ok: false, reason: 'filesystem-path' };
    const segmentsTail = segments.join('/');
    if (segmentsTail.includes('..')) return { ok: false, reason: 'path-traversal' };
    return { ok: true, reason: '' };
  }

  /** Публичният ключ не може да е HA токен (JWT) — отделна схема на авторизация. */
  function validatePublicToken(token, gatewayInput) {
    const gw = normalizeGateway(gatewayInput);
    const value = String(token == null ? '' : token);
    if (!value) return { ok: false, reason: 'missing' };
    if (gw.tokens.reject_ha_jwt && /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(value)) {
      return { ok: false, reason: 'ha-token' };
    }
    if (value.startsWith('eyJ')) return { ok: false, reason: 'ha-token' };
    if (!value.startsWith(gw.tokens.prefix)) return { ok: false, reason: 'wrong-prefix' };
    if (value.length < gw.tokens.min_length || value.length > gw.tokens.max_length) {
      return { ok: false, reason: 'length' };
    }
    return { ok: true, reason: '' };
  }

  // ── Маршрути ───────────────────────────────────────────────────────────────
  function gatewayRoute(pathname, gatewayInput) {
    const gw = normalizeGateway(gatewayInput);
    const isolated = isolate(pathname, gw);
    if (!isolated.ok) return { kind: 'denied', reason: isolated.reason };
    const raw = String(pathname).split('?')[0].split('#')[0];
    let m = raw.match(/^\/p\/([^/]+)\/?/);
    if (m) return { kind: 'portal', slug: normalizeSlug(m[1]), rest: raw.slice(m[0].length) };
    m = raw.match(/^\/api\/public\/v1\/portals\/([^/]+)(?:\/(files|qr\.svg))?\/?$/);
    if (m) return { kind: 'portal-api', slug: normalizeSlug(m[1]), sub: m[2] || '' };
    m = raw.match(/^\/api\/public\/v1\/files\/([^/]+)(\/download)?\/?$/);
    if (m) return { kind: 'file-api', id: decodeURIComponent(m[1]), download: Boolean(m[2]) };
    return { kind: 'unknown', reason: 'not-found' };
  }

  /**
   * Public Access Test: симулира заявка от външен посетител БЕЗ HA сесия.
   * Връща решението, причината и пълния списък проверки (за GUI и за backend лог).
   */
  function publicAccessTest(input) {
    const src = input && typeof input === 'object' ? input : {};
    const gw = normalizeGateway(src.gateway);
    const portal = normalizePortal(src.portal);
    const file = src.file || null;
    const ctx = src.ctx || {};
    const checks = [];
    const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: detail || '' });

    add('portal-known', Boolean(portal.slug), 'Няма портал');
    add('portal-active', portal.status === 'active', `Статус: ${portal.status}`);
    add('gateway-published', gw.public.published, 'Публичният порт не е публикуван');
    add(
      'https',
      !gw.public.require_https || gw.public.domain !== null || gw.public.relative,
      'Няма публичен домейн за HTTPS',
    );

    // Публичната страница е `/p/<id>/` (там води QR кодът) — проверяваме точно нея.
    const route = gatewayRoute(`/p/${portal.id}/`, gw);
    add('route', route.kind === 'portal', `Маршрут: ${route.kind}`);
    const isolated = isolate(`/p/${portal.id}/`, gw);
    add('isolation', isolated.ok, isolated.reason);

    const tokenCheck = ctx.tokenString ? validatePublicToken(ctx.tokenString, gw) : { ok: true, reason: '' };
    add('token-scheme', tokenCheck.ok, tokenCheck.reason);

    const resolved = resolvePolicy({
      system: src.system,
      storage: src.storage,
      portal,
      folder: src.folder,
      file,
    });
    const decision = access.decide({
      policy: resolved.policy,
      visibility: resolved.visibility,
      permission: ctx.permission || 'files.download',
      now: ctx.now,
      system: ctx.system,
      storage: ctx.storage,
      user: ctx.user,
      token: ctx.token,
      session: ctx.session,
      passwordOk: ctx.passwordOk,
    });
    checks.push(...decision.checks);

    const failed = checks.filter((c) => !c.ok);
    return {
      allowed: failed.length === 0,
      reason: failed.length ? failed[0].id : '',
      detail: failed.length ? failed[0].detail : '',
      checks,
      behaviour: decision.behaviour,
      policy: resolved.policy,
      inherited: resolved.inherited,
      url: file ? downloadUrl(file, gw) : publicUrl(portal, gw),
      portal_url: publicUrl(portal, gw),
    };
  }

  function summary(portals) {
    const list = (Array.isArray(portals) ? portals : []).map(normalizePortal);
    return {
      total: list.length,
      active: list.filter((p) => p.status === 'active').length,
      paused: list.filter((p) => p.status === 'paused').length,
      disabled: list.filter((p) => p.status === 'disabled').length,
      publicFree: list.filter((p) => p.access === 'FREE').length,
      keyRequired: list.filter((p) => p.access === 'KEY_REQUIRED').length,
      hidden: list.filter((p) => p.visibility === 'hidden').length,
    };
  }

  const API = {
    SCHEMA_VERSION,
    CHANNELS,
    GATEWAY_DEFAULTS,
    PORTAL_DEFAULTS,
    PORTAL_STATUS,
    HTML_MODES,
    normalizeSlug,
    normalizePortal,
    normalizeGateway,
    validatePortal,
    publicBase,
    publicUrl,
    apiUrls,
    downloadUrl,
    isServed,
    resolvePolicy,
    behaviourFor,
    isolate,
    validatePublicToken,
    gatewayRoute,
    publicAccessTest,
    summary,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  globalThis.HapiPublicGateway = API;
})();
