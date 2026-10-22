'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
const { create } = require('../hapi_enterprise/config-profiles');
(async () => {
  // Unit: save/list/get/remove + validation of name and settings
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-profiles-'));
  const prof = create(dir);
  assert.equal((await prof.list()).length, 0);
  const saved = await prof.save('profile-a', { organization: 'Acme' }); assert.equal(saved.settings.organization, 'Acme');
  assert.equal((await prof.list()).length, 1);
  assert.equal((await prof.get('profile-a')).settings.organization, 'Acme');
  assert.equal(await prof.get('nope'), null);
  await assert.rejects(() => prof.save('Bad Name!', {}), e => e.status === 400);
  await assert.rejects(() => prof.save('x', { unknownSetting: 1 }), e => /Unknown setting/.test(e.message));
  assert.equal(await prof.remove('profile-a'), true); assert.equal(await prof.remove('profile-a'), false);

  // API: list/save/apply/delete with admin auth
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-profiles-api-'));
  const { freePort } = require('./helpers.cjs');
  const port = await freePort(), token = 'profile-test-admin-token-1234567890';
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env: { ...process.env, DATA_DIR: root, PORT: String(port), ADMIN_TOKEN: token }, stdio: 'ignore' });
  const call = async (route, method = 'GET', data, headers = {}) => { const x = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { Authorization: 'Bearer ' + token, ...headers }, body: data === undefined ? undefined : data }); return { status: x.status, data: await x.json() } };
  try {
    let ready = false; for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { ready = true; break } } catch { } await new Promise(r => setTimeout(r, 50)) } assert(ready, 'server did not start');
    assert.equal((await fetch(`http://127.0.0.1:${port}/admin/api/config-profiles`)).status, 401);
    assert.equal((await call('/admin/api/config-profiles')).data.profiles.length, 0);
    const created = await call('/admin/api/config-profiles', 'POST', JSON.stringify({ name: 'test-profile', settings: { organization: 'Acme' } }), { 'Content-Type': 'application/json' });
    assert.equal(created.status, 201); assert.equal(created.data.profile.name, 'test-profile');
    assert.equal((await call('/admin/api/config-profiles')).data.profiles.length, 1);
    assert.equal((await call('/admin/api/config-profiles/nope')).status, 404);
    const applied = await call('/admin/api/config-profiles/test-profile/apply', 'POST');
    assert.equal(applied.status, 200); assert.equal(applied.data.settings.organization, 'Acme');
    const deleted = await call('/admin/api/config-profiles/test-profile', 'DELETE'); assert.equal(deleted.status, 200);
    assert.equal((await call('/admin/api/config-profiles/test-profile', 'DELETE')).status, 404);
    console.log('PASS config profiles: unit validation + admin API list/save/apply/delete');
  } finally { child.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }) } catch { } }
})().catch(e => { console.error(e); process.exitCode = 1 });
