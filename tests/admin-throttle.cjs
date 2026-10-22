'use strict';
const { stopChild, freePort } = require('./helpers.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-throttle-'));
  const port = await freePort(), secret = 'admin-' + require('node:crypto').randomBytes(24).toString('hex');
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env: { ...process.env, DATA_DIR: tmp, PORT: String(port), ADMIN_TOKEN: secret }, stdio: ['ignore', 'pipe', 'pipe'] });
  const request = (route, token) => new Promise((resolve, reject) => { const req = http.get({ hostname: '127.0.0.1', port, path: route, headers: token ? { Authorization: 'Bearer ' + token } : {} }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, retry: res.headers['retry-after'] })) }); req.on('error', reject) });
  try {
    let ready = false; for (let i = 0; i < 60; i++) { if (child.exitCode !== null) throw Error('server exited'); try { if ((await request('/health')).status === 200) { ready = true; break } } catch { } await new Promise(r => setTimeout(r, 40)) } assert.ok(ready, 'server readiness');
    for (let i = 0; i < 12; i++)assert.equal((await request('/admin/api/portals', 'bad-token')).status, 401);
    const blocked = await request('/admin/api/portals', 'bad-token'); assert.equal(blocked.status, 429); assert.ok(Number(blocked.retry) > 0);

    // ── BUG-05: ограничението е по самоличност, не по IP ──────────────────────────
    // Зад Ingress всички заявки идват от ЕДИН peer. Затова заключеният токен не бива
    // да заключва верния, а всеки нов грешен токен получава собствен брояч.
    assert.equal((await request('/admin/api/portals', secret)).status, 200, 'верният токен работи, докато друг е заключен');
    assert.equal((await request('/admin/api/portals', 'second-bad-token')).status, 401, 'другият грешен токен има собствен брояч');
    for (let i = 0; i < 11; i++) await request('/admin/api/portals', 'second-bad-token');
    const secondBlocked = await request('/admin/api/portals', 'second-bad-token');
    assert.equal(secondBlocked.status, 429, 'вторият грешен токен също се заключва след своите 12 опита');
    assert.equal((await request('/admin/api/portals', secret)).status, 200, 'верният токен е все още свободен');
    assert.equal((await request('/health')).status, 200, 'public health must remain available');
    console.log('PASS: 12 rejected admin credentials → 429 Retry-After; лимит по самоличност (верният токен не е засегнат)');
  } finally { await stopChild(child); fs.rmSync(tmp, { recursive: true, force: true }) }
})().catch(e => { console.error(e); process.exitCode = 1 });
