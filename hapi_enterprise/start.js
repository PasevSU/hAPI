'use strict';
// hAPI Enterprise — add-on entrypoint.
//
// Това е ЕДИНСТВЕНИЯТ вход на контейнера (`CMD ["node", "/app/start.js"]`).
// Правилото на проекта е „всичко е JavaScript“: няма `/bin/sh`, няма `sed`,
// няма `jq` и няма втори език за стартиране. Всичко, което преди се правеше от
// `run.sh` (четене на `/data/options.json`, генериране на ADMIN_TOKEN, storage
// preflight, memory limit, exec на сървъра), се прави тук с Node built-ins.
//
// Инварианти, които не бива да се губят при промени:
//   1. Node ≥ 22.13 с `node:sqlite` — иначе SQLite хранилището не съществува.
//   2. ADMIN_TOKEN никога не се печата; при липса се генерира и пази в
//      `/data/admin-token` с права 0600, за да оцелее рестарт.
//   3. Storage preflight се проваля ЗАКРИТО (exit 1), преди да е отворен порт.
//   4. Сървърът се стартира като дете на този процес, за да може SIGTERM от
//      Supervisor да стигне до него (graceful shutdown на SQLite).
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const storagePreflight = require('./storage-preflight');
// Само чистата функция за формата на токена; нищо не се записва и не се валидира с нея.
const { tokenShape } = require('./runtime-config');

// Supervisor монтира личните данни на add-on-а в /data. HAPI_ADDON_DATA_DIR е
// само за тестове/локален старт — в add-on-а винаги е /data.
const ADDON_DATA_DIR = process.env.HAPI_ADDON_DATA_DIR || '/data';
const OPTIONS_PATH = process.env.OPTIONS_PATH || path.join(ADDON_DATA_DIR, 'options.json');
const SERVER = path.join(__dirname, 'server.js');
const PLACEHOLDER_TOKEN = 'CHANGE_TO_RANDOM_SECRET_AT_LEAST_24_CHARACTERS';

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ── 1. Runtime gate ─────────────────────────────────────────────────────────
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 13)) {
  fail('Portal Enterprise requires Node.js >=22.13 for SQLite DatabaseSync');
}
try {
  if (typeof require('node:sqlite').DatabaseSync !== 'function') throw new Error('DatabaseSync is not a constructor');
} catch (e) {
  fail('Node SQLite unavailable: ' + (e && e.message ? e.message : e));
}

