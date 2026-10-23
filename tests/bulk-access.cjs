'use strict';
const { stopChild, freePort } = require('./helpers.cjs');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-bulk-')); const port = await freePort(), token = 'admin-secret-12345678901234567890'; const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: token }, stdio: 'pipe' });
  const call = async (p, m = 'GET', data, auth = true, raw = false) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: { ...(auth ? { Authorization: 'Bearer ' + token } : {}), ...(raw ? { 'X-File-Name': 'test.txt' } : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : raw ? data : JSON.stringify(data) }); return { status: r.status, v: await r.json() } };
  try {
    let ready = false; for (let i = 0; i < 300; i++) { try { if ((await call('/health')).status === 200) { ready = true; break } } catch { } await new Promise(r => setTimeout(r, 50)) } assert(ready, 'сървърът не вдигна /health за 15 s (код ' + (child.exitCode ?? child.signalCode) + ')');
    const p = (await call('/admin/api/portals', 'POST', { slug: 'batch', title: 'Batch' })).v; const base = `/admin/api/portals/${p.id}`; const a = (await call(base + '/files', 'POST', 'AAA', true, true)).v; const b = (await call(base + '/files', 'POST', 'BBB', true, true)).v;
    const route = base + '/files/bulk-access', payload = { fileIds: [a.id, b.id], mode: 'KEY_REQUIRED', listed: false, dryRun: true };
    assert.equal((await call(route, 'POST', payload, false)).status, 401);
    assert.equal((await call(route, 'POST', { ...payload, fileIds: [a.id, 'missing'], dryRun: false })).status, 404);
    assert.equal((await call(route, 'POST', { ...payload, fileIds: [a.id, a.id] })).status, 400);
    const preview = await call(route, 'POST', payload); assert.equal(preview.status, 200); assert.equal(preview.v.count, 2);
    let state = (await call(base)).v; assert(state.files.every(f => f.accessMode === 'FREE' && f.listed));
    const applied = await call(route, 'POST', { ...payload, dryRun: false }); assert.equal(applied.status, 200); assert.equal(applied.v.count, 2);
    state = (await call(base)).v; assert(state.files.every(f => f.accessMode === 'KEY_REQUIRED' && !f.listed));
    assert.equal((await call(route, 'POST', { ...payload, mode: 'DISABLED', dryRun: false })).status, 200);
    state = (await call(base)).v; assert(state.files.every(f => f.accessMode === 'DISABLED'));
    console.log('PASS: batch policy auth, validation, dry-run isolation, apply');
  } finally { await stopChild(child); fs.rmSync(dir, { recursive: true, force: true }) }
})().catch(e => { console.error(e); process.exitCode = 1 });
