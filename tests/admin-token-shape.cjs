'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { freePort, stopTree } = require('./helpers.cjs');
const { tokenShape } = require('../hapi_enterprise/runtime-config.js');
// §ADMIN_TOKEN_LOOKS_LIKE_HA_LLAT: администраторският токен на hAPI не бива да е Home
// Assistant long-lived access token. Такъв токен отваря и целия HA API, тоест едно изтичане
// на hAPI токена става изтичане на Home Assistant. Проверката е предупреждение, не отказ.
const ENTRY = path.join(__dirname, '../hapi_enterprise/start.js');
const MARKER = 'ADMIN_TOKEN_LOOKS_LIKE_HA_LLAT';

const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
/** Същата форма, която издава Home Assistant: `{"alg":"HS256","typ":"JWT"}` + `{"iss":…,"iat":…}`. */
const haToken = () => [b64({ alg: 'HS256', typ: 'JWT' }), b64({ iss: 'cd91fakeuserid', iat: 1700000000 }), 'firma-koqto-ne-se-proverqva'].join('.');
/** OIDC токен: `iss` има, но и `sub`/`aud` — това НЕ е HA long-lived токен. */
const oidcToken = () => [b64({ alg: 'RS256', typ: 'JWT' }), b64({ iss: 'https://id.example', sub: 'user-1', aud: 'hapi', exp: 9999999999 }), 'sig'].join('.');

function makeCase(token) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-token-shape-'));
  const dataDir = path.join(tmp, 'data');
  const storageRoot = path.join(tmp, 'storage');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'addon_config'), { recursive: true });
  const optionsPath = path.join(dataDir, 'options.json');
  fs.writeFileSync(optionsPath, JSON.stringify({ token, storage_location: 'addon_config', storage_subdirectory: 'hapi_enterprise' }));
  return { tmp, dataDir, storageRoot, optionsPath };
}

/** Стартира entrypoint-а, чака /health и връща събрания изход (stderr + stdout). */
async function runAndListen(token) {
  const c = makeCase(token);
  const port = await freePort();
  const adminPort = await freePort();
  let output = '';
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, HAPI_ADDON_DATA_DIR: c.dataDir, OPTIONS_PATH: c.optionsPath, STORAGE_ROOT_OVERRIDE: c.storageRoot, PORT: String(port), ADMIN_PORT: String(adminPort), PUBLIC_GATEWAY_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { output += d.toString() });
  child.stderr.on('data', (d) => { output += d.toString() });
  let healthy = false;
  for (let i = 0; i < 160 && !healthy; i++) {
    try { healthy = (await fetch(`http://127.0.0.1:${port}/health`)).status === 200 } catch { /* още не слуша */ }
    if (!healthy) await new Promise((r) => setTimeout(r, 50));
  }
  return { c, child, healthy, output: () => output, stop: () => stopTree(child, { storageBase: path.join(c.storageRoot, 'addon_config', 'hapi_enterprise') }) };
}

(async () => {
  // ── 1. Чиста функция: формите, които трябва да различава ───────────────────
  const ha = tokenShape(haToken());
  assert.equal(ha.jwt, true, 'JWT формата се разпознава');
  assert.equal(ha.haLongLived, true, 'HA long-lived формата се разпознава');

  const oidc = tokenShape(oidcToken());
  assert.equal(oidc.jwt, true);
  assert.equal(oidc.haLongLived, false, 'OIDC токен със sub/aud не е HA long-lived');

  const opaque = tokenShape('token-required-test-0123456789abcdef');
  assert.deepEqual({ jwt: opaque.jwt, ha: opaque.haLongLived }, { jwt: false, ha: false }, 'обикновен токен не е JWT');

  for (const bad of ['', null, undefined, 'a.b', 'a.b.c', '....', 'header..sig']) {
    assert.doesNotThrow(() => tokenShape(bad), 'лоша стойност не бива да хвърля: ' + String(bad));
    const shape = tokenShape(bad);
    assert.equal(shape.jwt, false, 'невалиден JWT не се брои: ' + String(bad));
  }
  // JWT с нечетим payload (валиден header, счупен втори блок) не бива да гърми.
  assert.equal(tokenShape([b64({ alg: 'HS256' }), '%%%ne-base64%%%', 'x'].join('.')).jwt, true);

  // ── 2. Живият старт: предупреждението стига до лога на add-on-а ────────────
  const withHa = await runAndListen(haToken());
  try {
    assert.ok(withHa.healthy, 'сървърът трябва да пали и с HA-подобен токен (предупреждението не е отказ)');
    assert.match(withHa.output(), new RegExp(MARKER), 'предупреждението трябва да е в изхода на entrypoint-а');
    assert.doesNotMatch(withHa.output(), /ADMIN_TOKEN_REQUIRED/, 'валиден дълъг токен не бива да се отказва');
  } finally { await withHa.stop() }

  // ── 3. Обратната страна: обикновен токен не бива да вдига шум ─────────────
  const withPlain = await runAndListen('token-shape-test-0123456789abcdef');
  try {
    assert.ok(withPlain.healthy);
    assert.doesNotMatch(withPlain.output(), new RegExp(MARKER), 'обикновен токен не бива да предупреждава');
  } finally { await withPlain.stop() }

  console.log('admin-token-shape OK: ' + MARKER + ' · предупреждение без отказ · OIDC ≠ LLAT');
})().catch((e) => { console.error(e); process.exit(1) });
