'use strict';
// Project-wide Home Assistant compatibility audit.
//
// Unlike the focused unit tests, this one walks the WHOLE repository (add-on, custom
// integration, UI, docs, CI, tests) and checks the invariants a real Supervisor / HA
// installation depends on. It is a detector: every rule reports evidence, blockers
// exit non-zero, warnings are printed but do not fail the suite.
//
// Areas: manifest · image · entrypoint · ingress · Supervisor API · storage ·
//        integration · CI · leftovers (dead code, stale versions, secrets).
//
// The rules encode the official contract:
//   - apps/reference/configuration (config.yaml keys, defaults, deprecations)
//   - apps/guides/ingress (peer allowlist, X-Remote-User-* headers, X-Ingress-Path)
//   - apps/guides/options (options ↔ schema ↔ translations)
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ADDON = 'hapi_enterprise';
const INTEGRATION = 'custom_components/hapi_enterprise';
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.venv', 'archive', 'release', 'coverage', '.vscode', '.idea', '__pycache__', '.pytest_cache']);

// ── File system helpers ─────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}
const allFiles = walk(root);
const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const unquote = (value) => String(value == null ? '' : value).trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

// ── config.yaml: minimal, line-based reader (no YAML dependency) ────────────
const cfgLines = read(`${ADDON}/config.yaml`).split('\n');
function section(name) {
  const start = cfgLines.findIndex((line) => line === `${name}:`);
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < cfgLines.length; i++) {
    if (/^[A-Za-z_]/.test(cfgLines[i])) break;
    out.push(cfgLines[i]);
  }
  return out;
}
function scalar(name) {
  const line = cfgLines.find((l) => l.startsWith(`${name}:`));
  return line === undefined ? undefined : line.slice(name.length + 1).trim();
}
function sectionKeys(name) {
  return section(name)
    .filter((l) => /^ {2}[A-Za-z0-9_/.-]+:/.test(l))
    .map((l) => l.trim().slice(0, l.trim().indexOf(':')));
}
function sectionItems(name) {
  return section(name)
    .filter((l) => /^ {2}- /.test(l))
    .map((l) => l.trim().slice(2).trim().replace(/\s+#.*$/, ''));
}

const docker = read(`${ADDON}/Dockerfile`);
const copyLine = (docker.match(/^COPY\s+(.+?)\s+\/app\/\s*$/m) || [])[1] || '';
const copied = new Set(copyLine.split(/\s+/).filter(Boolean));
const exposed = new Set([...docker.matchAll(/^EXPOSE\s+(.+)$/gm)].flatMap((m) => m[1].trim().split(/\s+/)));
const addonTopJs = fs.readdirSync(path.join(root, ADDON), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.js'))
  .map((e) => e.name);
const entry = read(`${ADDON}/start.js`);
const server = read(`${ADDON}/server.js`);
const rbac = read(`${ADDON}/rbac.js`);
const addonVersion = unquote(scalar('version'));

// ── Rule runner ─────────────────────────────────────────────────────────────
// blocker → exit 1 (bit break: install/build/runtime), warn → report and fail the
// 100% bar, info → advisory only. `info` is used for things Home Assistant explicitly
// accepts but marks (deprecated arch) or only rates (root runtime), so they never
// masquerade as compatibility blockers.
const findings = [];
function need(condition, message) {
  if (!condition) throw new Error(message);
}
function check(id, area, severity, title, fn) {
  try {
    const detail = fn();
    findings.push({ id, area, severity, title, ok: true, detail: detail === undefined ? '' : String(detail) });
  } catch (e) {
    findings.push({ id, area, severity, title, ok: false, detail: e.message });
  }
}

// ── Manifest (config.yaml) ──────────────────────────────────────────────────
const REQUIRED = ['name', 'version', 'slug', 'description', 'arch', 'startup', 'boot', 'init', 'timeout', 'ports', 'ports_description', 'options', 'schema', 'map', 'ingress', 'ingress_port', 'ingress_entry'];

check('HA-M01', 'манифест', 'blocker', 'задължителни ключове на config.yaml', () => {
  const missing = REQUIRED.filter((key) => scalar(key) === undefined && section(key).length === 0);
  need(!missing.length, 'липсват: ' + missing.join(', '));
  return REQUIRED.length + ' ключа';
});

check('HA-M02', 'манифест', 'blocker', 'slug / име / описание / SemVer', () => {
  need(unquote(scalar('slug')) === ADDON, `slug „${scalar('slug')}“ ≠ папка ${ADDON}`);
  need(unquote(scalar('name')).length <= 40, 'name е по-дълго от 40 символа');
  need(unquote(scalar('description')).length <= 255, 'description е по-дълго от 255 символа');
  need(/^\d+\.\d+\.\d+$/.test(addonVersion), `версията „${addonVersion}“ не е SemVer`);
  return `${unquote(scalar('name'))} ${addonVersion}`;
});

check('HA-M03', 'манифест', 'blocker', 'arch е валиден и покрива amd64 + aarch64', () => {
  const arch = sectionItems('arch');
  need(arch.length > 0, 'arch е празен');
  const allowed = new Set(['amd64', 'aarch64', 'armv7', 'armhf', 'i386']);
  const unknown = arch.filter((a) => !allowed.has(a));
  need(!unknown.length, 'непознати arch: ' + unknown.join(', '));
  for (const required of ['amd64', 'aarch64']) need(arch.includes(required), 'липсва ' + required);
  return arch.join('+');
});

check('HA-M04', 'манифест', 'info', 'deprecated arch стойности (приети от Supervisor)', () => {
  const deprecated = sectionItems('arch').filter((a) => ['armv7', 'armhf', 'i386'].includes(a));
  need(!deprecated.length, 'Supervisor ги приема с warning: ' + deprecated.join(', '));
  return 'няма';
});

check('HA-M05', 'манифест', 'blocker', 'всеки порт има описание', () => {
  const ports = sectionKeys('ports');
  need(ports.length > 0, 'няма обявени портове');
  const described = sectionKeys('ports_description');
  const missing = ports.filter((p) => !described.includes(p));
  need(!missing.length, 'без описание: ' + missing.join(', '));
  return ports.join(', ');
});

check('HA-M06', 'манифест', 'blocker', 'map покрива всички използвани пътища', () => {
  const map = sectionItems('map').map((item) => item.split(':')[0]);
  for (const type of ['app_config', 'media', 'share']) need(map.includes(type), 'липсва ' + type);
  need(!map.includes('addon_config'), 'addon_config е deprecated → app_config');
  const docsMentionSsl = /\/ssl\b/.test(read(`${ADDON}/translations/en.yaml`) + read(`${ADDON}/translations/bg.yaml`));
  if (docsMentionSsl) need(map.includes('ssl'), 'документацията обещава /ssl, но map не го монтира');
  return map.join(', ');
});

check('HA-M07', 'манифест', 'blocker', 'watchdog сочи реален health маршрут', () => {
  const watchdog = unquote(scalar('watchdog'));
  need(watchdog, 'липсва watchdog');
  const portMatch = watchdog.match(/\[PORT:(\d+)\]/);
  need(portMatch, 'watchdog без [PORT:...]');
  const port = Number(portMatch[1]);
  need(sectionKeys('ports').some((p) => p.startsWith(`${port}/`)), `порт ${port} не е обявен в ports`);
  need(watchdog.includes('/health'), 'watchdog не сочи /health');
  need(server.includes("url.pathname === '/health'"), '/health не се сервира от server.js');
  return watchdog;
});

check('HA-M08', 'манифест', 'blocker', 'cold backup, timeout, ingress_stream', () => {
  need(unquote(scalar('backup')) === 'cold', 'backup трябва да е cold (WAL SQLite)');
  need(Number(scalar('timeout')) >= 30, 'timeout < 30 секунди');
  need(unquote(scalar('ingress_stream')) === 'true', 'ingress_stream трябва да е true');
  return `cold, ${scalar('timeout')} s, stream`;
});

check('HA-M09', 'манифест', 'blocker', 'homeassistant_api ⇔ употреба на /core/api', () => {
  const usesCore = /supervisor\/core\/api/.test(read(`${ADDON}/notify.js`) + server);
  const declared = unquote(scalar('homeassistant_api')) === 'true';
  need(usesCore === declared, usesCore ? 'кодът ползва /core/api, но homeassistant_api не е true' : 'homeassistant_api е true без реална употреба');
  return declared ? 'true' : 'false';
});

check('HA-M10', 'манифест', 'blocker', 'hassio_api само при директен Supervisor API', () => {
  const usesSupervisor = /['"`]http:\/\/supervisor\/(?!core\/)/.test(read(`${ADDON}/notify.js`) + server);
  const declared = unquote(scalar('hassio_api')) === 'true';
  need(usesSupervisor === declared, 'hassio_api и реалната употреба се разминават');
  return declared ? 'true' : 'false';
});

check('HA-M11', 'манифест', 'warn', 'environment не дублира entrypoint стойности', () => {
  const env = section('environment').filter((l) => /^ {2}[A-Z_]+:/.test(l)).map((l) => l.trim());
  need(!env.some((l) => l.startsWith('DATA_DIR:')), 'DATA_DIR в environment се презаписва от start.js → подвеждащо');
  return env.length + ' променливи';
});

check('HA-M12', 'манифест', 'blocker', 'options ↔ schema ↔ translations', () => {
  const options = sectionKeys('options');
  const schema = sectionKeys('schema');
  const noSchema = options.filter((k) => !schema.includes(k));
  const noOption = schema.filter((k) => !options.includes(k));
  need(!noSchema.length, 'без schema: ' + noSchema.join(', '));
  need(!noOption.length, 'без option: ' + noOption.join(', '));
  for (const lang of ['en', 'bg']) {
    const text = read(`${ADDON}/translations/${lang}.yaml`);
    const missing = options.filter((k) => !new RegExp(`^ {2}${k}:$`, 'm').test(text));
    need(!missing.length, `${lang}.yaml не покрива: ` + missing.join(', '));
  }
  return options.length + ' опции';
});

// ── Image / build ───────────────────────────────────────────────────────────
check('HA-C01', 'образ', 'blocker', 'фиксиран Node + node:sqlite gate', () => {
  const from = (docker.match(/^FROM\s+(\S+)/m) || [])[1];
  need(/^node:22\.\d+\.\d+-alpine/.test(from || ''), 'FROM не е фиксиран node:22-alpine');
  need(!/apk add[^\n]*nodejs/.test(docker), 'Node се инсталира през apk');
  need(/node:sqlite/.test(docker), 'липсва build gate за node:sqlite');
  return from;
});

check('HA-C02', 'образ', 'blocker', 'entrypoint е JavaScript, без shell', () => {
  need(/^CMD \["node", "\/app\/start\.js"\]$/m.test(docker), 'CMD не е node /app/start.js');
  need(!/^RUN[^\n]*chmod/m.test(docker), 'Dockerfile прави chmod (не е нужен за JS entrypoint)');
  const shell = walk(path.join(root, ADDON)).filter((f) => f.endsWith('.sh')).map(rel);
  need(!shell.length, 'shell файлове в add-on: ' + shell.join(', '));
  return 'node /app/start.js';
});

check('HA-C03', 'образ', 'blocker', 'EXPOSE покрива обявените портове', () => {
  const declared = sectionKeys('ports').map((p) => Number(p.split('/')[0]));
  const missing = declared.filter((p) => !exposed.has(String(p)));
  need(!missing.length, 'EXPOSE без ' + missing.join(', '));
  return [...exposed].sort().join(' ');
});

check('HA-C04', 'образ', 'blocker', 'COPY покрива всички top-level модули', () => {
  const notCopied = new Set(['standalone.js']); // Windows edge bootstrap, не влиза в образа
  const missing = addonTopJs.filter((f) => !copied.has(f) && !notCopied.has(f));
  need(!missing.length, 'не се копират: ' + missing.join(', '));
  return addonTopJs.length + ' модула';
});

check('HA-C05', 'образ', 'warn', '.dockerignore ограничава контекста', () => {
  need(exists(`${ADDON}/.dockerignore`), 'липсва hapi_enterprise/.dockerignore');
  return '.dockerignore';
});

check('HA-C06', 'образ', 'info', 'не-root и AppArmor профил (security rating)', () => {
  const nonRoot = /^USER\s+\S+/m.test(docker);
  const apparmor = exists(`${ADDON}/apparmor.txt`);
  need(nonRoot && apparmor, 'root без apparmor.txt: HA го приема, но security rating е по-нисък');
  return 'USER + apparmor';
});

// ── Entrypoint ──────────────────────────────────────────────────────────────
check('HA-E01', 'entrypoint', 'blocker', 'Node/SQLite гейт преди старт', () => {
  need(/nodeMajor\s*<\s*22/.test(entry) && /nodeMinor\s*<\s*13/.test(entry), 'липсва Node ≥ 22.13 гейт');
  need(/node:sqlite/.test(entry), 'липсва проверка за node:sqlite');
  need(entry.indexOf('node:sqlite') < entry.indexOf('spawn(process.execPath'), 'гейтът е след старта на сървъра');
  return 'Node ≥ 22.13';
});

check('HA-E02', 'entrypoint', 'blocker', 'ADMIN_TOKEN: файл 0600, без печат', () => {
  need(/mode: 0o600/.test(entry), 'токенът не се записва с права 0600');
  need(/admin-token/.test(entry), 'липсва постоянен файл admin-token');
  need(!/console\.(log|info)\([^)]*ADMIN_TOKEN/.test(entry), 'entrypoint-ът печата ADMIN_TOKEN');
  return '0600, не се печата';
});

check('HA-E03', 'entrypoint', 'blocker', 'storage preflight преди старт', () => {
  need(/storagePreflight/.test(entry), 'липсва storage preflight');
  need(entry.indexOf('storagePreflight.check') < entry.indexOf('spawn(process.execPath'), 'preflight е след старта');
  need(/env\.DATA_DIR\s*=/.test(entry), 'DATA_DIR не идва от preflight');
  return 'fail-closed';
});

// ── Ingress ─────────────────────────────────────────────────────────────────
check('HA-I01', 'ingress', 'blocker', 'идентичност от истинските HA заглавки', () => {
  need(/x-remote-user-name/.test(rbac) && /x-remote-user-id/.test(rbac), 'rbac не чете X-Remote-User-Name/-Id');
  need(/x-remote-user-display-name/.test(rbac), 'липсва X-Remote-User-Display-Name');
  need(!/const user=String\(req\.headers\['x-remote-user'\]/.test(rbac), 'разчита само на X-Remote-User');
  return 'Name / Id / DisplayName';
});

check('HA-I02', 'ingress', 'blocker', 'peer allowlist на admin listener-а', () => {
  need(/adminPeers/.test(server), 'липсва adminPeers');
  need(/adminPeers\.has\(peer\)/.test(server), 'няма проверка на peer');
  need(/172\.30\.32\.2/.test(server), 'липсва Supervisor peer по подразбиране');
  need(/fail\(res, 403, 'Forbidden'\)/.test(server), 'няма 403 за чужд peer');
  return 'Supervisor + loopback';
});

check('HA-I03', 'ingress', 'blocker', 'X-Ingress-Path се обработва', () => {
  need(/x-ingress-path/.test(server), 'липсва X-Ingress-Path');
  need(/hassio_ingress/.test(server), 'липсва ingress префикс');
  return 'prefix stripping';
});

check('HA-I04', 'ingress', 'blocker', 'относителни asset URL в ingress HTML', () => {
  for (const file of [`${ADDON}/admin.html`, `${ADDON}/ui/index.html`]) {
    const html = read(file);
    const absolute = [...html.matchAll(/\b(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);
    need(!absolute.length, `${file} има абсолютни пътища: ${absolute.join(', ')}`);
  }
  return 'admin.html, ui/index.html';
});

check('HA-I05', 'ingress', 'blocker', 'CSP съответства на HTML', () => {
  const withInlineStyle = [`${ADDON}/admin.html`, `${ADDON}/ui/index.html`].filter((f) => /<style[\s>]|style="/.test(read(f)));
  if (withInlineStyle.length) need(/style-src 'unsafe-inline'/.test(server), 'inline стилове без style-src unsafe-inline');
  need(!/<style[\s>]|style="/.test(read(`${ADDON}/portal.html`)), 'portal.html има inline стилове, а CSP е style-src self');
  return withInlineStyle.length ? 'unsafe-inline където е нужно' : 'стриктно';
});

// ── Supervisor API ──────────────────────────────────────────────────────────
check('HA-S01', 'supervisor', 'blocker', 'notify през /core/api/services', () => {
  const notify = read(`${ADDON}/notify.js`);
  need(/http:\/\/supervisor\/core\/api\/services/.test(notify), 'endpoint не е /core/api/services');
  need(/SUPERVISOR_TOKEN/.test(notify), 'липсва SUPERVISOR_TOKEN');
  need(/SERVICE_RE/.test(notify), 'липсва allowlist за име на услуга');
  return 'domain.service allowlist';
});

check('HA-S02', 'supervisor', 'warn', 'няма друг hardcoded supervisor адрес', () => {
  const offenders = allFiles
    .filter((f) => f.startsWith(path.join(root, ADDON)) && /\.(js|cjs)$/.test(f))
    .filter((f) => /https?:\/\/supervisor\/(?!core\/api)/.test(fs.readFileSync(f, 'utf8')))
    .map(rel);
  need(!offenders.length, 'директни supervisor URL: ' + offenders.join(', '));
  return 'само /core/api';
});

// ── Storage ─────────────────────────────────────────────────────────────────
check('HA-T01', 'съхранение', 'blocker', 'публичните портали са само /share и /media', () => {
  need(server.includes('(share|media)'), 'portalRoot не ограничава до /share и /media');
  need(!/storage_root[\s\S]{0,200}\/config/.test(server), 'storage_root допуска /config');
  return 'portalRoot';
});

check('HA-T02', 'съхранение', 'warn', 'allowlist-ите сочат само монтирани пътища', () => {
  const mapRoots = { app_config: '/config', media: '/media', share: '/share', ssl: '/ssl', backup: '/backup' };
  const mounted = new Set(['/data']);
  for (const item of sectionItems('map')) if (mapRoots[item.split(':')[0]]) mounted.add(mapRoots[item.split(':')[0]]);
  const referenced = [...new Set([...server.matchAll(/'(\/(?:share|media|backup|config|addon_config|data|ssl))'/g)].map((m) => m[1]))];
  const stray = referenced.filter((r) => !mounted.has(r));
  need(!stray.length, 'кодът приема немонтирани пътища: ' + stray.join(', '));
  return referenced.join(' ');
});

check('HA-T03', 'съхранение', 'blocker', 'preflight отказва symlink / непразна папка / недостиг', () => {
  const preflight = read(`${ADDON}/storage-preflight.js`);
  need(/isSymbolicLink/.test(preflight), 'няма проверка за symlink');
  need(/portal-enterprise-storage/.test(preflight), 'липсва маркер на хранилището');
  need(/Insufficient free storage space/.test(preflight), 'липсва проверка за свободно място');
  return 'symlink + marker + free space';
});

// ── Custom integration ──────────────────────────────────────────────────────
const manifest = JSON.parse(read(`${INTEGRATION}/manifest.json`));

check('HA-X01', 'интеграция', 'blocker', 'domain и версия съвпадат с add-on-а', () => {
  const folder = path.basename(INTEGRATION);
  need(manifest.domain === folder, `domain „${manifest.domain}“ ≠ папка „${folder}“`);
  need(manifest.version === addonVersion, `версия ${manifest.version} ≠ ${addonVersion}`);
  return `${folder} ${manifest.version}`;
});

check('HA-X02', 'интеграция', 'blocker', 'manifest.json е валиден за HA', () => {
  need(Array.isArray(manifest.dependencies) && manifest.dependencies.includes('http'), 'липсва dependencies: ["http"]');
  need(Array.isArray(manifest.requirements) && manifest.requirements.length === 0, 'requirements трябва да е празен');
  need(manifest.config_flow === true, 'config_flow не е true');
  need(['local_polling', 'local_push', 'cloud_polling'].includes(manifest.iot_class), 'невалиден iot_class');
  need(typeof manifest.codeowners === 'object' && manifest.codeowners.length > 0, 'липсва codeowners');
  return manifest.iot_class;
});

check('HA-X03', 'интеграция', 'blocker', 'hacs.json е коректен', () => {
  const hacs = JSON.parse(read('hacs.json'));
  need(hacs.content_in_root === false, 'content_in_root трябва да е false');
  need(!('domains' in hacs), 'domains не е валиден ключ за hacs.json (HACS го отхвърля)');
  const addonMin = unquote(scalar('homeassistant'));
  need(hacs.homeassistant === addonMin, `HACS минимум ${hacs.homeassistant} ≠ add-on ${addonMin}`);
  return hacs.homeassistant;
});

check('HA-X04', 'интеграция', 'blocker', 'runtime преводи на интеграцията', () => {
  need(exists(`${INTEGRATION}/translations/en.json`), 'липсва translations/en.json (HA чете него)');
  need(exists(`${INTEGRATION}/strings.json`), 'липсва strings.json');
  return 'en.json + strings.json';
});

check('HA-X05', 'интеграция', 'blocker', 'мостът не проксира административни API', () => {
  const py = read(`${INTEGRATION}/__init__.py`);
  need(!/backend\s*\+\s*["']\/admin/.test(py), 'мостът сочи /admin');
  need(/requires_auth = False/.test(py), 'липсва изрично requires_auth = False');
  need(/_ALLOWED\.fullmatch/.test(py), 'липсва allowlist на пътя');
  return 'fail-closed';
});

// ── CI ──────────────────────────────────────────────────────────────────────
check('HA-K01', 'CI', 'blocker', 'всяка обявена архитектура се билдва', () => {
  const ci = read('.github/workflows/ci.yml');
  need(/home-assistant\/builder/.test(ci), 'не се ползва home-assistant/builder');
  const matrix = (ci.match(/arch:\s*\[([^\]]+)\]/) || [])[1] || '';
  const built = matrix.split(',').map((s) => s.trim()).filter(Boolean);
  const missing = sectionItems('arch').filter((a) => !built.includes(a));
  need(!missing.length, 'не се билдват: ' + missing.join(', '));
  return built.join('+');
});

check('HA-K02', 'CI', 'warn', 'HACS валидация в CI', () => {
  need(/hacs\/action/.test(read('.github/workflows/hacs.yml')), 'липсва hacs/action');
  return 'hacs/action';
});

// ── Leftovers ───────────────────────────────────────────────────────────────
check('HA-L01', 'остатъци', 'blocker', 'няма shell entrypoint и run.sh', () => {
  const shell = walk(path.join(root, ADDON)).filter((f) => f.endsWith('.sh')).map(rel);
  need(!shell.length, 'shell файлове: ' + shell.join(', '));
  need(!/exec\s+node\s+\/app\/run\.sh|CMD\s+\["\/app\/run\.sh"\]/.test(docker), 'Dockerfile още изпълнява run.sh');
  return 'няма';
});

check('HA-L02', 'остатъци', 'warn', 'няма мъртви модули в add-on-а', () => {
  const jsFiles = walk(path.join(root, ADDON)).filter((f) => f.endsWith('.js'));
  // Референция може да дойде и от тест (`tests/core-plugins.cjs` зарежда plugins/*),
  // затова корпусът е целият JS/HTML в репото, а не само add-on-ът.
  const corpus = allFiles
    .filter((f) => /\.(js|cjs|mjs|html)$/.test(f))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');
  const dead = jsFiles
    .map((f) => path.relative(path.join(root, ADDON), f).split(path.sep).join('/'))
    .filter((f) => f.includes('/') && !f.startsWith('ui/'))
    // require('../hapi_enterprise/plugins/ocr') може да е без разширение — търсим и двете.
    .filter((f) => !corpus.includes(f.replace(/\.js$/, '')) && !corpus.includes(path.basename(f)));
  need(!dead.length, 'нереференсирани модули: ' + dead.join(', '));
  return jsFiles.length + ' JS файла';
});

check('HA-L03', 'остатъци', 'warn', 'няма TODO/FIXME в runtime кода', () => {
  const offenders = walk(path.join(root, ADDON))
    .filter((f) => /\.(js|html|css)$/.test(f))
    .filter((f) => /\b(TODO|FIXME|HACK|XXX)\b/.test(fs.readFileSync(f, 'utf8')))
    .map(rel);
  need(!offenders.length, 'маркери в: ' + offenders.join(', '));
  return 'чисто';
});

check('HA-L04', 'остатъци', 'blocker', 'няма тайни в хранилището', () => {
  const patterns = [/gh[pousr]_[A-Za-z0-9]{20,}/, /\bsk-[A-Za-z0-9]{20,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
  const text = allFiles.filter((f) => /\.(js|cjs|mjs|json|md|ya?ml|html|css|sh|ps1|bat|py|txt)$/i.test(f));
  const offenders = text.filter((f) => {
    const content = fs.readFileSync(f, 'utf8');
    return patterns.some((p) => p.test(content));
  }).map(rel);
  need(!offenders.length, 'възможни тайни: ' + offenders.join(', '));
  return text.length + ' текстови файла';
});

check('HA-L05', 'остатъци', 'blocker', 'версията е една навсякъде', () => {
  const escaped = addonVersion.replace(/\./g, '\\.');
  need(new RegExp(`window\\.HAPI_VERSION\\s*=\\s*'${escaped}'`).test(read(`${ADDON}/ui/data.js`)), 'ui/data.js не е ' + addonVersion);
  for (const doc of ['README.md', 'BG.md', 'DE.md', `${ADDON}/README.md`]) {
    need(read(doc).includes(`version-${addonVersion}-`), `${doc}: баджът не е ${addonVersion}`);
  }
  return addonVersion;
});

check('HA-L06', 'остатъци', 'warn', 'няма временни файлове и неигнорирани архиви', () => {
  const temp = fs.readdirSync(root).filter((n) => /^tmp-/.test(n));
  need(!temp.length, 'временни файлове в корена: ' + temp.join(', '));
  const ignored = read('.gitignore');
  for (const ext of ['7z', 'zip']) need(new RegExp(`^\\*\\.${ext}$`, 'm').test(ignored), `.gitignore не изключва *.${ext} (локалните архиви влизат в репото)`);
  return 'чисто';
});

// ── Report ──────────────────────────────────────────────────────────────────
const blockers = findings.filter((f) => !f.ok && f.severity === 'blocker');
const warnings = findings.filter((f) => !f.ok && f.severity === 'warn');
const infos = findings.filter((f) => !f.ok && f.severity === 'info');
const relevant = findings.filter((f) => f.severity !== 'info');
const passed = relevant.filter((f) => f.ok);
const mark = (f) => (f.ok ? '✔' : f.severity === 'blocker' ? '✘' : f.severity === 'warn' ? '⚠' : 'ℹ');

console.log(`Home Assistant compatibility audit — ${unquote(scalar('name'))} ${addonVersion}`);
for (const f of findings) console.log(`  ${mark(f)} ${f.id} ${f.title.padEnd(50)} ${f.detail}`);
console.log(`\n${passed.length}/${relevant.length} правила · ${warnings.length} предупреждения · ${blockers.length} блокера · ${infos.length} забележки (info)`);
if (!blockers.length && !warnings.length) console.log('Съвместимост: 100% (забележките не са несъвместимости — HA ги приема).');

if (blockers.length) {
  console.log('\nНесъвместимости (blocker):');
  for (const f of blockers) console.log(`  ${f.id} [${f.area}] ${f.title} → ${f.detail}`);
  process.exit(1);
}
