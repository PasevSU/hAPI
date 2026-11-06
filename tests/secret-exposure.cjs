'use strict';
// 0.69.165 — ИНЦИДЕНТ: живият admin токен на добавката излезе в чат, защото диагностика
// отпечата опциите на Supervisor-а. Кодът на add-on-а беше чист, но нищо не заключваше
// обещанието „тайните не излизат отвътре“. Затова този тест проверява ВСЯКА повърхност,
// през която човек или интеграция чете състояние, и твърди, че нито един отговор и нито
// един лог ред не съдържа тайна.
//
// Проверените сценарии (всички минават през auth gate-а на истински сървър):
//   1. Успешна автентикация → whoami/sensors/settings не връщат токена.
//   2. Диагностичните четения (diagnostics, errors, users, portals, audit, settings) не
//      връщат нито admin токена, нито паролата, нито PGP паролата, нито S3 тайната.
//   3. Отказ с грешен токен НЕ връща подадения токен обратно в тялото (иначе отговорът
//      става огледало за всеки, който пробва стойности).
//   4. При LOG_LEVEL=debug логовете не съдържат нито една тайна — нито при успех, нито
//      при отказ.
//   5. Тайна в query string не влиза в лога: пътят се логва без query частта.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { stopChild, freePort } = require('./helpers.cjs');

const root = path.join(__dirname, '..');

// Стойности, които не бива да се появят никъде. Достатъчно дълги, за да не съвпадат случайно.
const ADMIN_TOKEN = 'adm-' + crypto.randomBytes(20).toString('hex');
const PGP_PASS = 'pgp-pass-' + crypto.randomBytes(12).toString('hex');
const S3_SECRET = 's3-secret-' + crypto.randomBytes(12).toString('hex');
const ADMIN_PASSWORD = 'user-pass-' + crypto.randomBytes(12).toString('hex');
const SECRETS = [
  ['admin token', ADMIN_TOKEN],
  ['pgp pass', PGP_PASS],
  ['s3 secret', S3_SECRET],
  ['admin password', ADMIN_PASSWORD],
];

const READ_SURFACES = [
  '/admin/api/whoami',
  '/admin/api/connection',
  '/admin/api/diagnostics',
  '/admin/api/metrics',
  '/admin/api/load',
  '/admin/api/sensors',
  '/admin/api/settings',
  '/admin/api/users',
  '/admin/api/errors',
  '/admin/api/audit',
  '/admin/api/storage/status',
  '/admin/api/jobs',
  '/admin/api/rules',
  '/admin/api/retention',
  '/admin/api/config-profiles',
  '/health',
];

function collect(stream, sink) {
  if (!stream) return;
  stream.on('data', (chunk) => {
    sink.value += chunk.toString();
    if (sink.value.length > 400_000) sink.value = sink.value.slice(-400_000);
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-secrets-'));
  const optionsPath = path.join(dir, 'options.json');
  // Същите имена на полетата, които add-on-ът наистина получава от Supervisor-а.
  fs.writeFileSync(
    optionsPath,
    JSON.stringify({
      token: ADMIN_TOKEN,
      password: ADMIN_PASSWORD,
      pgp_key_pass: PGP_PASS,
      s3_access_key: 's3-access-not-secret',
      s3_secret_key: S3_SECRET,
      log_level: 'debug',
    }),
    'utf8'
  );

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const logs = { value: '' };
  let child;

  try {
    child = spawn(process.execPath, [path.join(root, 'hapi_enterprise', 'server.js')], {
      env: {
        ...process.env,
        DATA_DIR: dir,
        OPTIONS_PATH: optionsPath,
        PORT: String(port),
        ADMIN_TOKEN,
        ADMIN_PASSWORD,
        LOG_LEVEL: 'debug',
        PUBLIC_GATEWAY_PORT: '0',
        INGRESS_MODE: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    collect(child.stdout, logs);
    collect(child.stderr, logs);

    let ready = false;
    for (let i = 0; i < 600; i++) {
      if (child.exitCode !== null) throw new Error('сървърът приключи преждевременно (код ' + child.exitCode + ')');
      try {
        const health = await fetch(base + '/health');
        await health.arrayBuffer();
        if (health.ok) {
          ready = true;
          break;
        }
      } catch {
        /* още стартира */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, 'сървърът не стартира');

    const read = async (surface) => {
      const res = await fetch(base + surface, { headers: { Authorization: 'Bearer ' + ADMIN_TOKEN } });
      const body = await res.text();
      return { surface, status: res.status, body };
    };

    // 1+2. Всяка повърхност за четене, достъпна с валиден токен.
    const seen = [];
    for (const surface of READ_SURFACES) {
      const result = await read(surface);
      seen.push(result.surface + '=' + result.status);
      assert.ok(result.status < 500, surface + ' не бива да гърми: ' + result.status);
      for (const [label, secret] of SECRETS) {
        assert.equal(result.body.includes(secret), false, surface + ' връща ' + label + ' в тялото');
      }
    }
    assert.ok(seen.length === READ_SURFACES.length, 'всички повърхности са проверени: ' + seen.join(' '));

    // 3. Отказът не връща подаденото обратно.
    const presented = 'presented-' + crypto.randomBytes(16).toString('hex');
    const denied = await fetch(base + '/admin/api/whoami', { headers: { Authorization: 'Bearer ' + presented } });
    const deniedBody = await denied.text();
    assert.ok([401, 403].includes(denied.status), 'грешен токен се отказва: ' + denied.status);
    assert.equal(deniedBody.includes(presented), false, 'отказът не бива да връща подадения токен');
    for (const [label, secret] of SECRETS) {
      assert.equal(deniedBody.includes(secret), false, 'отказът не бива да съдържа ' + label);
    }

    // 5. Тайна в query string не влиза в лога (пътят се логва без query частта).
    const queryAttempt = await fetch(base + '/health?token=' + PGP_PASS);
    await queryAttempt.arrayBuffer();

    // Малко време логовете да се изпълнят (debug редът се пише след отговора).
    await new Promise((r) => setTimeout(r, 150));

    // 4. Нито една тайна не е в логовете.
    assert.ok(logs.value.length > 0, 'сървърът трябва да пише логове, иначе този тест не проверява нищо');
    // Контрола: четем НАИСТИНА потока на сървъра, а не празен буфер. Без това „няма тайна
    // в лога“ можеше да е истина просто защото логът е празен — тест, който не би хванал
    // изтичане, е по-лош от липсващ тест.
    assert.match(logs.value, /listening|server/i, 'логът съдържа реда за стартиране (контрола на детектора)');
    for (const [label, secret] of SECRETS) {
      const at = logs.value.indexOf(secret);
      const context = at >= 0 ? logs.value.slice(Math.max(0, at - 120), at + 120).replace(/\s+/g, ' ') : '';
      assert.equal(at, -1, 'логът съдържа ' + label + (context ? ' → …' + context + '…' : ''));
    }
    assert.equal(logs.value.includes(PGP_PASS), false, 'тайна от query string не влиза в лога');
  } finally {
    if (child) await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
