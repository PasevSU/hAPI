'use strict';
// Изолация на ПУБЛИЧНИЯ Gateway listener (порт 8088 в add-on-а).
//
// Проблемът: listener-ът е отворен към интернет, а досега отбиваше само `/admin`, `/ui`
// и `/generator`. Всичко останало минаваше — включително административни API-та, които
// някой добави по-късно. Тук се проверява точно обратното: разрешено е САМО изброеното.
//
// Тестът държи три неща:
//   1. чистата функция (какво пуска и какво не, вкл. методите);
//   2. че списъкът не е „широк“ (няма правило, което пуска всичко под `/admin`);
//   3. на живо: Gateway listener-ът връща 404 за административните пътища и 200 за
//      публичните — с истински сървър, не само с регулярни изрази.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { stopChild, freePort } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const allowlist = require(path.join(ROOT, 'hapi_enterprise', 'public-route-allowlist.js'));

// ── 1. Какво пуска ──────────────────────────────────────────────────────────
const allowed = [
  ['/', 'GET'],
  ['/p/0123456789abcdef01234567', 'GET'],
  ['/p/demo-portal/', 'GET'],
  ['/portal.html', 'GET'],
  ['/portal.js', 'GET'],
  ['/portal.css', 'GET'],
  ['/portal-i18n.js', 'GET'],
  ['/secret', 'GET'],
  ['/secret-view.js', 'GET'],
  ['/qr/abc-123_x', 'GET'],
  ['/s/send-id_1', 'GET'],
  ['/site/demo/proj1/', 'GET'],
  ['/site/demo/proj1/index.html', 'GET'],
  ['/api/v1/p/demo', 'GET'],
  ['/api/v1/p/demo/manifest', 'GET'],
  ['/api/v1/p/demo/qr.svg', 'GET'],
  ['/api/v1/p/demo/files/abc/download', 'GET'],
  ['/api/v1/p/demo/files/abc/preview', 'GET'],
  ['/api/v1/p/demo/tree/api.json', 'GET'],
  ['/api/v1/p/demo/package/tok', 'GET'],
  ['/api/v1/p/demo/package', 'POST'],
  ['/api/v1/p/demo/files/abc/rating', 'POST'],
  ['/api/v1/portals', 'GET'],
  ['/api/v1/sends/abc/access', 'POST'],
  ['/api/v1/sends/abc/file', 'GET'],
  ['/api/v2/secrets/' + 'a'.repeat(64), 'GET'],
  ['/api/v2/secrets/' + 'a'.repeat(64) + '/reveal', 'POST'],
  ['/api/v1/auth/login', 'POST'],
  ['/api/v1/auth/logout', 'POST'],
  ['/api/v1/auth/me', 'GET'],
  ['/api/public/v1/portals/demo', 'GET'],
  ['/api/public/v1/portals/demo/files', 'GET'],
  ['/api/public/v1/files/abc/access', 'GET'],
  ['/api/public/v1/files/abc/download', 'GET'],
  ['/p/0123456789abcdef01234567', 'HEAD'],
];
for (const [url, method] of allowed) {
  const verdict = allowlist.check(url, method);
  assert.equal(verdict.ok, true, `${method} ${url} трябва да е разрешен (${verdict.why})`);
}

// ── 2. Какво НЕ пуска ───────────────────────────────────────────────────────
const denied = [
  // Административни и вътрешни пътища.
  ['/admin', 'GET'], ['/admin/api/portals', 'GET'], ['/admin/api/portals', 'POST'],
  ['/admin/api/connection', 'GET'], ['/admin/api/users', 'GET'], ['/admin/api/settings', 'PATCH'],
  ['/admin/api/backup', 'POST'], ['/ui/', 'GET'], ['/ui/index.html', 'GET'], ['/ui/app.js', 'GET'],
  ['/ui/links.js', 'GET'], ['/hapi_enterprise/api-spec.js', 'GET'],
  ['/generator/', 'GET'], ['/generator/app.js', 'GET'],
  ['/health', 'GET'], ['/ready', 'GET'], ['/metrics', 'GET'],
  // Правилният път, но грешният метод.
  ['/api/v1/portals', 'POST'], ['/api/v1/p/demo', 'POST'], ['/api/v1/p/demo', 'DELETE'],
  ['/api/v1/p/demo/files/abc/download', 'POST'], ['/api/v1/sends/abc/access', 'GET'],
  ['/api/v2/secrets/' + 'a'.repeat(64), 'POST'], ['/api/v1/auth/login', 'GET'],
  // Подправени пътища (изход от списъка).
  ['/api/v1/p/demo/../../../admin/api/portals', 'GET'],
  ['/api/v1/p/%2e%2e/%2e%2e/admin/api/portals', 'GET'],
  ['/api/v1/p/demo%00admin', 'GET'],
  ['//admin/api/portals', 'GET'],
  ['/api/v1/p/demo/../../ui/index.html', 'GET'],
  // Несъществуващи/случайни пътища не минават „за всеки случай“.
  ['/api/v1/random', 'GET'], ['/p/', 'GET'], ['/qr/', 'GET'], ['/site/demo', 'GET'],
];
for (const [url, method] of denied) {
  const verdict = allowlist.check(url, method);
  assert.equal(verdict.ok, false, `${method} ${url} НЕ бива да е разрешен (${verdict.why})`);
}

