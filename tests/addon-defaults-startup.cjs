'use strict';
// ИЗДАНИЕТО СТАРТИРА С ТОЧНО ТЕЗИ НАСТРОЙКИ, КОИТО СЕ ДОСТАВЯТ (0.69.160).
//
// Защо отделен тест: `start-entrypoint.cjs` проверява МЕХАНИЗМА с измислени стойности.
// Тук се проверява ДОГОВОРЪТ НА ИЗДАНИЕТО: опциите, записани в `hapi_enterprise/config.yaml`
// като defaults, трябва (а) да са същите като работещото разпределение, (б) да не носят тайни
// и (в) с тях add-on-ът да стартира без авария — със същата папка за данни, със същите
// прагове и с включените по подразбиране публичен шлюз и TSA.
//
// Проверява се и обратното: БЕЗ токен стартът се отказва с ясно съобщение, вместо да
// тръгне с празен админ (това е причина #1 за „стартира, но не пуска никого“).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { freePort } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'hapi_enterprise', 'start.js');
const cfg = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'config.yaml'), 'utf8');

// ── Четец на блока `options:` (двустепенна карта, без вложени структури) ───────
function readOptions(text) {
  const lines = text.split('\n');
  const start = lines.indexOf('options:');
  assert.ok(start >= 0, 'config.yaml: липсва блок options');
  const out = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[A-Za-z_]/.test(line)) break;
    const m = /^ {2}([a-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^-?\d+$/.test(value)) value = Number(value);
    out[m[1]] = value;
  }
  return out;
}

const DEFAULTS = readOptions(cfg);
// Токенът е единственото, което човекът ЗАДЪЛЖИТЕЛНО задава; тестова стойност, не се копира.
const TOKEN = 'defaults-startup-token-0123456789abcdef';

// ── 1. Договорът: какво вижда човекът в конфигурацията веднага след инсталация ─
// Стойностите са сверени с работещото разпределение (scripts/compare-live-options.cjs).
const EXPECTED = {
  memory_limit_mb: 1024,
  min_free_mb: 1000,
  public_gateway: true,
  public_same_origin: true,
  storage_location: 'addon_config',
  storage_subdirectory: 'hapi_enterprise',
  tsa_enabled: true,
  evidence_portal_deploy: true,
  log_level: 'info',
  visitor_ip_mode: 'hashed',
};
for (const [key, want] of Object.entries(EXPECTED)) {
  assert.equal(DEFAULTS[key], want, `config.yaml: ${key} трябва да е ${JSON.stringify(want)}, а е ${JSON.stringify(DEFAULTS[key])}`);
}
assert.ok(String(DEFAULTS.user_roles || '').includes('admin'), 'user_roles трябва да е попълнена карта с роля admin');

// ── 2. Тайните НЕ се доставят като defaults ─────────────────────────────────
const SECRETS = ['token', 'password', 'username', 'signing_key', 'tls_cert', 'tls_key', 's3_access_key', 's3_secret_key', 'pgp_key_pass'];
for (const key of SECRETS) {
  assert.equal(DEFAULTS[key], '', `config.yaml: тайната ${key} трябва да е празна, а е зададена`);
}

// ── 3. Старт със самите defaults (плюс токена) ──────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-defaults-'));
const dataDir = path.join(tmp, 'data');
const storageRoot = path.join(tmp, 'storage');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(storageRoot, 'addon_config'), { recursive: true });

const writeOptions = (extra) =>
  fs.writeFileSync(path.join(dataDir, 'options.json'), JSON.stringify({ ...DEFAULTS, ...extra }));

let child = null;
let stderr = '';

function boot(extra, { gatewayPort }) {
  writeOptions(extra);
  const port = global.__port;
  const adminPort = global.__adminPort;
  child = spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      HAPI_ADDON_DATA_DIR: dataDir,
      STORAGE_ROOT_OVERRIDE: storageRoot,
      PORT: String(port),
      ADMIN_PORT: String(adminPort),
      PUBLIC_GATEWAY_PORT: String(gatewayPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  stderr = '';
  child.stderr.on('data', (c) => {
    stderr += c.toString();
  });
  return child;
}

async function waitHealth(port, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.status === 200) return res;
    } catch {
      /* още не слуша */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

const stopChild = () =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve('timeout');
    }, 5000);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve(signal || code);
    });
    child.kill('SIGTERM');
  });

const reapServer = async (storageBase) => {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(storageBase, '.hapi-instance.json'), 'utf8'));
    if (lock && Number.isInteger(lock.pid) && lock.pid !== process.pid) process.kill(lock.pid);
  } catch {
    /* няма заключване — вече е спрял */
  }
  await new Promise((r) => setTimeout(r, 100));
};

(async () => {
  const storageBase = path.join(storageRoot, 'addon_config', 'hapi_enterprise');
  try {
    // 3а. С токен: сървърът, публичният шлюз и хранилището работят; SIGTERM е чист.
    global.__port = await freePort();
    global.__adminPort = await freePort();
    const gatewayPort = await freePort();
    boot({ token: TOKEN }, { gatewayPort });

    const health = await waitHealth(global.__port);
    assert.ok(health, 'със shipped defaults add-on-ът не вдигна /health. stderr: ' + stderr.slice(0, 400));
    assert.ok(
      fs.existsSync(path.join(storageBase, '.portal-enterprise-storage')),
      'при storage_location=addon_config + hapi_enterprise preflight не е създал хранилището',
    );
    // public_gateway: true по подразбиране — портът трябва наистина да слуша. Шлюзът
    // обслужва само публичните адреси (/p/...), затова се проверява TCP връзката, а не /health.
    const listening = await new Promise((resolve) => {
      const socket = require('node:net').connect(gatewayPort, '127.0.0.1');
      const done = (value) => {
        socket.destroy();
        resolve(value);
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      setTimeout(() => done(false), 3000);
    });
    assert.ok(listening, 'public_gateway=true по подразбиране, но портът на шлюза не слуша');
    assert.ok(!stderr.includes(TOKEN), 'токенът не бива да се печата');

    const outcome = await stopChild();
    assert.notEqual(outcome, 'timeout', 'entrypoint-ът не спря при SIGTERM');
    if (process.platform !== 'win32') assert.equal(outcome, 0, 'SIGTERM трябва да завърши с 0, получено: ' + outcome);
    await reapServer(storageBase);

    // 3б. Без токен: ясен отказ, а не тих старт с празен админ.
    global.__port = await freePort();
    global.__adminPort = await freePort();
    const gatewayPort2 = await freePort();
    boot({ token: '' }, { gatewayPort: gatewayPort2 });
    const exitCode = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('hang'), 15000);
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    if (exitCode === 'hang') child.kill('SIGKILL');
    assert.notEqual(exitCode, 'hang', 'без токен entrypoint-ът виси вместо да откаже');
    assert.notEqual(exitCode, 0, 'без токен стартът трябва да е неуспешен');
    assert.match(stderr, /ADMIN_TOKEN_REQUIRED/, 'без токен трябва да пише ADMIN_TOKEN_REQUIRED, получено: ' + stderr.slice(0, 300));
    await reapServer(storageBase);

    console.log(
      `PASS addon-defaults-startup: ${Object.keys(DEFAULTS).length} shipped опции · ` +
      'addon_config/hapi_enterprise · public_gateway + TSA включени · тайни празни · старт и чист SIGTERM',
    );
  } catch (e) {
    if (child) child.kill('SIGKILL');
    await reapServer(storageBase);
    throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
