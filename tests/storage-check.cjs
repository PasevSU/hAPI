'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
const { check, checkLocation } = require('../hapi_enterprise/storage-check');
(async () => {
  // Unit: directory writable, file is not a directory, missing path
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-storage-'));
  const r = await check([dir]); assert.equal(r.healthy, true); assert.equal(r.locations[0].writable, true);
  const file = path.join(dir, 'plain.txt'); fs.writeFileSync(file, 'x');
  assert.equal((await checkLocation(file)).error, 'NOT_A_DIRECTORY');
  assert.equal((await checkLocation(path.join(dir, 'missing'))).available, false);

  // API: status + on-demand check are admin-gated and healthy in a fresh data dir
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-storage-api-'));
  const { freePort } = require('./helpers.cjs');
  const port = await freePort(), token = 'storage-test-admin-token-1234567890';
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env: { ...process.env, DATA_DIR: root, PORT: String(port), ADMIN_TOKEN: token, STORAGE_CHECK_INTERVAL_MS: '0' }, stdio: 'ignore' });
  const call = async (route, method = 'GET') => { const x = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { Authorization: 'Bearer ' + token } }); return { status: x.status, data: await x.json() } };
  try {
    let ready = false; for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { ready = true; break } } catch { } await new Promise(r => setTimeout(r, 50)) } assert(ready, 'server did not start');
    assert.equal((await fetch(`http://127.0.0.1:${port}/admin/api/storage/status`)).status, 401);
    const st = await call('/admin/api/storage/status'); assert.equal(st.status, 200); assert(Array.isArray(st.data.locations));
    const chk = await call('/admin/api/storage/check', 'POST'); assert.equal(chk.status, 200); assert.equal(chk.data.healthy, true);
    console.log('PASS storage check: unit probes + admin API status/check');
  } finally { child.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }) } catch { } }
})().catch(e => { console.error(e); process.exitCode = 1 });
