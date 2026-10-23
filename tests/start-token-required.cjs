'use strict';
// Договор 0.69.67: токенът е ЗАДЪЛЖИТЕЛЕН вход на add-on-а, PGP — по избор.
//
// Досега `start.js` тихо генерираше токен, когато опцията липсва. Това скриваше
// недовършена конфигурация и правеше „работи при мен“ невъзпроизводимо. Сега:
//   • без `token` (и без вече записан /data/admin-token) → отказ със ADMIN_TOKEN_REQUIRED;
//   • слаб/шаблонен токен (`!secret …`, под 24 знака, повторение) → същият отказ;
//   • силен токен → сървърът пали, админ пътят се отваря само с него;
//   • стар файл `/data/admin-token` (инсталация отпреди 0.69.67) → пали, без презапис;
//   • PGP опциите НЕ пречат: липсващи → сървърът пак пали (PGP е по избор).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { freePort, stopTree } = require('./helpers.cjs');

const ENTRY = path.join(__dirname, '../hapi_enterprise/start.js');
const STRONG = 'token-required-test-0123456789abcdef';

/** Готви изолирана инсталация: собствен data dir, собствен storage root. */
function makeCase(options) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-token-'));
  const dataDir = path.join(tmp, 'data');
  const storageRoot = path.join(tmp, 'storage');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'addon_config'), { recursive: true });
  const optionsPath = path.join(dataDir, 'options.json');
  fs.writeFileSync(optionsPath, JSON.stringify(options));
  return { tmp, dataDir, storageRoot, optionsPath };
}

const baseEnv = (c, extra = {}) => ({
  ...process.env,
  HAPI_ADDON_DATA_DIR: c.dataDir,
  OPTIONS_PATH: c.optionsPath,
  STORAGE_ROOT_OVERRIDE: c.storageRoot,
  PUBLIC_GATEWAY_PORT: '0',
  ...extra,
});

/** Стартира entrypoint-а и чака изход (за случаите, в които трябва да откаже). */
function runToExit(options) {
  const c = makeCase(options);
  const out = spawnSync(process.execPath, [ENTRY], { env: baseEnv(c), encoding: 'utf8', timeout: 20000 });
  return {
    ...c,
    status: out.status,
    stderr: String(out.stderr || ''),
    tokenFileCreated: fs.existsSync(path.join(c.dataDir, 'admin-token')),
  };
}

