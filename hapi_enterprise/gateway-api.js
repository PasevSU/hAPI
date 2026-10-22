'use strict';
// PG-6 / FD-6: backend прилагане на правилата за публичен достъп и експорт.
//
// Този модул е единственото място, където сървърът пита „може ли този файл да бъде
// изтеглен от този канал?“. GUI-ят ползва същите функции, но решението се взема
// повторно тук при всяка заявка (GUI не е граница за сигурност).
const fs = require('node:fs');
const path = require('node:path');
const GW = require('./public-gateway.js');
const ACC = require('./download-access.js');
const R = require('./export-rules.js');
const MGR = require('./export-manager.js');

// ── Зареждане на правила ─────────────────────────────────────────────────────
// Търсят се в този ред, файл по файл:
//   1. HAPI_CONFIG_DIR (или неговият поддиректориум rules/) — задава се от опцията
//      `config_dir` на add-on-а;
//   2. /config/rules — app_config папката на add-on-а (редактируема от потребителя);
//   3. <addon>/rules — вградените стойности, които пътуват с образа;
//   4. <repo>/config/rules — авторското копие при разработка.
// Ако никъде няма файл, се ползва вградената константа и се логва предупреждение.
const BUNDLED_DIR = path.join(__dirname, 'rules');
const CONTAINER_DIR = '/config/rules';
const REPO_DIR = path.join(__dirname, '..', 'config', 'rules');
const RULE_FILES = [
  'download_rules.json',
  'public_gateway.json',
  'download_access.json',
  'file_permissions.json',
  'token_policies.json',
  'rate_limits.json',
  'export_profiles.json',
  'export_permissions.json',
];
const FALLBACK = {
  gateway: {},
  access: { default_policy: {}, system: {} },
  files: { rules: [] },
  tokens: { policies: [] },
  rate: { defaults: {} },
  profiles: { profiles: [] },
  permissions: { permissions: [] },
  rules: R.DEFAULT_RULES,
};
let cache = null;
let loadedAt = null;
let sources = {};
let apiLog = null;

/** Подава логера на сървъра, за да не се губи информация при fallback. */
function setLogger(logger) {
  apiLog = logger && typeof logger.warn === 'function' ? logger : null;
}

function ruleDirs() {
  const dirs = [];
  const env = String(process.env.HAPI_CONFIG_DIR || '').trim();
  if (env) dirs.push(fs.existsSync(path.join(env, 'rules')) ? path.join(env, 'rules') : env);
  dirs.push(CONTAINER_DIR);
  dirs.push(BUNDLED_DIR);
  dirs.push(REPO_DIR);
  return [...new Set(dirs)];
}

const CONFIG_DIR = ruleDirs()[0];

function warnFallback(name, reason) {
  const detail = { ns: 'rules', file: name, reason: reason || 'missing' };
  if (apiLog) apiLog.warn('rules.fallback', detail);
  else console.warn('rules: using built-in defaults for ' + name);
}

/** Чете един файл с правила; връща fallback, ако никъде не е намерен. */
function readJson(name, fallback) {
  for (const dir of ruleDirs()) {
    const file = path.join(dir, name);
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      sources[name] = file;
      return parsed;
    } catch (e) {
      if (apiLog) apiLog.warn('rules.invalid', { ns: 'rules', file, err: e.message });
    }
  }
  sources[name] = 'default';
  warnFallback(name);
  return fallback;
}

/** Зарежда конфигурацията веднъж (и замразява резултата). */
function config() {
  if (cache) return cache;
  const rules = readJson('download_rules.json', R.DEFAULT_RULES);
  const rawGateway = readJson('public_gateway.json', FALLBACK.gateway);
  // Домейнът и публикуването могат да дойдат от среда (Docker/тестове) или от
  // опциите на add-on-а (Settings → Add-on configuration).
  let options = {};
  try {
    options = JSON.parse(fs.readFileSync(process.env.OPTIONS_PATH || '/data/options.json', 'utf8')) || {};
  } catch {
    options = {};
  }
  const envDomain = String(process.env.PUBLIC_DOMAIN || '').trim().toLowerCase();
  const optDomain = String(options.public_domain || '').trim().toLowerCase();
  const envPublished = ['1', 'true', 'yes'].includes(String(process.env.PUBLIC_GATEWAY || '').toLowerCase());
  const optPublished = options.public_gateway === true;
  // Същият IP и порт като Home Assistant → относителни адреси (reverse proxy на същия origin).
  const envSameOrigin = ['1', 'true', 'yes'].includes(String(process.env.PUBLIC_GATEWAY_SAME_ORIGIN || '').toLowerCase());
  const optSameOrigin = options.public_same_origin === true;
  const domain = envDomain || optDomain;
  const gatewayInput = Object.assign({}, rawGateway, {
    public: Object.assign({}, rawGateway.public, {
      ...(domain ? { domain } : {}),
      ...(envPublished || optPublished ? { published: true } : {}),
      relative: envSameOrigin || optSameOrigin || rawGateway.public?.relative === true,
    }),
  });
  cache = {
    gateway: GW.normalizeGateway(gatewayInput),
    access: readJson('download_access.json', FALLBACK.access),
    files: readJson('file_permissions.json', FALLBACK.files),
    tokens: readJson('token_policies.json', FALLBACK.tokens),
    rate: readJson('rate_limits.json', FALLBACK.rate),
    profiles: readJson('export_profiles.json', FALLBACK.profiles),
    permissions: readJson('export_permissions.json', FALLBACK.permissions),
    rules: R.validateRules(rules).ok ? rules : R.DEFAULT_RULES,
  };
  loadedAt = new Date().toISOString();
  return cache;
}

