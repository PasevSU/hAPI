'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ОРАКУЛ: грешка на КЛИЕНТА не се записва като „unhandled“ (0.69.43).
//
// Дефектът (намерен от одита): всеки хвърлен отговор — включително очакваните
// „Invalid JSON“, „Invalid case number“, „Invalid email“ — се записваше като
// `ERROR http unhandled … status=400`. Резултатът: истинските 500-ци се удавят в шум,
// а централизираният дневник на грешките се пълни с неща, които не са грешки на сървъра.
//
// Тук се проверява РЕШЕНИЕТО, не текстът на кода: пуска се жив сървър с прихванат лог,
// пращат се само невалидни заявки и се търси какво е записано.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { stopChild } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const TOKEN = 'error-logging-token-3d7f10b6e8a24c95';
const PORT = 18430;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-errlog-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'hapi_enterprise', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(PORT), ADMIN_TOKEN: TOKEN, PUBLIC_GATEWAY_PORT: '0', LOG_LEVEL: 'debug' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = [];
  child.stdout.on('data', (d) => out.push(String(d)));
  child.stderr.on('data', (d) => out.push(String(d)));
  const base = `http://127.0.0.1:${PORT}`;
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(base + '/health')).ok) { ready = true; break } } catch { /* стартира */ }
      await new Promise((r) => setTimeout(r, 80));
    }
    assert(ready, 'сървърът не стартира');

    const auth = { Authorization: 'Bearer ' + TOKEN };
    const cases = [
      ['POST', '/admin/api/portals', '{bad json', 'application/json'],
      ['POST', '/admin/api/cases', JSON.stringify({ number: '' }), 'application/json'],
      ['PATCH', '/admin/api/settings', JSON.stringify({ maxUploadMb: -5 }), 'application/json'],
      ['POST', '/admin/api/qr-artifacts', JSON.stringify({}), 'application/json'],
    ];
    for (const [method, route, body, type] of cases) {
      const res = await fetch(base + route, { method, headers: { ...auth, 'Content-Type': type }, body });
      assert(res.status >= 400 && res.status < 500, `${method} ${route}: очаква се 4xx, върна ${res.status}`);
    }
    // Дава възможност на логването да стигне до файловете/потока.
    await new Promise((r) => setTimeout(r, 400));

    const log = out.join('');
    const rejected = (log.match(/request\.rejected/g) || []).length;
    const unhandled = (log.match(/unhandled/g) || []).length;
    // Част от отказите минават през `fail()` направо (без хвърляне) — те не бива да
    // оставят запис изобщо. Затова ключовото е: нито един „unhandled“ и нито един ERROR.
    assert.ok(rejected >= 1, 'отказите, които минават през изключение, се записват като request.rejected (намерени: ' + rejected + ')');
    assert.equal(unhandled, 0, 'нито една грешка на клиента не се записва като „unhandled“ (намерени: ' + unhandled + ')');
    assert.equal(/\bERROR\b/img.test(log), false, 'няма ERROR записи от невалидните заявки');

    // Централизираният дневник на грешките остава празен — там влизат само 5xx.
    const listed = await (await fetch(base + '/admin/api/logs', { headers: auth })).json();
    const httpEntries = (listed.entries || listed.logs || []).filter((e) => e.source === 'http');
    assert.deepEqual(httpEntries, [], 'дневникът на грешките не бива да съдържа грешки на клиента: ' + JSON.stringify(httpEntries).slice(0, 200));

    console.log('PASS error-logging: ' + cases.length + ' отказани заявки → request.rejected, 0 „unhandled“, дневникът на грешките е чист');
  } finally {
    await stopChild(child).catch(() => { });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows може да държи файла */ }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
