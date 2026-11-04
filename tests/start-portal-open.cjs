'use strict';
// ДОГОВОР (0.69.150): ПУБЛИЧНИЯТ портал се отваря на голия си адрес — И ПРЕЗ РЕАЛНИЯ ENTRYPOINT.
//
// Защо този тест съществува: всички останали тестове пускат `server.js` директно, а add-on-ът
// върви през `start.js`, който налагаше `env.REQUIRE_PORTAL_TOKEN = 'true'`. Затова на реалната
// инсталация ВСЕКИ адрес на портал (вкл. публичен и QR кодът) отговаряше 404 с
// `portal.access.denied · reason: no-identity`, докато тестовете бяха зелени. Разликата между
// „кодът работи“ и „продуктът работи“ е точно този вход.
//
// Тук се проверява РЕЗУЛТАТЪТ през `start.js`:
//   1. по подразбиране публичният портал се отваря на `/p/<id>` (200 + страницата на портала);
//   2. чаственият портал на голия си адрес е 404 (не издава, че съществува);
//   3. с `REQUIRE_PORTAL_TOKEN=true` и публичният е 404 — режимът остава достъпен за този,
//      който съзнателно го иска.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { freePort, stopTree } = require('./helpers.cjs');

const ENTRY = path.join(__dirname, '../hapi_enterprise/start.js');
const TOKEN = 'portal-open-test-0123456789abcdef';

async function boot(extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-open-'));
  const dataDir = path.join(tmp, 'data');
  const storageRoot = path.join(tmp, 'storage');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'addon_config'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'options.json'), JSON.stringify({ token: TOKEN, storage_location: 'addon_config', storage_subdirectory: 'hapi_enterprise' }));
  const port = await freePort();
  const adminPort = await freePort();
  const child = spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      HAPI_ADDON_DATA_DIR: dataDir,
      OPTIONS_PATH: path.join(dataDir, 'options.json'),
      STORAGE_ROOT_OVERRIDE: storageRoot,
      PUBLIC_GATEWAY_PORT: '0',
      PORT: String(port),
      ADMIN_PORT: String(adminPort),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  child.stderr.resume();
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(base + '/health')).status === 200) break;
    } catch { /* още не слуша */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { base, child, stop: () => stopTree(child, { storageBase: path.join(storageRoot, 'addon_config', 'hapi_enterprise') }) };
}

async function makePortal(base, slug, visibility) {
  const res = await fetch(base + '/admin/api/portals', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ slug, title: 'Портал ' + slug, visibility }),
  });
  const data = await res.json();
  assert.equal(res.status, 201, 'порталът е създаден: ' + JSON.stringify(data));
  return data;
}

const statusOf = async (base, p) => {
  const res = await fetch(base + p, { redirect: 'manual' });
  const body = await res.text();
  return { status: res.status, body };
};

(async () => {
  // ── 1. По подразбиране: публичният се отваря ────────────────────────────────
  const plain = await boot({});
  try {
    const isPublic = await makePortal(plain.base, 'open-public', 'public');
    const isPrivate = await makePortal(plain.base, 'open-private', 'private');
    const opened = await statusOf(plain.base, '/p/' + isPublic.id);
    assert.equal(opened.status, 200, 'публичният портал се отваря на голия адрес (без токен в средата)');
    assert.ok(opened.body.includes('/portal.js'), 'връща се истинската страница на портала');
    const hidden = await statusOf(plain.base, '/p/' + isPrivate.id);
    assert.equal(hidden.status, 404, 'частният портал не се отваря без подписан достъп');
    console.log('PASS start-portal-open: публичен → 200 (страницата на портала), частен → 404');
  } finally {
    await plain.stop();
  }

  // ── 2. Съзнателно включен режим: и публичният иска токен ────────────────────
  const hardened = await boot({ REQUIRE_PORTAL_TOKEN: 'true' });
  try {
    const isPublic = await makePortal(hardened.base, 'open-public-2', 'public');
    const blocked = await statusOf(hardened.base, '/p/' + isPublic.id);
    assert.equal(blocked.status, 404, 'REQUIRE_PORTAL_TOKEN=true връща 404 и за публичен портал');
    console.log('PASS start-portal-open: REQUIRE_PORTAL_TOKEN=true → 404 (режимът е по избор, не закован)');
  } finally {
    await hardened.stop();
  }
})().catch((e) => { console.error('FAIL start-portal-open:', e && e.message ? e.message : e); process.exit(1); });
