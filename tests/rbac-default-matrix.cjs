'use strict';
// Сценарий: администраторските права са ПО ПОДРАЗБИРАНЕ, профилите са опционални.
//
// Проверява се цялата матрица роля × способност × метод, както и трите пътя до роля:
//   1. bearer токен (admin/operator/viewer),
//   2. Ingress идентичност без карта → admin (fallback),
//   3. Ingress идентичност с карта → точно тази роля (може и понижаване).
// Плюс `DEFAULT_ROLE`, който сменя fallback-а за цялата инсталация.
const { stopChild } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { create, CAPABILITIES } = require('../hapi_enterprise/rbac');

const token = (prefix) => `${prefix}-${'x'.repeat(32)}`;
const ingress = (user, groups) => ({
  ingress: true,
  headers: {
    'x-remote-user': user || '',
    'x-remote-groups': (groups || []).join(','),
  },
});

async function boot(env, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-rbac-default-'));
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      OPTIONS_PATH: path.join(dir, 'missing-options.json'),
      PORT: String(port),
      ADMIN_PORT: String(port + 1),
      INGRESS_MODE: 'true',
      ADMIN_BIND_HOST: '127.0.0.1',
      ADMIN_TOKEN: token('rbac-default-admin'),
      ...env,
    },
    stdio: 'ignore',
  });
  const call = async (route, { method = 'GET', headers = {}, bearer, body } = {}) => {
    const res = await fetch(`http://127.0.0.1:${port + 1}${route}`, {
      method,
      headers: {
        ...headers,
        ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let value = null;
    try {
      value = await res.json();
    } catch {
      value = null;
    }
    return { status: res.status, value };
  };
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(ready, `сървърът не стартира на ${port}`);
  return { child, call, dir };
}

(async () => {
  // ── 1. Матрица роля × способност × метод ──────────────────────────────────
  const admin = token('matrix-admin');
  const operator = token('matrix-operator');
  const viewer = token('matrix-viewer');
  const rbac = create({ adminToken: admin, operatorToken: operator, viewerToken: viewer });
  const caps = Object.keys(CAPABILITIES);
  assert.ok(caps.length >= 20, `очаквам поне 20 способности, намерих ${caps.length}`);

  let checked = 0;
  for (const cap of caps) {
    const declared = CAPABILITIES[cap];
    // admin минава навсякъде (включително непозната способност: ролята е преди матрицата).
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      assert.equal(rbac.allowed('admin', cap, method), true, `admin трябва да може ${cap} ${method}`);
      checked++;
    }
    for (const role of ['operator', 'viewer']) {
      const grant = declared[role];
      assert.equal(
        rbac.allowed(role, cap, 'GET'),
        grant === true || grant === 'read',
        `${role} GET ${cap}: очаквано ${grant === true || grant === 'read'}`,
      );
      assert.equal(
        rbac.allowed(role, cap, 'POST'),
        grant === true,
        `${role} POST ${cap}: само изрично разрешение дава запис`,
      );
      // 'read' важи само за четящи методи — не за PUT/PATCH/DELETE.
      for (const method of ['PATCH', 'DELETE']) {
        assert.equal(rbac.allowed(role, cap, method), grant === true, `${role} ${method} ${cap}`);
        checked++;
      }
      checked += 2;
    }
    // Без роля няма достъп, дори за четене.
    assert.equal(rbac.allowed(null, cap, 'GET'), false);
    assert.equal(rbac.allowed(undefined, cap, 'POST'), false);
    checked += 2;
  }
  // Непозната способност: само admin (непознато ≠ позволено).
  assert.equal(rbac.allowed('operator', 'no-such-capability', 'GET'), false);
  assert.equal(rbac.allowed('viewer', '*', 'GET'), false);
  // viewer никога не пише — инвариант върху цялата матрица.
  for (const cap of caps) {
    assert.equal(rbac.allowed('viewer', cap, 'POST'), false, `viewer не бива да пише ${cap}`);
  }

  // ── 2. Резолюция без токен: admin по подразбиране ─────────────────────────
  assert.equal(rbac.resolve(ingress('')), 'admin', 'празна Ingress идентичност → admin');
  assert.equal(rbac.resolve(ingress('непознат')), 'admin', 'непознат потребител → admin');
  assert.equal(rbac.resolve(ingress('', ['guests'])), 'admin', 'непозната група → admin');
  assert.equal(rbac.defaultRole, 'admin');
  assert.equal(rbac.configured, false, 'без карти configured е false');

  const demoting = create({
    adminToken: admin,
    userRoles: { bob: 'operator', eve: 'viewer' },
    groupRoles: { sre: 'viewer', admins: 'admin' },
  });
  assert.equal(demoting.resolve(ingress('bob')), 'operator', 'картата понижава');
  assert.equal(demoting.resolve(ingress('eve')), 'viewer');
  assert.equal(demoting.resolve(ingress('', ['sre'])), 'viewer');
  assert.equal(demoting.resolve(ingress('bob', ['admins'])), 'operator', 'потребителят е с приоритет');
  assert.equal(demoting.resolve(ingress('carol', ['admins'])), 'admin', 'групата дава admin');
  assert.equal(demoting.resolve(ingress('carol')), 'admin', 'немаркиран остава admin');
  assert.equal(demoting.configured, true);

  const lowered = create({ adminToken: admin, defaultRole: 'viewer' });
  assert.equal(lowered.resolve(ingress('anyone')), 'viewer', 'DEFAULT_ROLE сменя fallback-а');
  assert.equal(create({ adminToken: admin, defaultRole: 'root' }).defaultRole, 'admin', 'невалиден DEFAULT_ROLE → admin');
  // Без ingress флаг SSO хедърите не се вярват — няма и fallback.
  assert.equal(rbac.resolve({ headers: { 'x-remote-user': 'alice' } }), null);
  assert.equal(rbac.resolve({ ingress: false, headers: {} }), null);

  // ── 3. API: немаркиран Ingress потребител е admin ─────────────────────────
  const first = await boot({}, 32100 + Math.floor(Math.random() * 500));
  try {
    const who = await first.call('/admin/api/whoami');
    assert.equal(who.status, 200, JSON.stringify(who.value));
    assert.equal(who.value.role, 'admin');
    assert.equal(who.value.defaultRole, 'admin');
    assert.equal(who.value.mapped, false, 'без карти няма mapping');
    // Пише, защото е admin по подразбиране.
    const created = await first.call('/admin/api/portals', {
      method: 'POST',
      body: { slug: 'default-admin', title: 'Default admin' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.value));
    // Admin-only маршрут също минава.
    assert.equal((await first.call('/admin/api/settings')).status, 200);
  } finally {
    await stopChild(first.child);
    fs.rmSync(first.dir, { recursive: true, force: true });
  }

  // ── 4. API: изрична карта понижава, DEFAULT_ROLE сменя fallback-а ─────────
  const second = await boot(
    { USER_ROLES: JSON.stringify({ bob: 'viewer' }), DEFAULT_ROLE: 'operator' },
    32600 + Math.floor(Math.random() * 500),
  );
  try {
    const bob = { 'X-Remote-User': 'bob' };
    assert.equal((await second.call('/admin/api/whoami', { headers: bob })).value.role, 'viewer');
    assert.equal((await second.call('/admin/api/portals', { headers: bob })).status, 200);
    assert.equal(
      (await second.call('/admin/api/portals', { method: 'POST', headers: bob, body: { slug: 'bob', title: 'bob' } }))
        .status,
      403,
      'viewer не пише',
    );
    const anon = await second.call('/admin/api/whoami');
    assert.equal(anon.value.role, 'operator', 'DEFAULT_ROLE=operator важи за немаркираните');
    assert.equal(anon.value.mapped, true);
    assert.equal((await second.call('/admin/api/settings')).status, 403, 'operator не пипа настройки');
    assert.equal((await second.call('/admin/api/portals')).status, 200, 'operator чете портали');
  } finally {
    await stopChild(second.child);
    fs.rmSync(second.dir, { recursive: true, force: true });
  }

  console.log(
    `PASS rbac default matrix: ${checked} проверки роля×способност×метод, default admin, ` +
      'карта за понижаване, DEFAULT_ROLE',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