// ── 2. Опции на add-on-а ────────────────────────────────────────────────────
// Липсващ/невалиден options.json не е фатален за останалите стойности (всяка има default в
// server.js), НО токенът вече е задължителен: без него стартът се отказва (виж §3).
function readOptions() {
  try {
    const parsed = JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const options = readOptions();
// ── 2б. Незаместен `!secret` в КОЯТО и да е опция ─────────────────────────────
// Supervisor замества `!secret <име>` в опциите, но ако не успее (по-стар Supervisor,
// грешно име, излишно разстояние), стойността пристига БУКВАЛНО и се превръща в път
// `!secret …`, в адрес или в ключ. Грешката тогава излиза някъде другаде и не сочи тук, а
// записът в HA може вече да е отказан със „Unknown secret ' …'“. Един ред в лога пести
// часове: казва ИМЕНАТА на опциите (не стойностите) и дали има излишен интервал в името.
// `token` е изключен — той има собствен, по-точен отказ в §3.
function warnUnexpandedSecrets(values) {
  const bad = [];
  for (const [key, raw] of Object.entries(values)) {
    if (key === 'token' || typeof raw !== 'string' || !raw.startsWith('!secret ')) continue;
    const name = raw.slice('!secret '.length);
    bad.push(key + (name === name.trim() ? '' : ' (интервал в името)'));
  }
  if (!bad.length) return;
  console.warn(
    'OPTION_SECRET_NOT_EXPANDED: тези опции съдържат "!secret" без замяна → ' + bad.join(', ') +
    '. След "!secret" трябва да има ТОЧНО едно разстояние и името да е същото като в secrets.yaml.',
  );
}
warnUnexpandedSecrets(options);
const optionText = (key) => {
  const value = options[key];
  return value === undefined || value === null ? '' : String(value).trim();
};

// ── 3. ADMIN_TOKEN ──────────────────────────────────────────────────────────
// Токенът е ЗАДЪЛЖИТЕЛЕН. Две причини: (1) той е вътрешният мастер ключ (AES-256-GCM,
// HMAC на подписаните URL-и, одит верига); (2) тихото генериране скриваше липсваща
// конфигурация — точно това не бива да се прави. Затова: без опция `token` add-on-ът
// отказва старт. Чете се САМО вече записан `/data/admin-token` (за инсталации от преди
// 0.69.67), но нов никога не се създава.
function isWeakToken(token) {
  return (
    typeof token !== 'string' ||
    token.length < 24 ||
    token === PLACEHOLDER_TOKEN ||
    token.startsWith('!secret') || // буквално въведен !secret не е стойност
    /^(.{1,8})\1{3,}$/.test(token)
  );
}

/** Връща токена от опцията, иначе от вече записания файл; иначе `null` (стартът отказва). */
function resolveAdminToken(optionToken) {
  const fromOptions = typeof optionToken === 'string' ? optionToken.trim() : '';
  if (!isWeakToken(fromOptions)) return fromOptions;
  if (fromOptions) {
    // `!secret …` стига дотук само когато Supervisor НЕ го е заместил: по-стар Supervisor,
    // грешно име или излишно разстояние след `!secret`. Казваме точно това — иначе човек
    // търси дължината на токена вместо интервала. Кодът остава същият (той е договорът),
    // пояснението е в текста.
    if (fromOptions.startsWith('!secret')) {
      fail(
        'ADMIN_TOKEN_REQUIRED: the "token" option still contains a "!secret …" reference, so Supervisor did not ' +
        'substitute it. Use exactly ONE space after "!secret" and the exact name from secrets.yaml — an extra ' +
        'space becomes part of the name (Home Assistant then reports "Unknown secret \' name\'").',
      );
    }
    fail(
      'ADMIN_TOKEN_REQUIRED: the "token" option is too weak (needs 24+ characters, no placeholder and no repetition pattern)',
    );
  }
  const tokenFile = path.join(ADDON_DATA_DIR, 'admin-token');
  try {
    const saved = fs.readFileSync(tokenFile, 'utf8').trim();
    if (!isWeakToken(saved)) return saved;
  } catch {
    /* няма записан токен — това е грешка в конфигурацията, не повод за генериране */
  }
  fail(
    'ADMIN_TOKEN_REQUIRED: set the "token" option (24+ characters) in the add-on configuration. ' +
    'The add-on no longer generates a token by itself.',
  );
}

const env = { ...process.env };
env.ADMIN_TOKEN = resolveAdminToken(optionText('token'));
// Предупреждение, не отказ (0.69.87). Ако администраторският токен на hAPI е Home Assistant
// long-lived access token, той отваря и целия HA API: едно изтичане на hAPI токена става
// изтичане на Home Assistant. Не пипаме стойността — само казваме какво означава.
if (tokenShape(env.ADMIN_TOKEN).haLongLived) {
  console.warn(
    'ADMIN_TOKEN_LOOKS_LIKE_HA_LLAT: the "token" option is shaped like a Home Assistant ' +
    'long-lived access token (JWT with "iss"). Every hAPI client holding it would also be able ' +
    'to call the whole Home Assistant API. Use a separate random value for hAPI (32+ characters) ' +
    'and keep the HA token only where HA itself needs it.',
  );
}

// ── 4. Options → env ────────────────────────────────────────────────────────
// Празна стойност НЕ се подава, за да остане в сила default-ът на сървъра.
env.BACKUP_DIR = optionText('backup_folder');
env.BACKUP_MIRROR = optionText('backup_mirror');
env.STORAGE_MIRROR = optionText('storage_mirror');
// Само за целта `s3` на огледалото. Празни → сървърът отказва s3 цел с ясна грешка.
env.S3_ACCESS_KEY = optionText('s3_access_key');
env.S3_SECRET_KEY = optionText('s3_secret_key');

const configDir = optionText('config_dir');
if (configDir) env.HAPI_CONFIG_DIR = configDir;

const OPTION_ENV = [
  ['TSA_ENABLED', 'tsa_enabled'],
  ['TSA_START_URL', 'tsa_start_url'],
  ['TSA_STOP_URL', 'tsa_stop_url'],
  ['SIGN_PACKAGES', 'sign_packages'],
  ['SIGNING_KEY', 'signing_key'],
  ['ENCRYPT_FILES', 'encrypt_files'],
  // Копие на прикачените файлове в папката на портала (`storage_root`). Изключено по
  // подразбиране: прикачването не бива да създава папка, която човекът не е поискал.
  ['PORTAL_FOLDER_COPY', 'portal_folder_copy'],
  // Кожа на публичната страница: `classic` (по подразбиране) или `modern`.
  ['PORTAL_SKIN', 'portal_skin'],
  ['TLS_CERT', 'tls_cert'],
  ['TLS_KEY', 'tls_key'],
  // Сензори: какво се пази от адреса на посетителя. Празна/незададена опция → сървърът
  // ползва своето подразбиране, за да не се заключва поведението от празен низ.
  // Проксито (`TRUST_PROXY`) съзнателно НЕ е тук: HA схемата не може да изрази `null`,
  // а старите инсталации имат точно такава записана стойност — задава се от конзолата.
  ['VISITOR_IP_MODE', 'visitor_ip_mode'],
  ['VISITOR_RETENTION_DAYS', 'visitor_retention_days'],
  ['GEOIP_DB_PATH', 'visitor_geoip_path'],
];
for (const [envKey, optionKey] of OPTION_ENV) {
  const value = optionText(optionKey);
  // Нулевите дни и празните низове не се предават: 0 значи „подразбиране“, не „0 дни“.
  if (!value || value === '0') continue;
  env[envKey] = value;
}

// PGP е ПО ИЗБОР: пътищата се подават, само когато са зададени. Сървърът зарежда ключовете
// от тях; ако ги няма, стартира нормално и `keyring` казва, че PGP е недостъпен.
const PGP_PATH_ENV = [
  ['PGP_PATH_PUBLIC', 'pgp_path_public'],
  ['PGP_PATH_SECRET', 'pgp_path_secret'],
  ['PGP_PATH_PASS', 'pgp_path_pass'],
  ['PGP_KEY_PASS', 'pgp_key_pass'],
];
for (const [envKey, optionKey] of PGP_PATH_ENV) {
  const value = optionText(optionKey);
  if (value) env[envKey] = value;
}
// Флаговете се подават винаги (включително `false`), за да е ясно какво е избрано.
for (const flag of ['pgp_encrypt_paths', 'pgp_encrypt_workdir']) {
  const raw = options[flag];
  if (raw === undefined || raw === null || raw === '') continue;
  env[flag.toUpperCase()] = raw === true || raw === 'true' ? 'true' : 'false';
}

// Публичният базов адрес (QR кодове, абсолютни адреси) идва от `public_domain`.
// Невалиден домейн се игнорира — по-добре относителни адреси, отколкото счупен QR.
function publicBaseUrl(raw) {
  if (!raw) return '';
  const base = (/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).replace(/\/+$/, '');
  return /^https?:\/\/[A-Za-z0-9.\-:[\]]+(\/[A-Za-z0-9._~\-/]*)?$/.test(base) ? base : '';
}
const publicBase = publicBaseUrl(optionText('public_domain'));
if (publicBase) env.PUBLIC_BASE_URL = publicBase;

// Режим на add-on-а: Ingress автоматично влиза, първият старт се seed-ва. Стойностите са
// фиксирани, защото това е add-on, не edge режим.
env.INGRESS_MODE = 'true';
env.HAPI_FIRST_RUN_SEED = '1';
// Токен за всеки портал — ПО ИЗБОР, не закован.
//
// Докато тук стоеше `'true'`, на реалната инсталация ВСЕКИ адрес на портал — включително
// публичен и адресът, който носи QR кодът — отговаряше 404: `portal-policy.js` прескача
// правилото „публичен портал без идентичност“, а `adminPortal` тогава връща празен
// `accessQuery`, тоест и подписаният достъп липсва. Панелът сам го потвърждаваше с
// `link.check … status: 404` секунда след `portal.access.denied · no-identity`.
// Затова режимът остава възможен, но трябва да се поиска изрично.
env.REQUIRE_PORTAL_TOKEN = process.env.REQUIRE_PORTAL_TOKEN === 'true' ? 'true' : 'false';
env.PUBLIC_BIND_HOST = process.env.PUBLIC_BIND_HOST || '0.0.0.0';
env.ADMIN_PORT = process.env.ADMIN_PORT || '8098';
env.PORT = process.env.PORT || '8099';

// ── 5. Памет ────────────────────────────────────────────────────────────────
// Raspberry Pi и други малки машини имат малко RAM. 0 = default на Node;
// положителна стойност се подава като --max-old-space-size, за да не стигне
// контейнерът до OOM kill при индексиране на голяма папка.
const memoryOption = optionText('memory_limit_mb');
if (memoryOption !== '') {
  if (!/^\d+$/.test(memoryOption)) fail('memory_limit_mb must be a whole number');
  const memoryMb = Number(memoryOption);
  if (memoryMb !== 0) {
    if (memoryMb < 64 || memoryMb > 8192) fail('memory_limit_mb must be between 64 and 8192 (0 = Node default)');
    env.NODE_OPTIONS = (env.NODE_OPTIONS ? env.NODE_OPTIONS + ' ' : '') + '--max-old-space-size=' + memoryMb;
  }
}

// ── 6. Storage preflight ────────────────────────────────────────────────────
// Избира /config, /media или /share, създава поддиректорията и проверява
// свободното място. Грешка тук е фатална — иначе сървърът ще пише върху
// неочаквано място (или върху NFS mount, който не е активен).
try {
  env.DATA_DIR = storagePreflight.check(options, env);
} catch (e) {
  fail('STORAGE PREFLIGHT FAILED: ' + e.message);
}

// ── 7. Старт на сървъра ─────────────────────────────────────────────────────
// Сървърът е дете, а не `exec`-нат процес: така entrypoint-ът може да подаде
// SIGTERM/SIGINT надолу (SQLite WAL се затваря чисто) и да върне код на изхода.
const child = spawn(process.execPath, [SERVER], { env, stdio: 'inherit' });

// Optional diagnostics as a sibling process. No separate installer, network calls or
// runtime dependencies. It does not modify/restart hAPI and stays OFF on upgrades.
const guardianEnabled = options.stability_guardian_enabled === true || options.stability_guardian_enabled === 'true';
let guardian = null;
if (guardianEnabled) {
  guardian = spawn(process.execPath, [path.join(__dirname, 'guardian', 'monitor.js')], {
    env: { ...env, HAPI_GUARDIAN_DIR: path.join(ADDON_DATA_DIR, 'stability-guardian') },
    stdio: 'inherit',
  });
  guardian.on('error', (error) => console.error('GUARDIAN_START_FAILED:', error.code || error.message));
  guardian.on('exit', (code) => {
    if (code !== 0 && !guardian.killed) console.error('GUARDIAN_STOPPED:', code);
  });
}


for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
    if (guardian && !guardian.killed) guardian.kill(signal);
  });
}

child.on('error', (e) => fail('Cannot start hAPI server: ' + e.message));
child.on('exit', (code, signal) => {
  if (guardian && !guardian.killed) guardian.kill('SIGTERM');
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code === null ? 1 : code);
});