// Списъкът е изричен: няма правило с „пусни всичко“, няма празен шаблон.
assert.ok(allowlist.RULES.length >= 20, 'правилата са изброени, не са един шаблон');
for (const rule of allowlist.RULES) {
  assert.ok(rule.why && rule.why.length >= 4, 'всяко правило казва защо съществува');
  assert.ok(['GET', 'POST'].includes(rule.method), 'методът е явен: ' + rule.method);
  assert.notEqual(String(rule.re), '/^\\/.*$/', 'няма правило „всичко“');
}

// ── 3. На живо: Gateway listener-ът наистина отказва ────────────────────────
const SEED = path.join(ROOT, 'tests', 'lib', 'gui-harness.cjs');
assert.ok(fs.existsSync(SEED), 'липсва тестов харнес');

async function live() {
  const pub = await freePort(), adm = await freePort(), gw = await freePort();
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hapi-gw-'));
  const env = {
    ...process.env, DATA_DIR: dir, ADMIN_TOKEN: 'gateway-allowlist-secret-4f7b2c',
    PORT: String(pub), ADMIN_PORT: String(adm), PUBLIC_GATEWAY_PORT: String(gw),
    PUBLIC_GATEWAY_BIND: '127.0.0.1', PUBLIC_BIND_HOST: '127.0.0.1',
  };
  const child = spawn(process.execPath, [path.join(ROOT, 'hapi_enterprise', 'server.js')], { env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${gw}`;
  try {
    // Изчакваме listener-а (максимум 15 s).
    let up = false;
    for (let i = 0; i < 150 && !up; i++) {
      try { const r = await fetch(base + '/'); await r.text(); up = true } catch { await new Promise((r2) => setTimeout(r2, 100)) }
    }
    assert.ok(up, 'Gateway listener-ът не стартира на ' + gw);
    // Публичното минава през allowlist-а (страницата на портала не съществува → 404 от
    // маршрута, но НЕ от allowlist-а; затова проверяваме `/` и `/api/v1/portals`).
    const root = await fetch(base + '/'); await root.text();
    assert.equal(root.status, 200, 'коренът е публичен');
    const catalog = await fetch(base + '/api/v1/portals'); await catalog.text();
    assert.ok([200, 404].includes(catalog.status), 'каталогът минава allowlist-а: ' + catalog.status);
    // Административните са 404 — и по трите начина, по които се опитахме.
    for (const target of ['/admin/api/portals', '/ui/index.html', '/generator/app.js', '/admin/api/connection', '/health', '/ready']) {
      const r = await fetch(base + target, { headers: { Authorization: 'Bearer gateway-allowlist-secret-4f7b2c' } });
      await r.text();
      assert.equal(r.status, 404, 'Gateway не бива да пуска ' + target + ' → ' + r.status);
    }
    // Подправен път също не стига до административното API.
    const sneaky = await fetch(base + '/api/v1/p/demo/../../../admin/api/portals');
    await sneaky.text();
    assert.equal(sneaky.status, 404, 'подправеният път не стига до /admin');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

live()
  .then(() => {
    process.stdout.write(
      'PASS public-route-allowlist: ' + allowlist.RULES.length + ' правила · ' +
      allowed.length + ' разрешени · ' + denied.length + ' отказани · Gateway listener на живо отказва /admin, /ui, /generator, /health, /ready\n'
    );
  })
  .catch((e) => { process.stderr.write('FAIL public-route-allowlist: ' + (e && e.message ? e.message : e) + '\n'); process.exitCode = 1; });
