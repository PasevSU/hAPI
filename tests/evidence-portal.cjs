'use strict';
// Evidence View порталът: публикуване в <HA config>/www/hapi/data.
//
// Проверява това, което лесно се чупи: точния път, идемпотентността (втори пуск не
// пренаписва файловете) и отказите — symlink на целта и цел извън www/hapi/data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const portal = require(path.join(__dirname, '..', 'hapi_enterprise', 'evidence-portal.js'));

// 1. Пакетът е пълен — иначе публикуването щеше да е половинчато.
assert.deepEqual(portal.missingSourceFiles(), [], 'всички файлове на портала са в пакета');

// 2. Откриване на HA конфигурацията: трябва configuration.yaml или www/.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-ha-config-'));
fs.writeFileSync(path.join(root, 'configuration.yaml'), 'default_config:\n');
assert.equal(portal.detectRoot([root]), root, 'разпознава HA конфигурация по configuration.yaml');
const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-empty-'));
assert.equal(portal.detectRoot([emptyRoot]), null, 'празна папка не се приема за HA конфигурация');

// 3. Целевият път е точно <root>/www/hapi/data.
assert.equal(portal.targetDir({ env: {}, roots: [root] }).dir, path.join(root, 'www', 'hapi', 'data'));
// Без HA конфигурация — ясна причина, не гадаене.
const noRoot = portal.targetDir({ env: {}, roots: [emptyRoot] });
assert.ok(noRoot.error && noRoot.error.includes('конфигурацията'), 'без HA конфигурация връща причина');

// 4. Публикуване: копира всичко, после не пипа непромененото.
const first = portal.deploy({ env: {}, roots: [root] });
assert.equal(first.ok, true, first.error);
assert.equal(first.copied.length, portal.FILES.length, 'първият пуск копира всички файлове');
assert.equal(first.unchanged.length, 0);
for (const rel of portal.FILES) {
  assert.ok(fs.existsSync(path.join(first.dir, rel)), `публикуван е ${rel}`);
}
const second = portal.deploy({ env: {}, roots: [root] });
assert.equal(second.copied.length, 0, 'вторият пуск не пренаписва нищо');
assert.equal(second.unchanged.length, portal.FILES.length);

// Променен файл се обновява сам.
fs.writeFileSync(path.join(first.dir, 'portal.html'), 'стар файл');
const third = portal.deploy({ env: {}, roots: [root] });
assert.deepEqual(third.copied, ['portal.html'], 'обновява само променения файл');

// 5. Състояние: всичко е налично и актуално.
const st = portal.status({ env: {}, roots: [root] });
assert.equal(st.present, portal.FILES.length);
assert.deepEqual(st.missing, []);
assert.deepEqual(st.outdated, []);

// 6. Цел извън www/hapi/data се отказва, освен с изрично разрешение.
const outside = portal.targetDir({ env: { EVIDENCE_PORTAL_DIR: path.join(root, 'elsewhere') }, roots: [root] });
assert.ok(outside.error && outside.error.includes('www'), 'произволна цел се отказва');
const allowed = portal.targetDir({
  env: { EVIDENCE_PORTAL_DIR: path.join(root, 'custom'), EVIDENCE_PORTAL_ALLOW_ANY_DIR: '1' },
  roots: [root],
});
assert.equal(allowed.dir, path.join(root, 'custom'), 'изрично разрешена цел минава');

// 7. Symlink на целта се отказва (иначе публикуването пише извън www).
const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-link-config-'));
fs.writeFileSync(path.join(linkRoot, 'configuration.yaml'), 'default_config:\n');
fs.mkdirSync(path.join(linkRoot, 'www'), { recursive: true });
const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-link-target-'));
const linkDir = path.join(linkRoot, 'www', 'hapi');
fs.mkdirSync(linkDir, { recursive: true });
try {
  fs.symlinkSync(realDir, path.join(linkDir, 'data'), 'junction');
  const viaLink = portal.deploy({ env: {}, roots: [linkRoot] });
  assert.equal(viaLink.ok, false, 'symlink на целта се отказва');
  assert.match(viaLink.error, /симлинк/);
} catch (e) {
  // Windows без права за symlink: тестът не бива да пада заради средата.
  if (!/EPERM|EACCES/.test(String(e.code))) throw e;
}

for (const dir of [root, emptyRoot, linkRoot, realDir]) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* временни папки */
  }
}

// 8. Живите административни маршрути: статус и публикуване по заявка.
//    В тази среда няма HA конфигурация, затова и двата трябва да отговорят честно
//    (409 + причина), а не да се преструват на успех.
(async () => {
  const { spawn } = require('node:child_process');
  const { freePort, waitHealthy, stopChild } = require('./helpers.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-portal-api-'));
  const port = await freePort();
  const adminPort = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const token = 'evidence-portal-admin-token-0123456789';
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'hapi_enterprise', 'server.js')], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      OPTIONS_PATH: path.join(dir, 'missing.json'),
      PORT: String(port),
      ADMIN_PORT: String(adminPort),
      PUBLIC_GATEWAY_PORT: '0',
      ADMIN_TOKEN: token,
      // Изрична цел извън HA: тестът проверява отказа, а не писане в чужд www.
      EVIDENCE_PORTAL_DIR: path.join(dir, 'not-www'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  child.stderr.on('data', (c) => (err += c.toString()));
  try {
    await waitHealthy(child, base, { attempts: 140, stderr: () => err });
    const auth = { Authorization: 'Bearer ' + token };
    const status = await fetch(base + '/admin/api/evidence-portal/status', { headers: auth });
    assert.equal(status.status, 200, 'статусът отговаря 200');
    const statusBody = await status.json();
    assert.equal(statusBody.ok, false, 'без HA конфигурация статусът е „не“');
    assert.match(statusBody.error, /www\/hapi\/data/, 'причината казва каква цел се очаква');

    const deploy = await fetch(base + '/admin/api/evidence-portal/deploy', { method: 'POST', headers: auth });
    assert.equal(deploy.status, 409, 'публикуване извън www се отказва с 409');
    const deployBody = await deploy.json();
    assert.equal(deployBody.ok, false);
    assert.ok(deployBody.error.includes('www/hapi/data'), 'отказът обяснява изискването');

    const noAuth = await fetch(base + '/admin/api/evidence-portal/status');
    assert.equal(noAuth.status, 401, 'без токен маршрутът е затворен');
  } finally {
    await stopChild(child);
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* временна папка */
    }
  }
  console.log('PASS evidence-portal: пакет · HA config · публикуване в www/hapi/data · идемпотентност, откази и живи маршрути');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