/** Стартира entrypoint-а, чака /health и връща handle за спиране. */
async function runToHealth(options, preExistingToken) {
  const c = makeCase(options);
  if (preExistingToken) fs.writeFileSync(path.join(c.dataDir, 'admin-token'), preExistingToken, { mode: 0o600 });
  const port = await freePort();
  // Административният порт се дава ИЗРИЧНО: иначе start.js пада към 8098 и на CI този порт
  // може да е зает от предишен тест, който не е освободил процеса си. Тук не се проверява
  // пазенето с токен през HTTP — то е в tests/auth.cjs.
  const adminPort = await freePort();
  let stderr = '';
  const child = spawn(process.execPath, [ENTRY], {
    env: baseEnv(c, { PORT: String(port), ADMIN_PORT: String(adminPort) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const health = async () => {
    for (let i = 0; i < 160; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        if (res.status === 200) return res.status;
      } catch {
        /* още не слуша */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return 0;
  };
  // Не SIGKILL върху entrypoint-а: той пуска сървъра като свое дете със `stdio: 'inherit'`
  // и сиракът държи тръбите отворени → тестът отпечатва „ok“, но процесът не излиза
  // (видяно в CI: 9 минути висящ job). stopTree праща SIGTERM, после убива pid-а от
  // заключването на инстанцията и затваря тръбите.
  const storageBase = path.join(c.storageRoot, 'addon_config', 'hapi_enterprise');
  const stop = () => stopTree(child, { storageBase });
  return { ...c, port, child, health, stop, stderr: () => stderr };
}

(async () => {
  const cases = [];

  // 1. Никаква опция → отказ, без генериран файл.
  const none = runToExit({ storage_location: 'addon_config', storage_subdirectory: 'hapi_enterprise' });
  assert.equal(none.status, 1, 'без токен стартът трябва да се провали');
  assert.match(none.stderr, /ADMIN_TOKEN_REQUIRED/, 'съобщението трябва да е ADMIN_TOKEN_REQUIRED');
  assert.equal(none.tokenFileCreated, false, 'entrypoint-ът не бива да създава admin-token');
  cases.push('без опция → ADMIN_TOKEN_REQUIRED');

  // 2. Буквално въведен `!secret` не е стойност.
  const literalSecret = runToExit({ token: '!secret hapi_token' });
  assert.equal(literalSecret.status, 1, 'буквален !secret трябва да се отхвърли');
  assert.match(literalSecret.stderr, /ADMIN_TOKEN_REQUIRED/, 'буквален !secret → ADMIN_TOKEN_REQUIRED');
  cases.push('!secret … → отказ');

  // 3. Твърде къс токен.
  const short = runToExit({ token: 'short-token' });
  assert.equal(short.status, 1, 'под 24 знака трябва да се отхвърли');
  assert.match(short.stderr, /too weak/, 'краткият токен трябва да е „too weak“');
  cases.push('под 24 знака → отказ');

  // 4. Повтарящ се шаблон.
  const repeated = runToExit({ token: 'abcdabcdabcdabcdabcdabcdabcd' });
  assert.equal(repeated.status, 1, 'повтарящ се шаблон трябва да се отхвърли');
  assert.match(repeated.stderr, /too weak/, 'повторението трябва да е „too weak“');
  cases.push('повторение → отказ');

  // 5. Силен токен → пали.
  // Забележка: start.js вдига add-on-а с INGRESS_MODE=true, затова админ API-то НЕ е на
  // публичния порт (404) — то живее на loopback ADMIN_PORT и се пази от мрежова позиция,
  // не от токен. Затова тук не твърдим 401/200 през HTTP; пазенето с токен на главния
  // слушател е покрито от tests/auth.cjs, а тук проверяваме самия стартов договор.
  const ok = await runToHealth({ token: STRONG, storage_location: 'addon_config', storage_subdirectory: 'hapi_enterprise' });
  try {
    assert.equal(await ok.health(), 200, 'със силен токен сървърът трябва да вдигне /health. stderr: ' + ok.stderr().slice(0, 300));
    assert.equal(fs.existsSync(path.join(ok.dataDir, 'admin-token')), false, 'токенът не се записва в /data');
    assert.ok(!ok.stderr().includes(STRONG), 'токенът не бива да изтича в stderr');
  } finally {
    await ok.stop();
  }
  cases.push('силен токен → старт');

  // 6. Стар записан токен (инсталация отпреди 0.69.67) → пали без презапис.
  const legacyToken = 'legacy-token-required-0123456789';
  const legacy = await runToHealth(
    { storage_location: 'addon_config', storage_subdirectory: 'hapi_enterprise' },
    legacyToken,
  );
  try {
    assert.equal(await legacy.health(), 200, 'стар /data/admin-token трябва да позволи старт');
    assert.equal(
      fs.readFileSync(path.join(legacy.dataDir, 'admin-token'), 'utf8'),
      legacyToken,
      'старият токен не бива да се презаписва',
    );
  } finally {
    await legacy.stop();
  }
  cases.push('стар admin-token → съвместимост');

  // 7. PGP е по избор: липсващи PGP опции не блокират старта, но се предават, когато ги има.
  const pgp = await runToHealth({
    token: STRONG,
    pgp_path_public: '/homeassistant/_openpgpV6/public.asc',
    pgp_path_secret: '/homeassistant/_openpgpV6/secret.asc',
    pgp_encrypt_paths: true,
    storage_location: 'addon_config',
    storage_subdirectory: 'hapi_enterprise',
  });
  try {
    assert.equal(await pgp.health(), 200, 'PGP опции не бива да пречат на старта');
  } finally {
    await pgp.stop();
  }
  cases.push('PGP по избор → старт');

  console.log('start-token-required: ok — ' + cases.length + ' случая (' + cases.join('; ') + ')');
})().catch((err) => {
  console.error('start-token-required: FAILED — ' + (err && err.message ? err.message : err));
  process.exit(1);
});
