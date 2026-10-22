'use strict';
// ОРАКУЛ: спирането в СПОДЕЛЕН режим (HAPI_SHARED_DATA=1) наистина сваля регистрацията.
//
// Дефектът от 0.69.19: `shutdown` е извън `try` блока на `start()`, а `sharedMode` и `lock`
// бяха вътре в него — при SIGTERM логът показваше `instance.release.failed err=sharedMode is
// not defined` и записът в `.hapi-peers/` оставаше. Затова тук се проверява точният резултат:
//   • докато процесът работи, регистърът има точно един участник;
//   • след SIGTERM процесът излиза с код 0;
//   • регистърът е празен (регистрацията е свалена, а не оставена на произвола);
//   • в изхода НЯМА `instance.release.failed`.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const instanceLock = require('../hapi_enterprise/instance-lock');

const waitExit = (child, timeoutMs = 10000) =>
  new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timer = setTimeout(() => reject(new Error('процесът не излезе за ' + timeoutMs + ' ms')), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code === null ? 0 : code);
    });
  });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-shutdown-'));
  const token = 'shutdown-' + crypto.randomBytes(18).toString('hex');
  const server = await startServer({ dataDir: dir, token, keepData: true, env: { HAPI_SHARED_DATA: '1' } });
  try {
    const peersWhileRunning = instanceLock.listShared({ dir });
    assert.equal(peersWhileRunning.length, 1, 'докато работи, регистърът има точно един участник');
    // `self` се смята спрямо ТЕКУЩИЯ процес, а сървърът тук е дете — затова се сверява pid-ът
    // на детето, не флагът: важното е, че регистриран е точно процесът-сървър.
    assert.equal(peersWhileRunning[0].pid, server.child.pid, 'участникът е процесът на сървъра (детето)');

    server.child.kill('SIGTERM');
    const code = await waitExit(server.child);
    assert.equal(code, 0, 'процесът излиза чисто с код 0');

    const peersAfter = instanceLock.listShared({ dir });
    assert.equal(peersAfter.length, 0, 'след SIGTERM регистърът е празен (регистрацията е свалена)');
    const stderr = server.logs();
    assert.equal(/instance\.release\.failed/.test(stderr), false, 'в изхода няма instance.release.failed: ' + stderr.trim().slice(-300));

    console.log('PASS shared-mode-shutdown: регистърът има един участник · SIGTERM излиза с 0 · регистрацията се сваля · без instance.release.failed');
  } finally {
    await server.stop({ keep: true }).catch(() => { });
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
