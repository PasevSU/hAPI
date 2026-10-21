'use strict';
// Проверка на изданието за Home Assistant — всички сценарии на едно място.
//
//   node scripts/verify-release.cjs               # проверява dist/ (след build)
//   node scripts/verify-release.cjs --with-tests  # + целия тестов набор
//   node scripts/verify-release.cjs --dist other  # друга папка с артефакти
//
// Сценарии: версия, add-on схема, файлове, Dockerfile, синтаксис (JS/Python),
// интеграция, архиви, манифест на изданието, тайни, портални активи, start.js,
// опции↔схема, repository.yaml, документация, хигиена на архива, четене със
// системен tar, (по избор) пълния тестов набор.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const lib = require('./release-lib.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);
const option = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
};

const root = lib.ROOT;
const distDir = path.join(root, option('dist') || lib.DIST_DIR);
const addonDir = path.join(root, lib.ADDON_DIR);
const integrationDir = path.join(root, lib.INTEGRATION_DIR);

const results = [];
const pending = [];
function check(id, title, fn) {
  const t0 = Date.now();
  const done = (ok, detail) => results.push({ id, title, ok, detail: detail === undefined ? '' : String(detail), ms: Date.now() - t0 });
  try {
    const detail = fn();
    if (detail && typeof detail.then === 'function') {
      // Асинхронните сценарии (напр. стартиране от архива) се изчакват преди отчета.
      pending.push(detail.then((value) => done(true, value), (error) => done(false, error.message)));
      return;
    }
    done(true, detail);
  } catch (error) {
    done(false, error.message);
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

// ── Помощни четци ────────────────────────────────────────────────────────────
/** Минимален YAML четец за контролираните от нас файлове (скалари, вложени карти, списъци). */
function parseYaml(text) {
  const lines = text.split(/\r?\n/);
  const result = {};
  const stack = [{ indent: -1, container: result }];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    i++;
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const top = stack[stack.length - 1];
    if (trimmed.startsWith('- ')) {
      if (Array.isArray(top.container)) top.container.push(scalar(trimmed.slice(2)));
      continue;
    }
    const m = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = unquote(m[1].trim());
    const rest = m[2].trim();
    if (rest !== '') {
      top.container[key] = scalar(rest);
      continue;
    }
    // Празна стойност: следващият смислен ред решава дали детето е списък или карта.
    let j = i;
    while (j < lines.length && (!lines[j].trim() || lines[j].trim().startsWith('#'))) j++;
    const child = j < lines.length && lines[j].trim().startsWith('- ') ? [] : {};
    top.container[key] = child;
    stack.push({ indent, container: child });
  }
  return result;
}

const unquote = (value) => String(value).replace(/^["']|["']$/g, '');

function scalar(value) {
  const s = String(value).replace(/\s+#.*$/, '').trim();
  if (/^".*"$/.test(s) || /^'.*'$/.test(s)) return s.slice(1, -1);
  if (s === 'null' || s === '~' || s === '') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

const readText = (file) => fs.readFileSync(file, 'utf8');
// Само текстовите файлове се сканират за тайни — шрифтовете и иконите се пропускат.
const isText = (name) => /\.(js|cjs|mjs|json|html|css|sh|txt|md|yaml|yml|py)$/i.test(name);

// ── S01. Версия ──────────────────────────────────────────────────────────────
check('S01', 'Версия: един източник на истина', () => {
  const addonVersion = lib.readAddonVersion(root);
  const integrationVersion = lib.readIntegrationVersion(root);
  assert(lib.SEMVER.test(addonVersion), `config.yaml: „${addonVersion}“ не е SemVer`);
  assert(
    integrationVersion === addonVersion,
    `add-on ${addonVersion} ≠ интеграция ${integrationVersion} — пусни scripts/build-release.cjs --version ${addonVersion}`,
  );
  const tag = option('expect-version');
  if (tag) assert(addonVersion === tag, `очаквана версия ${tag}, намерена ${addonVersion}`);
  return `${addonVersion} (add-on + интеграция)`;
});

// ── S02. Add-on схема (изисквания на Home Assistant Supervisor) ──────────────
const addonConfig = parseYaml(readText(path.join(addonDir, 'config.yaml')));
check('S02', 'Add-on: config.yaml отговаря на схемата на Supervisor', () => {
  const required = ['name', 'version', 'slug', 'description', 'arch', 'startup', 'boot', 'ingress', 'ingress_port', 'ingress_entry', 'ports', 'ports_description', 'options', 'schema', 'map'];
  for (const key of required) assert(addonConfig[key] !== undefined, `липсва задължително поле „${key}“`);
  assert(Array.isArray(addonConfig.arch) && addonConfig.arch.length >= 2, 'arch трябва да съдържа поне amd64 и aarch64');
  assert(/^[a-z0-9_-]+$/.test(addonConfig.slug), `невалиден slug „${addonConfig.slug}“`);
  assert(addonConfig.slug === 'hapi_enterprise', 'slug трябва да съвпада с папката на add-on-а');
  assert(addonConfig.name.length <= 40, 'name е твърде дълго за UI на Supervisor');
  assert(String(addonConfig.description).length <= 255, 'description е по-дълго от 255 знака');
  assert(addonConfig.ingress === true, 'ingress трябва да е true (панелът се отваря през Home Assistant)');
  assert(Number.isInteger(addonConfig.ingress_port), 'ingress_port трябва да е число');
  assert(String(addonConfig.ingress_entry).startsWith('/'), 'ingress_entry трябва да започва с /');
  assert(['application', 'services', 'once', 'disabled'].includes(String(addonConfig.startup)), 'невалиден startup');
  assert(['auto', 'manual'].includes(String(addonConfig.boot)), 'невалиден boot');
  for (const port of Object.keys(addonConfig.ports || {})) {
    assert(/^\d+\/tcp$/.test(port), `невалиден порт „${port}“ (очаква се NNNN/tcp)`);
    assert(Object.hasOwn(addonConfig.ports_description || {}, port), `порт ${port} няма описание в ports_description`);
  }
  assert(Array.isArray(addonConfig.map) && addonConfig.map.length > 0, 'map трябва да е непразен списък');
  return `${addonConfig.name} ${addonConfig.version} · ingress ${addonConfig.ingress_port} · ${Object.keys(addonConfig.ports).length} порта`;
});

// ── S03. Задължителни файлове на add-on-а ───────────────────────────────────
check('S03', 'Add-on: всички файлове за стартиране са налице', () => {
  const required = [
    'config.yaml',
    'Dockerfile',
    'start.js',
    'server.js',
    'logger.js',
    'rules/download_rules.json',
    'rules/public_gateway.json',
    'portal.html',
    'portal.js',
    'portal.css',
    'qrcode.js',
    'runtime-config.js',
    'storage-preflight.js',
    'admin.html',
    'admin.js',
    'ui/index.html',
    'ui/app.js',
    'ui/styles.css',
    'icon.png',
    'logo.png',
    'fonts/DejaVuSans.ttf',
  ];
  const missing = required.filter((f) => !fs.existsSync(path.join(addonDir, f)));
  assert(missing.length === 0, 'липсват: ' + missing.join(', '));
  const icon = fs.statSync(path.join(addonDir, 'icon.png')).size;
  const logo = fs.statSync(path.join(addonDir, 'logo.png')).size;
  assert(icon > 512 && logo > 512, 'icon.png/logo.png са празни');
  return `${required.length} файла, икони ${lib.fmtBytes(icon)}/${lib.fmtBytes(logo)}`;
});

// ── S04. Dockerfile покрива всички модули ───────────────────────────────────
check('S04', 'Dockerfile: COPY покрива всички локални модули', () => {
  const docker = readText(path.join(addonDir, 'Dockerfile'));
  assert(/^FROM\s+node:22\.\d+\.\d+-alpine/m.test(docker), 'FROM трябва да е фиксиран node:22.x-alpine');
  assert(!/apk add[^\n]*nodejs/.test(docker), 'Node не се инсталира през apk — базата го носи');
  assert(/node:sqlite/.test(docker), 'Dockerfile не проверява node:sqlite при build');
  assert(/^EXPOSE\s+.*8098/m.test(docker) && /8099/.test(docker), 'EXPOSE трябва да включва 8098 и 8099');
  assert(/^CMD\s+\["node",\s*"\/app\/start\.js"\]/m.test(docker), 'CMD трябва да стартира node /app/start.js');
  assert(/^COPY\s+fonts\s+\/app\/fonts\/$/m.test(docker), 'липсва COPY на шрифтовете');
  const copyLine = (docker.match(/^COPY\s+(.+?)\s+\/app\/\s*$/m) || [])[1] || '';
  const copied = new Set(copyLine.split(/\s+/).filter(Boolean));
  // Транзитивно: всичко, което server.js изисква локално, трябва да е в COPY.
  const seen = new Set();
  const queue = ['server.js'];
  while (queue.length) {
    const name = queue.pop();
    let text;
    try {
      text = readText(path.join(addonDir, name));
    } catch {
      continue;
    }
    for (const m of text.matchAll(/require\('\.\/([a-z0-9-]+)(?:\.js)?'\)/g)) {
      const mod = m[1] + '.js';
      if (seen.has(mod)) continue;
      seen.add(mod);
      assert(copied.has(mod), 'Dockerfile COPY липсва ' + mod);
      queue.push(mod);
    }
  }
  assert(seen.size >= 25, 'открити са само ' + seen.size + ' локални модула — очакват се поне 25');
  return `${copied.size} записа в COPY, ${seen.size} локални модула проверени`;
});

// ── S05. Синтаксис на JavaScript ────────────────────────────────────────────
check('S05', 'Синтаксис: всеки JS файл се компилира', () => {
  const files = [...lib.walk(addonDir, '').map((e) => e.abs), ...lib.walk(integrationDir, '').map((e) => e.abs)].filter((f) => /\.(js|cjs|mjs)$/.test(f));
  const broken = [];
  for (const file of files) {
    try {
      new vm.Script(readText(file), { filename: file });
    } catch (error) {
      broken.push(path.relative(root, file) + ': ' + error.message);
    }
  }
  assert(broken.length === 0, 'синтактични грешки:\n  ' + broken.join('\n  '));
  return files.length + ' файла';
});

// ── S06. Синтаксис на Python (интеграцията) ─────────────────────────────────
check('S06', 'Синтаксис: интеграцията (Python) е валидна', () => {
  const files = fs
    .readdirSync(integrationDir)
    .filter((name) => name.endsWith('.py'))
    .sort()
    .map((name) => path.join(integrationDir, name));
  const runs = files.map((file) => ({
    file,
    run: ['python3', 'python']
      .map((bin) => spawnSync(bin, ['-c', 'import ast,sys;ast.parse(open(sys.argv[1],encoding="utf-8").read())', file]))
      .find((r) => r.status === 0),
  }));
  const pythonMissing = runs.every((item) => !item.run);
  if (pythonMissing) {
    const source = readText(path.join(integrationDir, '__init__.py'));
    for (const needle of ['async def async_setup', 'async_register_static_paths', 'DOMAIN']) {
      assert(source.includes(needle), 'липсва ' + needle);
    }
    return 'структурна проверка (Python не е наличен)';
  }
  for (const { file, run } of runs) {
    if (!run) throw new Error('ast.parse се провали: ' + path.basename(file));
  }
  return files.length + ' Python модула';
});

// ── S07. Манифест на custom интеграцията ────────────────────────────────────
check('S07', 'Интеграция: manifest.json е валиден за Home Assistant', () => {
  const manifest = JSON.parse(readText(path.join(integrationDir, 'manifest.json')));
  assert(manifest.domain === 'hapi_enterprise', 'domain трябва да е hapi_enterprise');
  assert(path.basename(integrationDir) === manifest.domain, 'папката трябва да носи името на domain');
  for (const key of ['name', 'version', 'documentation', 'requirements', 'dependencies', 'iot_class']) {
    assert(manifest[key] !== undefined, 'липсва ' + key);
  }
  assert(Array.isArray(manifest.requirements), 'requirements трябва да е масив');
  assert(manifest.requirements.length === 0, 'интеграцията не бива да тегли Python пакети');
  assert(manifest.dependencies.includes('http'), 'dependencies трябва да включва http');
  assert(
    ['local_polling', 'local_push', 'cloud_polling', 'assumed_state', 'calculated'].includes(manifest.iot_class),
    'невалиден iot_class: ' + manifest.iot_class,
  );
  assert(manifest.version === lib.readAddonVersion(root), 'версията на интеграцията се разминава с add-on-а');
  assert(/^https?:\/\//.test(manifest.documentation), 'documentation трябва да е URL');
  // UI настройка (config/options flow): файловете трябва да са налични и в архива.
  if (manifest.config_flow === true) {
    for (const rel of ['config_flow.py', 'coordinator.py', 'sensor.py', 'const.py', 'strings.json', 'translations/en.json']) {
      assert(fs.existsSync(path.join(integrationDir, rel)), 'config_flow: липсва ' + rel);
    }
    assert(!manifest.dependencies.includes('recorder'), 'сензорите не изискват recorder');
  }
  return `${manifest.name} ${manifest.version} · ${manifest.iot_class}${manifest.config_flow ? ' · UI setup' : ''}`;
});

// ── S08–S10. Артефакти ──────────────────────────────────────────────────────
const version = lib.readAddonVersion(root);
const addonArchive = path.join(distDir, `hapi_enterprise-${version}.tar.gz`);
const integrationArchive = path.join(distDir, `hapi_enterprise-integration-${version}.zip`);
const releaseJson = path.join(distDir, 'RELEASE.json');
const sumsFile = path.join(distDir, 'SHA256SUMS.txt');

const archived = (file) => {
  assert(fs.existsSync(file), 'липсва ' + path.relative(root, file) + ' — пусни node scripts/build-release.cjs');
  // Запис, който излиза извън папката, не бива да влиза в издание: распаковането му пише навън.
  return lib.assertSafeEntryPaths(lib.readArchive(fs.readFileSync(file), file), path.basename(file));
};

check('S08', 'Артефакт: add-on tar.gz съдържа точно файловете от дървото', () => {
  const entries = archived(addonArchive);
  const actual = new Map(entries.map((e) => [e.path, e]));
  const expected = lib.walk(addonDir, lib.ADDON_DIR);
  assert(actual.size === expected.length, `архивът има ${actual.size} файла, дървото ${expected.length}`);
  for (const entry of expected) {
    const got = actual.get(entry.path);
    assert(got, 'липсва в архива: ' + entry.path);
    assert(lib.sha256(got.data) === lib.sha256(fs.readFileSync(entry.abs)), 'съдържанието се разминава: ' + entry.path);
  }
  const startEntry = actual.get(lib.ADDON_DIR + '/start.js');
  assert(startEntry, 'липсва start.js — entrypoint-ът на add-on-а е JavaScript, не shell');
  assert(!actual.has(lib.ADDON_DIR + '/run.sh'), 'run.sh не бива да се връща: entrypoint-ът е start.js');
  return `${entries.length} файла, ${lib.fmtBytes(fs.statSync(addonArchive).size)}`;
});

check('S09', 'Артефакт: интеграцията zip съдържа точно файловете от дървото', () => {
  const entries = archived(integrationArchive);
  const actual = new Map(entries.map((e) => [e.path, e]));
  const expected = lib.walk(integrationDir, path.posix.join('custom_components', 'hapi_enterprise'));
  assert(actual.size === expected.length, `архивът има ${actual.size} файла, дървото ${expected.length}`);
  for (const entry of expected) {
    const got = actual.get(entry.path);
    assert(got, 'липсва в архива: ' + entry.path);
    assert(lib.sha256(got.data) === lib.sha256(fs.readFileSync(entry.abs)), 'съдържанието се разминава: ' + entry.path);
  }
  assert(actual.has('custom_components/hapi_enterprise/manifest.json'), 'липсва manifest.json в архива');
  return `${entries.length} файла, ${lib.fmtBytes(fs.statSync(integrationArchive).size)}`;
});

check('S10', 'Манифест на изданието и контролни суми', () => {
  const release = JSON.parse(readText(releaseJson));
  assert(release.version === version, `RELEASE.json е за ${release.version}, дървото е ${version}`);
  assert(release.schema === 2, 'непозната схема на RELEASE.json');
  assert(release.addon.sha256 === lib.sha256File(addonArchive), 'sha256 на add-on архива се разминава');
  assert(release.integration.sha256 === lib.sha256File(integrationArchive), 'sha256 на интеграцията се разминава');
  const sums = readText(sumsFile)
    .trim()
    .split('\n')
    .map((line) => line.match(/^([a-f0-9]{64})\s{2}(.+)$/))
    .filter(Boolean);
  assert(sums.length >= 4, 'SHA256SUMS.txt трябва да покрива поне 4 артефакта');
  for (const [, hash, name] of sums) {
    const file = path.join(distDir, name);
    assert(fs.existsSync(file), 'SHA256SUMS сочи липсващ файл: ' + name);
    assert(lib.sha256File(file) === hash, 'контролната сума не съвпада: ' + name);
  }
  return `${sums.length} артефакта с валидни суми`;
});

// ── S11. Тайни ──────────────────────────────────────────────────────────────
check('S11', 'Сигурност: няма тайни и вътрешни адреси в изданието', () => {
  const patterns = [
    [/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/, 'частен ключ'],
    [/eyJhbGciOi[A-Za-z0-9_-]{10,}/, 'HA дълготраен JWT'],
    [/SUPERVISOR_TOKEN\s*=\s*\S+/, 'Supervisor токен'],
    [/hapi_[A-Za-z0-9]{16,}/, 'издаден API ключ'],
  ];
  const offenders = [];
  for (const file of [addonArchive, integrationArchive]) {
    for (const entry of archived(file)) {
      if (!isText(entry.path)) continue;
      const text = entry.data.toString('utf8');
      for (const [re, label] of patterns) {
        if (re.test(text)) offenders.push(`${path.basename(file)}:${entry.path} → ${label}`);
      }
    }
  }
  assert(offenders.length === 0, 'намерени тайни:\n  ' + offenders.join('\n  '));
  // Празните стойности по подразбиране в options са задължителни. Админ токен вече
  // няма — ключът е вътрешен и се генерира при първи старт.
  assert(!Object.prototype.hasOwnProperty.call(addonConfig.options, 'token'), 'options.token трябва да е премахнат (вътрешен ключ)');
  assert(addonConfig.options.password === null || addonConfig.options.password === '', 'options.password трябва да е празен по подразбиране');
  return 'няма частни ключове, JWT, токени и ключове';
});

// ── S12. Публичен портал ────────────────────────────────────────────────────
check('S12', 'Портал: адаптивни текстове и сигурно рендиране', () => {
  const html = readText(path.join(addonDir, 'portal.html'));
  const js = readText(path.join(addonDir, 'portal.js'));
  const server = readText(path.join(addonDir, 'server.js'));
  for (const id of ['title', 'files', 'qr', 'status', 'empty', 'count', 'toolbar', 'qr-note', 'foot-note', 'portal-url']) {
    assert(html.includes(`id="${id}"`), 'portal.html липсва id="' + id + '"');
  }
  for (const marker of ['buildProfile', 'applyWording', 'KIND_BY_EXT', 'NOUNS', 'nounFor', 'X-File-Key']) {
    assert(js.includes(marker), 'portal.js липсва ' + marker);
  }
  assert(!/innerHTML\s*=\s*[^'"`]*(file\.|data\.|listing)/.test(js), 'данните не бива да влизат през innerHTML');
  assert(js.includes('textContent'), 'рендирането трябва да е през textContent');
  assert(server.includes('img-src \'self\' data:'), 'CSP на портала трябва да позволява QR изображението');
  assert(/resolvePortal/.test(server), 'сървърът трябва да приема и id, и slug за /p/<key>');
  assert(/portalLandingUrl/.test(server), 'липсва portalLandingUrl (адрес на публичната страница)');
  return 'адаптивни текстове, CSP и id/slug маршрути';
});

// ── S13. Entrypoint (JavaScript) ───────────────────────────────────────────
check('S13', 'start.js: старт на чист JS без изтичане на тайни', () => {
  const entry = readText(path.join(addonDir, 'start.js'));
  assert(!entry.includes('\r'), 'start.js съдържа CRLF');
  assert(!entry.startsWith('#!'), 'start.js се стартира с `node`, шебанг не е нужен');
  assert(/node:sqlite/.test(entry), 'липсва проверка за node:sqlite');
  assert(/nodeMajor\s*<\s*22/.test(entry) && /nodeMinor\s*<\s*13/.test(entry), 'липсва гейт за Node >=22.13');
  assert(/spawn\(process\.execPath,\s*\[SERVER\]/.test(entry), 'сървърът не се стартира като дете на entrypoint-а');
  assert(/SIGTERM/.test(entry), 'липсва подаване на SIGTERM към сървъра (graceful stop)');
  assert(/ADMIN_TOKEN/.test(entry), 'липсва генериране на ADMIN_TOKEN');
  assert(/\/data\/admin-token/.test(entry), 'липсва постоянен файл за ADMIN_TOKEN');
  assert(/0o600/.test(entry), 'файлът с токена трябва да се създава с права 0600');
  assert(!/console\.(log|info)\([^\n]*ADMIN_TOKEN/.test(entry), 'entrypoint-ът не бива да отпечатва ADMIN_TOKEN');
  assert(/PUBLIC_BASE_URL/.test(entry), 'липсва PUBLIC_BASE_URL от public_domain');
  assert(/INGRESS_MODE/.test(entry), 'липсва INGRESS_MODE=true');
  assert(/storagePreflight/.test(entry), 'липсва storage preflight преди старта');
  return 'JS entrypoint, node:sqlite gate, SIGTERM, storage preflight, без отпечатване на токена';
});

// ── S14. Опции ↔ схема ─────────────────────────────────────────────────────
check('S14', 'Опции: всяка опция има схема и обратно', () => {
  const options = Object.keys(addonConfig.options || {});
  const schema = Object.keys(addonConfig.schema || {});
  const missingSchema = options.filter((k) => !schema.includes(k));
  const missingOption = schema.filter((k) => !options.includes(k));
  assert(missingSchema.length === 0, 'опции без схема: ' + missingSchema.join(', '));
  assert(missingOption.length === 0, 'схема без опция: ' + missingOption.join(', '));
  for (const key of ['public_domain', 'public_gateway', 'public_same_origin']) {
    assert(options.includes(key), 'липсва опция ' + key);
  }
  return `${options.length} опции, всички описани`;
});

// ── S15. repository.yaml ───────────────────────────────────────────────────
check('S15', 'repository.yaml описва add-on repository', () => {
  const file = path.join(distDir, 'repository.yaml');
  const repo = parseYaml(readText(fs.existsSync(file) ? file : path.join(root, 'repository.yaml')));
  for (const key of ['name', 'url', 'maintainer']) assert(repo[key], 'липсва ' + key);
  assert(/^https?:\/\//.test(repo.url), 'url трябва да е абсолютен URL');
  assert(!/example|placeholder|TODO/i.test(JSON.stringify(repo)), 'repository.yaml съдържа placeholder');
  return `${repo.name} → ${repo.url}`;
});

// ── S16. Документация и промени ─────────────────────────────────────────────
check('S16', 'Документация: налична и с запис за версията', () => {
  for (const doc of ['README.md', 'BG.md', 'DE.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md']) {
    const file = path.join(root, doc);
    assert(fs.existsSync(file), 'липсва ' + doc);
    assert(fs.statSync(file).size > 200, doc + ' е практически празен');
  }
  const changelog = readText(path.join(root, 'CHANGELOG.md'));
  assert(changelog.includes(version), `CHANGELOG.md няма запис за ${version}`);
  for (const doc of ['RELEASE_CHECKLIST.md', 'RELEASE_CRITERIA.md', 'QUALIFICATION_PLAN.md', 'RELEASE_DECISION.md']) {
    assert(fs.existsSync(path.join(root, 'documentation', '07_RELEASE', doc)), 'липсва documentation/07_RELEASE/' + doc);
  }
  // Баджовете за версия трябва да сочат същата версия, иначе README-то лъже.
  for (const doc of ['README.md', 'BG.md', 'DE.md']) {
    const badge = readText(path.join(root, doc)).match(/img\.shields\.io\/badge\/version-([0-9.]+)-/);
    assert(badge, doc + ': липсва бадж за версия');
    assert(badge[1] === version, `${doc}: баджът е ${badge[1]}, а изданието е ${version}`);
  }
  return `CHANGELOG има ${version}; 4 документа за изданието; баджове ${version}`;
});

// ── S17. Хигиена на архивите ────────────────────────────────────────────────
check('S17', 'Хигиена: без кешове, тестове и излишни файлове', () => {
  const forbidden = [/__pycache__/, /\.pyc$/, /(^|\/)node_modules\//, /(^|\/)\.git\//, /(^|\/)tests\//, /(^|\/)\.env/, /admin-token$/];
  for (const file of [addonArchive, integrationArchive]) {
    const entries = archived(file);
    for (const entry of entries) {
      for (const re of forbidden) assert(!re.test(entry.path), `${path.basename(file)} съдържа забранен път: ${entry.path}`);
    }
  }
  const addonSize = fs.statSync(addonArchive).size;
  const integrationSize = fs.statSync(integrationArchive).size;
  assert(addonSize < 20 * 1024 * 1024, 'add-on архивът е подозрително голям: ' + lib.fmtBytes(addonSize));
  assert(integrationSize < 5 * 1024 * 1024, 'архивът на интеграцията е подозрително голям: ' + lib.fmtBytes(integrationSize));
  assert(addonSize > 200 * 1024, 'add-on архивът е подозрително малък: ' + lib.fmtBytes(addonSize));
  return `${lib.fmtBytes(addonSize)} + ${lib.fmtBytes(integrationSize)}`;
});

// ── S18. Четене със системен tar ───────────────────────────────────────────
check('S18', 'Съвместимост: архивът се чете от системния tar', () => {
  const probe = spawnSync('tar', ['-tzf', addonArchive], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) return 'пропуснато (няма системен tar)';
  const names = probe.stdout.split(/\r?\n/).filter(Boolean);
  assert(names.includes(lib.ADDON_DIR + '/config.yaml'), 'системният tar не вижда config.yaml');
  assert(names.length >= 50, 'системният tar вижда само ' + names.length + ' записа');
  return `tar прочете ${names.length} записа`;
});

// ── S21. HACS структура ────────────────────────────────────────────────────
check('S21', 'HACS: хранилището е готово за custom repository', () => {
  const hacsFile = path.join(root, 'hacs.json');
  assert(fs.existsSync(hacsFile), 'липсва hacs.json в корена на хранилището');
  const hacs = JSON.parse(readText(hacsFile));
  assert(hacs.content_in_root === false, 'hacs.json: content_in_root трябва да е false (интеграцията е в custom_components/)');
  assert(/^\d{4}\.\d{1,2}(\.\d+)?$/.test(String(hacs.homeassistant)), 'hacs.json: homeassistant трябва да е версия');
  assert(Array.isArray(hacs.domains) && hacs.domains.includes('hapi_enterprise'), 'hacs.json: липсва domains: [hapi_enterprise]');
  const manifest = JSON.parse(readText(path.join(integrationDir, 'manifest.json')));
  assert(Array.isArray(manifest.codeowners) && manifest.codeowners.length > 0, 'manifest.json: codeowners е задължителен за HACS');
  assert(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues$/.test(manifest.issue_tracker), 'issue_tracker трябва да е GitHub Issues URL');
  // Brand изображенията трябва да са и в архива, за да ги види Home Assistant след инсталация.
  const entries = archived(integrationArchive);
  for (const rel of ['brand/icon.png', 'brand/logo.png']) {
    const entry = entries.find((e) => e.path === `custom_components/hapi_enterprise/${rel}`);
    assert(entry, 'архивът не съдържа ' + rel);
    assert(entry.data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), rel + ' не е PNG');
  }
  return `hacs.json + brand/ (${manifest.codeowners.join(', ')})`;
});

// ── S19. Стартиране от самия архив ──────────────────────────────────────────
check('S19', 'Функционално: сървърът стартира от разархивираното издание', async () => {
  if (flag('no-boot')) return 'пропуснато (--no-boot)';
  const os = require('node:os');
  const { spawn } = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-release-boot-'));
  const dir = path.join(tmp, 'tree');
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of archived(addonArchive)) {
    const target = path.join(dir, ...entry.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data, { mode: entry.mode || 0o644 });
  }
  const port = 32500 + Math.floor(Math.random() * 1500);
  const child = spawn(process.execPath, [path.join(dir, lib.ADDON_DIR, 'server.js')], {
    cwd: tmp,
    env: { ...process.env, DATA_DIR: path.join(tmp, 'data'), PORT: String(port), ADMIN_TOKEN: 'release-verify-token-at-least-24-chars' },
    stdio: 'pipe',
  });
  try {
    let healthy = false;
    for (let i = 0; i < 80 && !healthy; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        healthy = res.ok;
      } catch {
        await new Promise((r) => setTimeout(r, 75));
      }
    }
    assert(healthy, 'сървърът от архива не отговори на /health');
    const portal = await fetch(`http://127.0.0.1:${port}/p/does-not-exist`);
    assert(portal.status === 404, 'непознат портал трябва да върне 404, а върна ' + portal.status);
    const portalCss = await fetch(`http://127.0.0.1:${port}/portal.css`);
    assert(portalCss.ok, '/portal.css не се сервира от архива');
    return `стартира на :${port}, /health OK, статичните активи се сервират`;
  } finally {
    child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 120));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── S20. Пълният тестов набор (по избор) ───────────────────────────────────
if (flag('with-tests')) {
  check('S20', 'Тестове: целият набор минава', () => {
    const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-tests.cjs')], { cwd: root, stdio: 'pipe', encoding: 'utf8' });
    const tail = String(res.stdout || '').trim().split(/\r?\n/).slice(-1)[0];
    assert(res.status === 0, 'тестовете не минават: ' + tail);
    return tail;
  });
}

// ── Отчет ───────────────────────────────────────────────────────────────────
function report() {
  results.sort((a, b) => a.id.localeCompare(b.id));
  const failed = results.filter((r) => !r.ok);
  const width = Math.max(...results.map((r) => r.title.length));
  console.log('\nПроверка на изданието — ' + lib.PRODUCT + ' ' + version + '\n');
  for (const r of results) {
    console.log(`  ${r.ok ? '✔' : '✘'} ${r.id}  ${r.title.padEnd(width)}  ${r.ok ? r.detail : '\n        → ' + r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} сценария минават`);
  if (failed.length) {
    console.log('Неуспешни: ' + failed.map((r) => r.id).join(', '));
    process.exit(1);
  }
  console.log('Изданието е готово за публикуване в ' + path.relative(root, distDir) + '/');
}

if (pending.length) Promise.all(pending).then(report);
else report();
