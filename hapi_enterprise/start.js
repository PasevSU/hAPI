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
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const storagePreflight = require('./storage-preflight');

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
// Липсващ/невалиден options.json не е фатал: всички стойности имат default в
// server.js, а token се генерира. Така add-on-ът пали и при ръчен старт.
function readOptions() {
  try {
    const parsed = JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const options = readOptions();
const optionText = (key) => {
  const value = options[key];
  return value === undefined || value === null ? '' : String(value).trim();
};

// ── 3. ADMIN_TOKEN ──────────────────────────────────────────────────────────
function isWeakToken(token) {
  return (
    typeof token !== 'string' ||
    token.length < 24 ||
    token === PLACEHOLDER_TOKEN ||
    /^(.{1,8})\1{3,}$/.test(token)
  );
}

function resolveAdminToken() {
  // Няма потребителски токен. Ключът е ВЪТРЕШЕН мастер ключ (AES-256-GCM,
  // HMAC на подписаните URL-и, PGP материал, одит верига): генерира се веднъж и
  // не се показва никъде. Хората влизат през Ingress с HA самоличност.
  const tokenFile = path.join(ADDON_DATA_DIR, 'admin-token');
  try {
    const saved = fs.readFileSync(tokenFile, 'utf8').trim();
    if (!isWeakToken(saved)) return saved;
  } catch {
    /* липсващ файл е нормален първи старт */
  }

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(ADDON_DATA_DIR, { recursive: true });
    fs.writeFileSync(tokenFile, generated, { mode: 0o600 });
  } catch (e) {
    fail('Cannot persist the internal key in ' + tokenFile + ': ' + e.message);
  }
  return generated;
}

const env = { ...process.env };
env.ADMIN_TOKEN = resolveAdminToken();

// ── 4. Options → env ────────────────────────────────────────────────────────
// Празна стойност НЕ се подава, за да остане в сила default-ът на сървъра.
env.BACKUP_DIR = optionText('backup_folder');
env.BACKUP_MIRROR = optionText('backup_mirror');
env.STORAGE_MIRROR = optionText('storage_mirror');

const configDir = optionText('config_dir');
if (configDir) env.HAPI_CONFIG_DIR = configDir;

const OPTION_ENV = [
  ['TSA_ENABLED', 'tsa_enabled'],
  ['TSA_START_URL', 'tsa_start_url'],
  ['TSA_STOP_URL', 'tsa_stop_url'],
  ['SIGN_PACKAGES', 'sign_packages'],
  ['SIGNING_KEY', 'signing_key'],
  ['ENCRYPT_FILES', 'encrypt_files'],
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

// Публичният базов адрес (QR кодове, абсолютни адреси) идва от `public_domain`.
// Невалиден домейн се игнорира — по-добре относителни адреси, отколкото счупен QR.
function publicBaseUrl(raw) {
  if (!raw) return '';
  const base = (/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).replace(/\/+$/, '');
  return /^https?:\/\/[A-Za-z0-9.\-:[\]]+(\/[A-Za-z0-9._~\-/]*)?$/.test(base) ? base : '';
}
const publicBase = publicBaseUrl(optionText('public_domain'));
if (publicBase) env.PUBLIC_BASE_URL = publicBase;

// Режим на add-on-а: Ingress автоматично влиза, порталът иска токен, първият
// старт се seed-ва. Стойностите са фиксирани, защото това е add-on, не edge режим.
env.INGRESS_MODE = 'true';
env.HAPI_FIRST_RUN_SEED = '1';
env.REQUIRE_PORTAL_TOKEN = 'true';
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

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on('error', (e) => fail('Cannot start hAPI server: ' + e.message));
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code === null ? 1 : code);
});
