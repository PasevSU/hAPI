'use strict';
// Сценарий: readiness стига по-дълбоко от „процесът отговаря“.
//
//   • чистото решение (readiness.js) се проверява във всяко състояние —
//     ok / degraded / failed — за да не зависи от случайно повредена база;
//   • sqlite-store.quickCheck() (PRAGMA quick_check) връща реален резултат;
//   • живият сървър връща db.state='ok' и остава 200, когато базата е здрава.
//
// Повредена база → 503 и db.state='degraded': probe-ът спира трафика, вместо
// add-on-ът да пише върху повредени страници.
const { stopChild } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { evaluate } = require('../hapi_enterprise/readiness');
const store = require('../hapi_enterprise/sqlite-store');

(async () => {
  // ── 1. Решението: всички състояния ────────────────────────────────────────
  const healthy = evaluate({
    storageOk: true,
    metadata: { portals: [] },
    quickCheck: () => ({ ok: true, result: 'ok' }),
  });
  assert.equal(healthy.ready, true);
  assert.equal(healthy.dbState, 'ok');
  assert.equal(healthy.dbDetail, 'ok');
  assert.deepEqual(healthy.checks, { storage: true, db: true, rules: false });

  const corrupt = evaluate({
    storageOk: true,
    metadata: { portals: [] },
    quickCheck: () => ({ ok: false, result: 'database disk image is malformed' }),
  });
  assert.equal(corrupt.ready, false, 'повредена база не е ready');
  assert.equal(corrupt.dbState, 'degraded');
  assert.equal(corrupt.checks.db, true, 'базата е четяща, но нездрава — checks.db остава true');
  assert.match(corrupt.dbDetail, /malformed/);

  const thrown = evaluate({
    storageOk: true,
    metadata: { portals: [] },
    quickCheck: () => {
      throw Error('disk I/O error');
    },
  });
  assert.equal(thrown.dbState, 'degraded');
  assert.match(thrown.dbDetail, /disk I\/O/);

  const invalid = evaluate({ storageOk: true, metadata: { nope: 1 }, quickCheck: () => ({ ok: true }) });
  assert.equal(invalid.dbState, 'degraded');
  assert.match(invalid.dbDetail, /invalid/);

  const noMetadata = evaluate({ storageOk: true, metadata: null });
  assert.equal(noMetadata.dbState, 'failed');
  assert.equal(noMetadata.checks.db, false);
  assert.equal(noMetadata.ready, false);

  const noStorage = evaluate({ storageOk: false, metadata: { portals: [] }, quickCheck: () => ({ ok: true }) });
  assert.equal(noStorage.ready, false, 'без записваемо хранилище няма readiness');

  // Без quickCheck (по-стара база) не се лъжем: приема се за здрава, но е отбелязано.
  const skipped = evaluate({ storageOk: true, metadata: { portals: [] } });
  assert.equal(skipped.dbState, 'ok');
  assert.equal(skipped.dbDetail, 'skipped');

  // ── 2. Реалната проверка на SQLite ───────────────────────────────────────
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-qc-'));
  const dbPath = path.join(dbDir, 'metadata.sqlite');
  const metadata = store.open(dbPath);
  try {
    metadata.save({ portals: [], qrArtifacts: [] });
    const quick = metadata.quickCheck();
    assert.equal(quick.ok, true, `quickCheck на здрава база: ${JSON.stringify(quick)}`);
    assert.equal(quick.result, 'ok');
  } finally {
    metadata.close();
  }

  // ── 3. Живият сървър: db.state в /ready ──────────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-ready-int-'));
  const port = 34100 + Math.floor(Math.random() * 700);
  const token = 'ready-integrity-admin-token-0123456789';
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
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
  try {
    let ready = false;
    for (let i = 0; i < 140; i++) {
      try {
        if ((await fetch(base + '/health')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, 'сървърът стартира');

    const probe = await fetch(base + '/ready');
    assert.equal(probe.status, 200);
    const body = await probe.json();
    assert.equal(body.ready, true);
    assert.equal(body.db.state, 'ok', `db.state: ${JSON.stringify(body.db)}`);
    assert.equal(body.db.detail, 'ok');
    assert.deepEqual(Object.keys(body.checks).sort(), ['db', 'rules', 'storage'], 'checks остава стабилен договор');
    assert.equal(body.checks.db, true);
    assert.equal(body.checks.storage, true);

    // Състоянието е видимо и след като базата е получила данни.
    const created = await fetch(base + '/admin/api/portals', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'ready-int', title: 'Ready integrity' }),
    });
    assert.equal(created.status, 201);
    const again = await (await fetch(base + '/ready')).json();
    assert.equal(again.ready, true);
    assert.equal(again.db.state, 'ok');

    console.log(
      'PASS readiness integrity: ok/degraded/failed решение, PRAGMA quick_check, db.state в /ready',
    );
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
