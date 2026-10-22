'use strict';
// Startup contract for the add-on entrypoint (`hapi_enterprise/start.js`).
//
// The add-on runs `node /app/start.js` as PID 1 — there is no shell wrapper. This
// test boots the real entrypoint the same way the Supervisor does and verifies the
// three things a shell script used to guarantee:
//   1. a storage preflight ran and DATA_DIR points at the prepared storage;
//   2. ADMIN_TOKEN is generated and persisted in the add-on data dir (mode 0600),
//      and never printed;
//   3. SIGTERM reaches the server so the process exits cleanly (0), which is what
//      `timeout: 30` + cold backup in config.yaml rely on.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ENTRY = path.join(__dirname, '../hapi_enterprise/start.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-entry-'));
const dataDir = path.join(tmp, 'data');
const storageRoot = path.join(tmp, 'storage');
fs.mkdirSync(dataDir, { recursive: true });
// STORAGE_ROOT_OVERRIDE подменя mount-а: <override>/<storage_location>/<subdirectory>.
fs.mkdirSync(path.join(storageRoot, 'addon_config'), { recursive: true });
fs.writeFileSync(
  path.join(dataDir, 'options.json'),
  JSON.stringify({ storage_location: 'addon_config', storage_subdirectory: 'hapi_enterprise', memory_limit_mb: 0 }),
);

const { freePort } = require('./helpers.cjs');
let port;
let adminPort;
let child;
let stderr = '';
// Портовете се взимат от ядрото в момента на старта — двата са независими, за да
// не може вторият да попадне върху порт, който друг тест вече държи.
const startChild = async () => {
  port = await freePort();
  adminPort = await freePort();
  child = spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      HAPI_ADDON_DATA_DIR: dataDir,
      STORAGE_ROOT_OVERRIDE: storageRoot,
      PORT: String(port),
      ADMIN_PORT: String(adminPort),
      PUBLIC_GATEWAY_PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
};

const waitForHealth = async () => {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.status === 200) return res;
    } catch {
      /* още не слуша */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('start.js не вдигна /health. stderr: ' + stderr.slice(0, 400));
};

const stop = () =>
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

// Резервно чистене: ако entrypoint-ът е убит принудително (Windows не доставя
// POSIX сигнали), сървърът остава сирак. Заключването пази pid-а му.
const reapServer = async (storageBase) => {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(storageBase, '.hapi-instance.json'), 'utf8'));
    if (lock && Number.isInteger(lock.pid) && lock.pid !== process.pid) process.kill(lock.pid);
  } catch {
    /* няма заключване — сървърът вече е спрял */
  }
  await new Promise((r) => setTimeout(r, 100));
};

(async () => {
  // Storage preflight: маркерът се създава от storage-preflight.js в избраната папка.
  const storageBase = path.join(storageRoot, 'addon_config', 'hapi_enterprise');
  try {
    await startChild();
    await waitForHealth();

    assert.ok(fs.existsSync(path.join(storageBase, '.portal-enterprise-storage')), 'storage preflight не е създал хранилището');

    // 2. Токенът е генериран, записан и не изтича в лога.
    const tokenFile = path.join(dataDir, 'admin-token');
    assert.ok(fs.existsSync(tokenFile), 'липсва генериран admin-token');
    const token = fs.readFileSync(tokenFile, 'utf8');
    assert.match(token, /^[0-9a-f]{64}$/, 'admin-token трябва да е 32 случайни байта (hex)');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600, 'admin-token трябва да е 0600');
    }
    assert.ok(!stderr.includes(token), 'entrypoint-ът не бива да печата токена');

    // 3. SIGTERM → сървърът спира, entrypoint-ът не виси.
    const outcome = await stop();
    assert.notEqual(outcome, 'timeout', 'entrypoint-ът не спря при SIGTERM');
    // POSIX доставя сигнала и entrypoint-ът връща кода на сървъра (0 при graceful stop).
    // Windows няма POSIX сигнали — там проверяваме само, че процесът реагира.
    if (process.platform !== 'win32') {
      assert.equal(outcome, 0, 'SIGTERM трябва да доведе до чист изход (0), получено: ' + outcome);
    }
    await reapServer(storageBase);

    console.log('PASS entrypoint: storage preflight, генериран admin-token (0600), спиране при SIGTERM');
  } catch (e) {
    if (child) child.kill('SIGKILL');
    await reapServer(storageBase);
    throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
