'use strict';
// `download_rules.json` е единственият файл с правила, който се ВАЛИДИРА твърдо: сгрешена
// стойност не се поправя, а ЦЕЛИЯТ файл се изхвърля и се ползват вградените правила. До
// 0.69.87 това ставаше мълчаливо — `/admin/api/rules` продължаваше да сочи файла като зареден,
// `/ready` казваше „готово“, а в сила бяха други правила. Оператор, който е сгрешил стойност,
// виждаше зелено.
//
// Тук се проверява точно тази верига:
//   1. валиден файл → `files['download_rules.json']` е пътят, `invalid` е празен;
//   2. невалиден файл → `files[...] === 'invalid'`, `invalid` го изброява, `errors` казва защо,
//      а `/export/rules` връща ВГРАДЕНИТЕ правила (не сгрешената стойност);
//   3. `/ready` става 503, вместо да твърди, че правилата са налице;
//   4. след поправка и `POST /admin/api/rules/reload` всичко се връща на място.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freePort, stopChild } = require('./helpers.cjs');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-invalid-'));
  const configDir = path.join(dir, 'config');
  const rulesDir = path.join(configDir, 'rules');
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(rulesDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  // Валидното копие идва от репото — тестът не бива да измисля „правилни“ правила.
  const source = path.join(__dirname, '..', 'config', 'rules', 'download_rules.json');
  const shipped = fs.readFileSync(source, 'utf8');
  const target = path.join(rulesDir, 'download_rules.json');
  fs.writeFileSync(target, shipped);
  const port = await freePort(), adminPort = await freePort(), admin = 'rules-invalid-token-1234567890abcdef';
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env, DATA_DIR: dataDir, PORT: String(port), ADMIN_PORT: String(adminPort),
      ADMIN_TOKEN: admin, HAPI_CONFIG_DIR: configDir, INGRESS_MODE: 'true',
    },
    stdio: 'pipe',
  });
  let logs = '';
  child.stdout.on('data', (d) => { logs += String(d) });
  child.stderr.on('data', (d) => { logs += String(d) });
  const adminBase = `http://127.0.0.1:${adminPort}`;
  const H = { authorization: 'Bearer ' + admin, 'content-type': 'application/json' };
  const req = async (p, method = 'GET', body) => {
    const res = await fetch(adminBase + p, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { status: res.status, data };
  };
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try { await fetch(adminBase + '/health'); ready = true; break } catch { await new Promise((r) => setTimeout(r, 40)) }
    }
    assert.ok(ready, 'add-on-ът стартира' + (logs ? ': ' + logs.slice(-400) : ''));

    // ── 1. Валиден файл ───────────────────────────────────────────────────────
    const good = await req('/admin/api/rules');
    assert.equal(good.status, 200, '/admin/api/rules отговаря');
    assert.equal(good.data.invalid.length, 0, 'валиден файл не се води невалиден');
    assert.ok(String(good.data.files['download_rules.json']).endsWith('download_rules.json'), 'източникът е файлът');
    assert.equal(good.data.errors.length, 0, 'няма грешки при валиден файл');

    // ── 2. Невалиден файл: отхвърля се, но се ВИЖДА ──────────────────────────
    const broken = JSON.parse(shipped);
    broken.evidence.overwrite = 'allowed'; // валидаторът изисква точно 'forbidden'
    fs.writeFileSync(target, JSON.stringify(broken, null, 2));
    const reloaded = await req('/admin/api/rules/reload', 'POST');
    assert.equal(reloaded.status, 200, 'reload минава');
    assert.equal(reloaded.data.files['download_rules.json'], 'invalid', 'източникът е „invalid“: ' + JSON.stringify(reloaded.data.files));
    assert.deepEqual(reloaded.data.invalid, ['download_rules.json'], 'невалидният файл е изброен');
    assert.ok(reloaded.data.errors.some((e) => e.includes('evidence.overwrite')), 'грешката се казва: ' + JSON.stringify(reloaded.data.errors));

    const effective = await req('/admin/api/v2/export/rules');
    assert.equal(effective.status, 200, '/export/rules отговаря');
    assert.equal(effective.data.download_rules.evidence.overwrite, 'forbidden', 'в сила са ВГРАДЕНИТЕ правила, не сгрешената стойност');

    // ── 3. Readiness не твърди „готово“ при невалидни правила ────────────────
    // `/ready` е на публичния слушател (probe-овете на Supervisor го търсят там), не на админския.
    const readiness = await fetch(`http://127.0.0.1:${port}/ready`);
    const readyBody = await readiness.json();
    assert.equal(readyBody.checks.rules, false, 'checks.rules е false при невалиден файл (получено: ' + JSON.stringify(readyBody.checks) + ')');
    assert.ok(logs.includes('rules.invalid'), 'причината влиза в лога, а не само в отговора');

    // ── 4. Поправка ──────────────────────────────────────────────────────────
    fs.writeFileSync(target, shipped);
    const fixed = await req('/admin/api/rules/reload', 'POST');
    assert.equal(fixed.data.files['download_rules.json'], target, 'след поправката източникът отново е файлът');
    assert.deepEqual(fixed.data.invalid, [], 'списъкът с невалидни е празен');
    const afterFix = await fetch(`http://127.0.0.1:${port}/ready`);
    const afterBody = await afterFix.json();
    assert.equal(afterBody.checks.rules, true, 'readiness е доволен след поправката');

    console.log('PASS rules-invalid: валиден файл се вижда · невалиден се отхвърля и СЕ ВИЖДА (`invalid` + причина + лог) · в сила са вградените правила · /ready става 503 · след поправка всичко се връща');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1) });
