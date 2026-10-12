'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { validate } = require('../hapi_enterprise/runtime-config');

(async () => {
  // --- Unit: every settings group validates, invalid values throw ---
  const good = validate({
    organization: 'Court Alpha', project: 'Evidence', campaign: 'NO TRUST',
    artifactDirectory: 'qr_records', databaseFile: 'evidence.json', databaseDirectory: '.',
    backupSchedule: { enabled: true, intervalMinutes: 60, maxBackups: 5 },
    limits: { maxUploadMb: 100, maxDownloadStreams: 16, maxJobs: 2, storageCheckMinutes: 30, publicBaseUrl: 'https://portal.example.com', corsOrigin: 'https://home.example.com', requirePortalToken: true, storeRawIp: false },
    data: { conflictPolicy: 'queue', strictTaxonomy: true, defaultCategory: 'Inbox', defaultGroup: 'G1', maxTags: 20 },
    retention: { enabled: true, fileDays: 90, auditDays: 365, fileAction: 'delete' },
    preview: { enabled: true, thumbnails: true }
  });
  assert.equal(good.organization, 'Court Alpha');
  assert.equal(good.limits.maxUploadMb, 100);
  assert.equal(good.data.conflictPolicy, 'queue');
  assert.equal(good.retention.fileDays, 90);
  assert.equal(good.preview.thumbnails, true);
  assert.equal(good.backupSchedule.intervalMinutes, 60);

  assert.throws(() => validate({ unknownSetting: 1 }), /Unknown setting/);
  assert.throws(() => validate({ limits: { maxUploadMb: 9999 } }), /maxUploadMb/);
  assert.throws(() => validate({ limits: { maxJobs: 0 } }), /maxJobs/);
  assert.throws(() => validate({ data: { conflictPolicy: 'overwrite' } }), /conflictPolicy/);
  assert.throws(() => validate({ data: { maxTags: 0 } }), /maxTags/);
  assert.throws(() => validate({ retention: { fileDays: -1 } }), /retention days/);
  assert.throws(() => validate({ retention: { fileAction: 'shred' } }), /fileAction/);
  assert.throws(() => validate({ artifactDirectory: '../outside' }), /artifact directory/);
  assert.throws(() => validate({ databaseFile: 'bad name.json' }), /database file/);
  assert.throws(() => validate({ backupSchedule: { intervalMinutes: 0 } }), /backup interval/);
  assert.throws(() => validate({ preview: { enabled: 'yes' } }), /preview/);

  // --- API: settings GET/PATCH + notification center round-trip ---
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-settings-api-'));
  const port = 26000 + Math.floor(Math.random() * 10000);
  const token = 'settings-test-admin-token-1234567890';
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: { ...process.env, DATA_DIR: root, PORT: String(port), ADMIN_TOKEN: token }, stdio: 'ignore'
  });
  const call = async (route, method = 'GET', data, headers = {}) => {
    const h = { Authorization: 'Bearer ' + token, ...headers };
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: h, body: data === undefined ? undefined : data });
    return { status: r.status, data: await r.json() };
  };
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 50)); }
    assert(ready, 'server did not start');

    assert.equal((await fetch(`http://127.0.0.1:${port}/admin/api/settings`)).status, 401);

    const initial = await call('/admin/api/settings');
    assert.equal(initial.status, 200);
    assert.equal(initial.data.settings.organization, 'PasevSU DEV');
    assert.equal(typeof initial.data.effective.maxUploadBytes, 'number');
    assert.equal(initial.data.requiresRestartForDatabaseChange, true);

    const invalid = await call('/admin/api/settings', 'PATCH', JSON.stringify({ limits: { maxUploadMb: 99999 } }), { 'Content-Type': 'application/json' });
    assert.equal(invalid.status, 400);

    const patched = await call('/admin/api/settings', 'PATCH', JSON.stringify({ organization: 'Court Alpha', limits: { maxUploadMb: 50 } }), { 'Content-Type': 'application/json' });
    assert.equal(patched.status, 200);
    assert.equal(patched.data.settings.organization, 'Court Alpha');
    assert.equal(patched.data.settings.limits.maxUploadMb, 50);
    assert.equal(patched.data.effective.maxUploadBytes, 50 * 1048576);

    // The settings PATCH must have produced a notification-center event.
    const events = await call('/admin/api/events');
    assert.equal(events.status, 200);
    assert.equal(events.data.order, 'newest-first');
    assert.equal(typeof events.data.stats.total, 'number');
    const settingsEvent = events.data.events.find(e => e.kind === 'settings');
    assert(settingsEvent, 'settings_changed notification missing');
    assert.equal(settingsEvent.status, 'done');

    // clear only finished events
    const cleared = await call('/admin/api/events/clear', 'POST');
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.cleared, 1);

    console.log('PASS settings validation: all groups validate, invalid values reject, settings GET/PATCH + notification events API');
  } finally {
    child.kill();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
})().catch(e => { console.error(e); process.exitCode = 1 });