/** Кой файл откъде е зареден — за диагностика и за admin API-то. */
function status() {
  const current = config();
  return {
    dirs: ruleDirs(),
    files: Object.fromEntries(RULE_FILES.map((name) => [name, sources[name] || 'default'])),
    missing: RULE_FILES.filter((name) => !sources[name] || sources[name] === 'default'),
    loadedAt,
    gateway: {
      published: current.gateway.public?.published === true,
      domain: current.gateway.public?.domain || '',
      relative: current.gateway.public?.relative === true,
    },
  };
}

/** Изхвърля кеша и зарежда правилата наново (без рестарт на add-on-а). */
function reload() {
  cache = null;
  loadedAt = null;
  sources = {};
  config();
  if (apiLog) apiLog.info('rules.reloaded', { ns: 'rules', dirs: ruleDirs().length });
  return status();
}

/** Къде да се копират вградените правила, за да могат да се редактират. */
function defaultSeedDir() {
  const env = String(process.env.HAPI_CONFIG_DIR || '').trim();
  if (env) return env;
  return fs.existsSync('/config') ? CONTAINER_DIR : '';
}

/** Копира липсващите вградени правила в целевата директория (без презапис). */
function seedRules(target) {
  const dir = target === undefined ? defaultSeedDir() : String(target || '');
  if (!dir) return { dir: '', copied: [] };
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const copied = [];
    for (const name of RULE_FILES) {
      const dest = path.join(dir, name);
      const src = path.join(BUNDLED_DIR, name);
      if (fs.existsSync(dest) || !fs.existsSync(src)) continue;
      fs.copyFileSync(src, dest);
      try {
        fs.chmodSync(dest, 0o600);
      } catch { /* chmod не е задължителен на всички файлови системи */ }
      copied.push(name);
    }
    return { dir, copied };
  } catch (e) {
    return { dir, copied: [], error: e.message };
  }
}

// ── Мапинг от legacy модела (portals/files) към gateway модела ─────────────
function portalMode(portal) {
  const explicit = portal && (portal.accessMode || portal.access);
  if (ACC.MODES_BY_ID[explicit]) return explicit;
  return portal && portal.visibility === 'public' ? 'FREE' : 'KEY_REQUIRED';
}

function overrideFor(portal, file, cfg) {
  const list = (cfg.files && cfg.files.rules) || [];
  const name = file && file.name;
  const slug = portal && portal.slug;
  return (
    list.find((r) => r.portal === slug && r.file === name) ||
    list.find((r) => !r.portal && r.file === name) ||
    null
  );
}

function fileModeFor(portal, file, cfg) {
  if (file && ACC.MODES_BY_ID[file.accessMode]) return file.accessMode;
  const rule = overrideFor(portal, file, cfg);
  if (rule && ACC.MODES_BY_ID[rule.access]) return rule.access;
  return portalMode(portal);
}

function portalView(portal, cfgInput) {
  const cfg = cfgInput || config();
  return GW.normalizePortal({
    id: portal.id,
    slug: portal.slug,
    title: portal.title,
    status: portal.status || 'active',
    access: portalMode(portal),
    category: portal.category || '',
    subject: portal.subject || '',
    flag: portal.flag || 'none',
    visibility: portal.visibility === 'public' ? 'public' : 'hidden',
    storage_root: portal.storage_root || '/share',
    html: 'catalog',
  });
}

