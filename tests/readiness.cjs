'use strict';
// Readiness срещу liveness: /health е жив процес, /ready проверява зависимостите
// (запис в хранилището, отворена база, заредени правила) и е публичен за probe-ове.
const { stopChild } = require('./helpers.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-ready-'));
  const port = 36500 + Math.floor(Math.random() * 1200);
  const token = 'readiness-test-admin-token-1234567890';
  const base = `http://127.0.0.1:${port}`;
  let child;

  try {
    child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
      env: {
        ...process.env,
        DATA_DIR: dir,
        OPTIONS_PATH: path.join(dir, 'missing-options.json'),
        PORT: String(port),
        ADMIN_TOKEN: token,
        STORAGE_CHECK_INTERVAL_MS: '0',
      },
      stdio: 'ignore',
    });
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(base + '/health')).status === 200) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(ready, true, 'сървърът стартира');

    // 1. Liveness остава минимален и без детайли за вътрешността.
    const health = await fetch(base + '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    // 2. Readiness: публичен, без токен, с реални проверки.
    const response = await fetch(base + '/ready');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ready, true);
    assert.deepEqual(Object.keys(body.checks).sort(), ['db', 'rules', 'storage']);
    assert.equal(body.checks.storage, true, 'хранилището е записваемо');
    assert.equal(body.checks.db, true, 'базата е отворена');
    assert.equal(typeof body.uptime, 'number');
    assert.equal(body.dataDir, dir);

    // 3. Няма останали probe файлове след проверката.
    assert.equal(
      fs.readdirSync(dir).some((name) => name.startsWith('.ready-')),
      false,
      'probe файлът се изтрива',
    );

    console.log('PASS readiness: /health е liveness, /ready проверява storage + db + rules');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
