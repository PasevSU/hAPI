'use strict';
// Съдебна роля и GUI-ят: `/admin/api/whoami` трябва да отговаря и на съдията.
//
// Защо е тест, а не ред в документацията: GUI-ят взима `capabilities` от `whoami`
// (`ui/app.js` → `loadCapabilities()`), а регистърът на панелите по тях решава кои
// панели да монтира (`ui/panel-registry.js`). Ако съдебна роля получи 403 от `whoami`,
// `capabilities` остава `null`, регистърът чете „ролята не е известна“ и НЕ филтрира —
// тоест съдът вижда настройките и пакетите, а всяка тяхна заявка пада с 403. Тоест
// липсата на право за `whoami` не пази нищо, а показва повече, отколкото трябва.
// Тестът говори с ЖИВ сървър през ingress listener-а, не само с таблицата на `rbac`.
const { stopChild, freePort } = require('./helpers.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const { create: createRegistry } = require('../hapi_enterprise/ui/panel-registry.js');

const ok = (name) => console.log('  ✔ ' + name);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-court-whoami-'));
  const optionsPath = path.join(dir, 'options.json');
  fs.writeFileSync(
    optionsPath,
    JSON.stringify({ user_roles: '{"judge.ivanov":"judge","clerk.petrova":"clerk","expert.dimitrov":"expert"}' }),
    'utf8',
  );
  const port = await freePort();
  const adminPort = await freePort();
  const token = 'court-whoami-test-admin-token-1234567890';
  const base = `http://127.0.0.1:${port}`;
  const adminBase = `http://127.0.0.1:${adminPort}`;
  let child;

  const call = async (url, headers = {}) => {
    const res = await fetch(url, { headers });
    // Тялото не винаги е JSON (403 от вратата също е JSON, но 404 на ingress — не).
    const value = await res.json().catch(() => null);
    return { status: res.status, value };
  };
  // Всяка заявка носи самоличността по начина, по който HA я подава на ingress.
  const as = (name, extra = {}) => ({ 'X-Remote-User-Name': name, ...extra });

  try {
    child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
      env: {
        ...process.env,
        DATA_DIR: dir,
        OPTIONS_PATH: optionsPath,
        PORT: String(port),
        ADMIN_TOKEN: token,
        INGRESS_MODE: 'true',
        ADMIN_PORT: String(adminPort),
        ADMIN_BIND_HOST: '127.0.0.1',
        USER_ROLES: '',
        GROUP_ROLES: '',
      },
      stdio: 'ignore',
    });
    for (let i = 0; i < 120; i++) {
      try {
        if ((await call(base + '/health')).status === 200) break;
      } catch {
        // сървърът още не слуша — това е нормално в първите няколко опита
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    // 1. Съдията получава отговор от `whoami` — и то собствените си права.
    {
      const r = await call(adminBase + '/admin/api/whoami', as('judge.ivanov'));
      assert.equal(r.status, 200, 'съдията трябва да може да попита кой е, получено: ' + r.status);
      assert.equal(r.value.role, 'judge', 'ролята е съдебната, не подразбиращата се');
      assert.ok(Array.isArray(r.value.capabilities), 'whoami връща capabilities за съдията');
      assert.ok(r.value.capabilities.includes('evidence'), 'съдът вижда доказателствата');
      assert.ok(!r.value.capabilities.includes('settings'), 'съдът НЕ получава настройките');
      assert.ok(!r.value.capabilities.includes('portals'), 'съдът НЕ създава портали');
      ok('whoami отговаря на съдията с неговите (тесни) права');
    }

    // 2. Останалите съдебни роли също — тестът не бива да минава само за една.
    for (const [name, role] of [['clerk.petrova', 'clerk'], ['expert.dimitrov', 'expert']]) {
      const r = await call(adminBase + '/admin/api/whoami', as(name));
      assert.equal(r.status, 200, name + ' (' + role + ') трябва да получи whoami, получено: ' + r.status);
      assert.equal(r.value.role, role);
      assert.ok(!r.value.capabilities.includes('settings'), role + ' не получава настройките');
    }
    ok('clerk и expert също получават whoami, без административни права');

    // 3. Правата от `whoami` стигат до GUI-я и той СКРИВА панелите, които искат повече.
    {
      const who = await call(adminBase + '/admin/api/whoami', as('judge.ivanov'));
      const caps = [...who.value.capabilities]; // от JSON, не от VM контекст
      const registry = createRegistry({});
      registry.register({ id: 'settings', global: 'P', capabilities: ['settings'] });
      registry.register({ id: 'packages', global: 'P', capabilities: ['packages'] });
      registry.register({ id: 'portals', global: 'P', capabilities: ['portals'] });
      registry.register({ id: 'cases', global: 'P', capabilities: ['cases'] });
      registry.register({ id: 'dashboard', global: 'P' });
      assert.equal(registry.allowed('settings', caps), false, 'настройките са скрити за съда');
      assert.equal(registry.allowed('packages', caps), false, 'пакетите са скрити за съда');
      assert.equal(registry.allowed('portals', caps), false, 'порталите са скрити за съда');
      assert.equal(registry.allowed('dashboard', caps), true, 'общият панел остава');
      ok('capabilities от whoami водят до скрит панел, а не до 403 след клик');
    }

    // 4. Отказът остава отказ: съдът не влиза в настройките през API-то.
    {
      const r = await call(adminBase + '/admin/api/settings', as('judge.ivanov'));
      assert.equal(r.status, 403, 'настройките са забранени за съда, получено: ' + r.status);
      const admin = await call(adminBase + '/admin/api/settings', { Authorization: 'Bearer ' + token });
      assert.equal(admin.status, 200, 'admin продължава да влиза в настройките');
      ok('whoami не отваря нищо: settings остава 403 за съда и 200 за admin');
    }

    console.log('PASS court-whoami: 4 проверки — съдебна роля пита whoami · clerk/expert също · GUI скрива по capabilities · settings остава 403');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error('FAIL court-whoami:', e.message);
  process.exit(1);
});