function fileView(portal, file, cfgInput) {
  const cfg = cfgInput || config();
  const rule = overrideFor(portal, file, cfg);
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    sha256: file.sha256,
    access: fileModeFor(portal, file, cfg),
    visibility: file.listed === false ? 'hidden' : (rule && rule.visibility) || 'public',
    roles: (rule && rule.roles) || [],
    max_downloads: rule && rule.max_downloads != null ? rule.max_downloads : null,
    encrypted: Boolean(file.encrypted),
  };
}

function urlsFor(portalViewInput, cfgInput) {
  const cfg = cfgInput || config();
  const p = GW.normalizePortal(portalViewInput);
  const urls = GW.apiUrls(p, cfg.gateway);
  return { landing: GW.publicUrl(p, cfg.gateway), portal: urls.portal, files: urls.files, qr: urls.qr };
}

function downloadUrlFor(file, cfgInput) {
  const cfg = cfgInput || config();
  return GW.downloadUrl(file, cfg.gateway);
}

/**
 * Решение за достъп до конкретен файл.
 * key/keyOk идват от заявката (нов `X-Portal-Key` или legacy `X-File-Key`).
 */
function decideFile(input) {
  const src = input && typeof input === 'object' ? input : {};
  const cfg = src.cfg || config();
  const portal = portalView(src.portal, cfg);
  const file = fileView(src.portal, src.file, cfg);
  const resolved = GW.resolvePolicy({ portal, file });

  const checks = [];
  if (src.key) {
    const scheme = GW.validatePublicToken(src.key, cfg.gateway);
    // Legacy файлови ключове (fk_…) се приемат само след успешна hash проверка (keyOk).
    const schemeOk = scheme.ok || src.keyOk === true;
    checks.push({ id: 'token-scheme', ok: schemeOk, detail: schemeOk ? '' : scheme.reason });
  }

  const keyAccepted = src.keyOk === true;
  const token = keyAccepted
    ? { id: 'portal-key', uses: Number(src.uses || 0), max_uses: null, expires_at: null, revoked: false }
    : null;

  const decision = ACC.decide({
    policy: resolved.policy,
    visibility: resolved.visibility,
    permission: src.permission || 'files.download',
    now: src.now,
    system: { allow_downloads: src.allowDownloads !== false },
    storage: { available: src.storageAvailable !== false },
    user: src.user || null,
    token,
    session: src.session || {},
    passwordOk: src.passwordOk === true,
  });

  const all = [...checks, ...decision.checks];
  const failed = all.filter((c) => !c.ok);
  return {
    allowed: failed.length === 0,
    reason: failed.length ? failed[0].id : '',
    detail: failed.length ? failed[0].detail : '',
    checks: all,
    mode: decision.mode,
    visibility: resolved.visibility,
    behaviour: decision.behaviour,
    inherited: resolved.inherited,
    portal: portal.slug,
    file: { id: file.id, name: file.name },
    url: downloadUrlFor(file, cfg),
  };
}

// ── Административни отговори ───────────────────────────────────────────────
function exportRulesPayload() {
  const cfg = config();
  return {
    schema_version: R.SCHEMA_VERSION,
    download_rules: cfg.rules,
    export_profiles: cfg.profiles,
    export_permissions: cfg.permissions,
    public_gateway: cfg.gateway,
    access: { levels: ACC.LEVELS, modes: ACC.MODES, default_policy: cfg.access.default_policy },
    tokens: cfg.tokens,
    rate_limits: cfg.rate,
    capabilities: R.capabilities(),
  };
}

/** Валидира конфигурация за експорт и връща план + preflight (без запис на диск). */
function exportPreflight(input) {
  const src = input && typeof input === 'object' ? input : {};
  const cfg = R.normalizeConfig(src.config);
  const plan = R.planPaths(cfg, src.meta);
  const validation = R.validateConfig(cfg);
  const pre = MGR.preflight({ config: cfg, entries: plan.entries, env: src.env });
  return {
    ok: validation.ok && pre.ok,
    packageId: plan.packageId,
    config: cfg,
    entries: plan.entries,
    validation,
    preflight: pre,
    summary: R.summary(cfg).text,
  };
}

module.exports = {
  CONFIG_DIR,
  BUNDLED_DIR,
  RULE_FILES,
  ruleDirs,
  status,
  reload,
  seedRules,
  defaultSeedDir,
  setLogger,
  config,
  readJson,
  portalMode,
  portalView,
  fileView,
  fileModeFor,
  overrideFor,
  urlsFor,
  downloadUrlFor,
  decideFile,
  exportRulesPayload,
  exportPreflight,
};
