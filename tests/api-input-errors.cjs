'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ОРАКУЛ: невалиден вход е грешка на КЛИЕНТА (4xx), не 500.
//
// Дефектът, който този тест щеше да хване сам (0.69.43): `POST /admin/api/qr-artifacts`
// с `{}` хвърляше `Error('Invalid QR ID')` без статус, хващаше се в общия обработчик и
// клиентът получаваше `{"error":"Internal error"}` 500 — без причина и със запис
// „unhandled“ в лога. Същият модел (валидация, която хвърля без `status`) може да се
// появи навсякъде, затова тук има таблица от реални маршрути и невалидни тела.
//
// Проверява се САМО инвариантът: никакъв 5xx за грешен вход. Точният код (400/404/409/415)
// не се фиксира — важното е сървърът да не твърди, че е счупен, когато клиентът е сгрешил.
// 503 е умишлен отказ („функцията е изключена“), не срив — той е позволен.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { stopChild } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const TOKEN = 'input-errors-token-6b2e94d1f7a05c38';
const PORT = 18440;

const CASES = [
  // [метод, път, тяло]
  ['POST', '/admin/api/qr-artifacts', {}],
  ['POST', '/admin/api/qr-artifacts', { qrId: '../evil' }],
  ['POST', '/admin/api/qr-artifacts', { qrId: '' }],
  ['POST', '/admin/api/qr-artifacts', { qrId: 'x'.repeat(200) }],
  ['PATCH', '/admin/api/settings', { maxUploadMb: -5 }],
  ['PATCH', '/admin/api/settings', { databaseDirectory: '../../etc' }],
  ['PATCH', '/admin/api/settings', { sensors: { ipMode: 'weird' } }],
  ['PATCH', '/admin/api/settings', { limits: { maxJobs: 999 } }],
  ['PATCH', '/admin/api/settings', { backupSchedule: { enabled: true, intervalMinutes: 0 } }],
  ['PATCH', '/admin/api/settings', { artifactDirectory: '' }],
  ['POST', '/admin/api/portals', { slug: '..' }],
  ['POST', '/admin/api/portals', { slug: 'x'.repeat(200), title: 't' }],
  ['POST', '/admin/api/cases', { number: '' }],
  ['POST', '/admin/api/variables', { name: '', value: '' }],
  ['POST', '/admin/api/v2/reports/render', { manifest: null }],
  ['POST', '/admin/api/v2/reports/render', { manifest: { elements: 'nope' } }],
  ['POST', '/admin/api/pgp/keys', { key: 'not-a-key' }],
  ['POST', '/admin/api/generator/templates', { name: '../../evil.html', content: '<b>x</b>' }],
  ['POST', '/admin/api/notify/dispatch', { service: '*'.repeat(200) }],
  ['POST', '/admin/api/v1/portals/probe-id/files', { name: 'x' }],
  ['POST', '/admin/api/v1/portals/probe-id/files', { name: 'x'.repeat(300) }],
  ['PATCH', '/admin/api/runtime', { nope: true }],
  ['POST', '/admin/api/config-profiles', { name: '', profile: null }],
];

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-input-errors-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'hapi_enterprise', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(PORT), ADMIN_TOKEN: TOKEN, PUBLIC_GATEWAY_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = [];
  child.stdout.on('data', (d) => out.push(String(d)));
  child.stderr.on('data', (d) => out.push(String(d)));
  const base = `http://127.0.0.1:${PORT}`;
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(base + '/health')).ok) { ready = true; break } } catch { /* стартира */ }
      await new Promise((r) => setTimeout(r, 80));
    }
    assert(ready, 'сървърът не стартира');

    const failures = [];
    for (const [method, route, body] of CASES) {
      let status = 0;
      let text = '';
      try {
        const res = await fetch(base + route, {
          method,
          headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(6000),
        });
        status = res.status;
        text = (await res.text()).slice(0, 120).replace(/\s+/g, ' ');
      } catch (e) {
        failures.push(`${method} ${route} → изключение: ${e.message}`);
        continue;
      }
      if (status >= 500 && status !== 503) failures.push(`${status} ${method} ${route} ${JSON.stringify(body).slice(0, 50)} → ${text}`);
    }
    assert.deepEqual(failures, [], 'невалиден вход върна 5xx (трябва да е 4xx с причина):\n  ' + failures.join('\n  '));

    const log = out.join('');
    assert.equal((log.match(/unhandled/g) || []).length, 0, 'нито един невалиден вход не се записва като „unhandled“');

    console.log('PASS api-input-errors: ' + CASES.length + ' невалидни входа → нито един 5xx, нито един „unhandled“');
  } finally {
    await stopChild(child).catch(() => { });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows може да държи файла */ }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
