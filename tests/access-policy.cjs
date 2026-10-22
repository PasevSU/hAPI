'use strict';
const { stopChild, freePort } = require('./helpers.cjs');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-policy-')); const port = await freePort(), admin = 'test-admin-secret-1234567890123456'; const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: admin }, stdio: 'pipe' });
  const call = async (p, method = 'GET', data, auth = false, headers = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { ...(auth ? { Authorization: 'Bearer ' + admin } : {}), ...headers }, body: data }); let v; try { v = await r.json() } catch { v = null } return { status: r.status, v } };
  const j = (p, m, d) => call(p, m, JSON.stringify(d), true, { 'Content-Type': 'application/json' });
  try {
    let ready = false; for (let i = 0; i < 100; i++) { try { if ((await call('/health')).status === 200) { ready = true; break } } catch { } await new Promise(r => setTimeout(r, 30)) } assert(ready);
    const p = (await j('/admin/api/portals', 'POST', { slug: 'secure', title: 'Secure' })).v; const f = (await call(`/admin/api/portals/${p.id}/files`, 'POST', 'data', true, { 'X-File-Name': 'data.txt' })).v;
    const file = `/api/v1/p/secure/files/${f.id}/download`; const base = `/admin/api/portals/${p.id}/files/${f.id}`;
    await j('/admin/api/users', 'POST', { username: 'policyuser', password: 'policy-pass-123', scopes: ['read', 'download'] });
    const key = (await call('/api/v1/auth/login', 'POST', JSON.stringify({ username: 'policyuser', password: 'policy-pass-123' }), false, { 'Content-Type': 'application/json' })).v.token;
    const portalHeaders = { Authorization: 'Bearer ' + key };
    assert.equal((await call(file, 'GET', undefined, false, portalHeaders)).status, 200);
    assert.equal((await j(base + '/access', 'PATCH', { mode: 'KEY_REQUIRED' })).status, 200);
    assert.equal((await call(file, 'GET', undefined, false, portalHeaders)).status, 403);
    assert.equal((await j(base + '/signed-url', 'POST', { ttlSeconds: 300 })).status, 403);
    const k = (await j(base + '/access-keys', 'POST', { expiresAt: null })).v;
    assert.equal(k.expiresAt, null);
    assert.equal((await call(file, 'GET', undefined, false, { ...portalHeaders, 'X-File-Key': k.key })).status, 200);
    assert.equal((await call(file, 'GET', undefined, false, { ...portalHeaders, 'X-File-Key': 'invalid' })).status, 403);
    assert.equal((await call(base + '/access-keys/' + k.id, 'DELETE', undefined, true)).status, 200);
    assert.equal((await call(file, 'GET', undefined, false, { ...portalHeaders, 'X-File-Key': k.key })).status, 403);
    assert.equal((await j(base + '/access', 'PATCH', { mode: 'DISABLED' })).status, 200);
    assert.equal((await call(file, 'GET', undefined, false, portalHeaders)).status, 403);
    assert.equal((await j(base + '/access', 'PATCH', { mode: 'FREE', listed: false })).status, 200);
    assert.equal((await call('/api/v1/p/secure/files', 'GET', undefined, false, portalHeaders)).v.files.length, 0);
    assert.equal((await call(file, 'GET', undefined, false, portalHeaders)).status, 404);
    console.log('PASS: file FREE/KEY_REQUIRED/DISABLED, never-expiring key, revocation, hidden file, signed-url restriction');
  } finally { await stopChild(child); fs.rmSync(dir, { recursive: true, force: true }) }
})().catch(e => { console.error(e); process.exitCode = 1 });
