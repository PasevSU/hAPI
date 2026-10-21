'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
const { create } = require('../hapi_enterprise/rbac');
(async () => {
  // Unit: ingress identity → role mapping (no bearer token).
  const rbac = create({
    adminToken: 'a'.repeat(32), operatorToken: 'b'.repeat(32), viewerToken: 'c'.repeat(32),
    userRoles: { alice: 'admin', bob: 'operator' }, groupRoles: { sre: 'viewer' }
  });
  const ing = (user, groups) => ({ ingress: true, headers: { 'x-remote-user': user || '', 'x-remote-groups': (groups || []).join(',') } });
  assert.equal(rbac.resolve(ing('alice')), 'admin');
  assert.equal(rbac.resolve(ing('bob')), 'operator');
  assert.equal(rbac.resolve(ing('', ['sre'])), 'viewer');
  assert.equal(rbac.resolve(ing('nobody', [])), 'admin', 'без профил ролята е admin по подразбиране');
  assert.equal(create({ adminToken: 'a'.repeat(32), operatorToken: null, viewerToken: null, userRoles: { bob: 'operator' }, defaultRole: 'viewer' }).resolve(ing('nobody', [])), 'viewer', 'defaultRole може да се свали с env');
  assert.equal(rbac.resolve(ing('bob')), 'operator', 'профилът има приоритет');
  // Home Assistant изпраща X-Remote-User-Id/-Name/-Display-Name (не X-Remote-User).
  const ha = h => ({ ingress: true, headers: h });
  assert.equal(rbac.resolve(ha({ 'x-remote-user-name': 'alice' })), 'admin', 'роля по X-Remote-User-Name');
  assert.equal(rbac.resolve(ha({ 'x-remote-user-id': 'alice' })), 'admin', 'роля по X-Remote-User-Id');
  assert.equal(rbac.resolve(ha({ 'x-remote-user-display-name': 'alice' })), 'admin', 'роля по X-Remote-User-Display-Name');
  assert.equal(create({ adminToken: 'a'.repeat(32), userRoles: { 'user-42': 'viewer' } }).resolve(ha({ 'x-remote-user-id': 'user-42' })), 'viewer', 'id-то е самостоятелен ключ в user_roles');
  // Non-ingress requests must never trust SSO headers.
  assert.equal(rbac.resolve({ ingress: false, headers: { 'x-remote-user': 'alice' } }), null);
  assert.equal(rbac.resolve({ ingress: false, headers: { 'x-remote-user-name': 'alice' } }), null, 'HA заглавките не важат извън ingress listener-а');

  // API: SSO role enforcement on the admin (ingress) listener.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-rbac-sso-'));
  const port = 28000 + Math.floor(Math.random() * 5000), adminPort = port + 1;
  const admin = 'sso-admin-token-0123456789ABCDEF';
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env,
      DATA_DIR: root, PORT: String(port), ADMIN_PORT: String(adminPort), INGRESS_MODE: 'true', ADMIN_TOKEN: admin,
      USER_ROLES: JSON.stringify({ alice: 'admin', bob: 'operator' }), GROUP_ROLES: JSON.stringify({ sre: 'viewer' })
    }, stdio: 'ignore'
  });
  const h = u => ({ 'X-Remote-User': u });
  const hg = g => ({ 'X-Remote-Groups': g });
  const call = async (port_, route, headers, method = 'GET', data) => { const x = await fetch(`http://127.0.0.1:${port_}${route}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: data }); return { status: x.status, data: await x.json() } };
  try {
    let ready = false; for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { ready = true; break } } catch { } await new Promise(r => setTimeout(r, 50)) } assert(ready, 'server did not start');
    // Public listener never trusts SSO headers and never serves /admin.
    assert.equal((await fetch(`http://127.0.0.1:${port}/admin/api/whoami`, { headers: { 'X-Remote-User': 'alice' } })).status, 404);
    // Admin listener: identity maps to role.
    const alice = await call(adminPort, '/admin/api/whoami', h('alice'));
    assert.equal(alice.data.role, 'admin');
    assert.equal(alice.data.ingress, true);
    assert.equal(alice.data.defaultRole, 'admin');
    assert.equal(alice.data.mapped, true, 'картата е зададена');
    assert.equal((await call(adminPort, '/admin/api/whoami', h('bob'))).data.role, 'operator');
    assert.equal((await call(adminPort, '/admin/api/whoami', hg('sre'))).data.role, 'viewer');
    assert.equal((await call(adminPort, '/admin/api/whoami', h('nobody'))).data.role, 'admin', 'непознат потребител получава admin');
    // Enforcement: alice (admin) reads portals; bob (operator) writes; sre (viewer) cannot write.
    assert.equal((await call(adminPort, '/admin/api/portals', h('alice'))).status, 200);
    assert.equal((await call(adminPort, '/admin/api/portals', h('bob'), 'POST', JSON.stringify({ slug: 'sso', title: 'SSO' }))).status, 201);
    assert.equal((await call(adminPort, '/admin/api/portals', hg('sre'), 'POST', JSON.stringify({ slug: 'x', title: 'x' }))).status, 403);
    console.log('PASS rbac sso: ingress identity/group role mapping, listener isolation, enforcement');
  } finally { child.kill(); try { fs.rmSync(root, { recursive: true, force: true }) } catch { } }
})().catch(e => { console.error(e); process.exitCode = 1 });
