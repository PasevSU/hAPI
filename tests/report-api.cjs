'use strict';
// Фаза 11 / RS-03: POST /admin/api/v2/reports/render (манифест → PDF).
const { stopChild } = require('./helpers.cjs');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { spawn } = require('node:child_process');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-api-'));
  const token = 'report-api-admin-secret-2026-r3';
  const port = 18471;
  const B = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: { ...process.env, DATA_DIR: dir, ADMIN_TOKEN: token, PORT: String(port) },
    stdio: 'pipe',
  });
  try {
    let ready = false;
    for (let i = 0; i < 70; i++) {
      try {
        if ((await fetch(B + '/health')).ok) {
          ready = true;
          break;
        }
      } catch { }
      await new Promise((r) => setTimeout(r, 70));
    }
    assert(ready);

    const manifest = require('../hapi_enterprise/ui/manifest.example.json');
    const M = require('../hapi_enterprise/report-manifest.js');
    const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    const post = (url, body, headers = H) =>
      fetch(B + url, { method: 'POST', headers, body: JSON.stringify(body) });

    // 1. Без токен → 401.
    let r = await post('/admin/api/v2/reports/render', { manifest }, { 'content-type': 'application/json' });
    assert.equal(r.status, 401);

    // 2. Валиден манифест → PDF с хеш на манифеста.
    r = await post('/admin/api/v2/reports/render', { manifest, hashes: { SHA256: 'b'.repeat(64) } });
    assert.equal(r.status, 201);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.equal(r.headers.get('x-manifest-sha256'), M.digest(manifest));
    const pdf = Buffer.from(await r.arrayBuffer());
    assert.equal(pdf.subarray(0, 8).toString('latin1'), '%PDF-1.5');
    assert.ok(pdf.length > 4000, 'pdf has content');
    // RS-06: отпечатъкът на готовия PDF се връща и съвпада с изпратените байтове.
    assert.equal(
      r.headers.get('x-pdf-sha256'),
      require('node:crypto').createHash('sha256').update(pdf).digest('hex'),
      'X-PDF-SHA256 трябва да е sha256 на самия файл',
    );

    // 3. Невалиден манифест → 400 с код.
    r = await post('/admin/api/v2/reports/render', { manifest: { ...manifest, blocks: [] } });
    assert.equal(r.status, 400);
    let body = await r.json();
    assert.match(body.error, /INVALID_BLOCKS/);

    // 4. Фалшив TSA токен в манифеста → 400 FORBIDDEN_FIELD (никакъв сертификат в PDF).
    const fake = JSON.parse(JSON.stringify(manifest));
    fake.blocks[1].tsaToken = 'MIIB-fake';
    r = await post('/admin/api/v2/reports/render', { manifest: fake });
    assert.equal(r.status, 400);
    body = await r.json();
    assert.match(body.error, /FORBIDDEN_FIELD/);

    // 5. Метод GET не е разрешен за този маршрут.
    r = await fetch(B + '/admin/api/v2/reports/render', { headers: H });
    assert.equal(r.status, 404);

    // 5б. RS-05: TSA обхват без включен TSA → 409, а не мълчаливо „подпечатан“ отчет.
    // (Сървърът тук работи с tsa_enabled=false по подразбиране.)
    r = await post('/admin/api/v2/reports/render', { manifest, tsa: true });
    assert.equal(r.status, 409);
    body = await r.json();
    assert.match(body.error, /tsa_enabled/);

    // 6. GUI-ят се сервира от backend-а (същия origin → без CORS) със строг CSP.
    r = await fetch(B + '/ui/');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
    const csp = r.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.match(await r.text(), /Enterprise Control Center/);

    r = await fetch(B + '/ui/app.js');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/javascript; charset=utf-8');

    // 6б. Всеки скрипт, който index.html зарежда, се сервира от backend-а.
    const indexHtml = await (await fetch(B + '/ui/')).text();
    const sources = [...indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map((x) => x[1]);
    assert.ok(sources.length >= 10, 'index.html трябва да зарежда всички модули');
    for (const src of sources) {
      const url = new URL(src, B + '/ui/').pathname;
      const res = await fetch(B + url);
      assert.equal(res.status, 200, `липсва ${url}`);
      assert.match(res.headers.get('content-type') || '', /javascript/, `грешен тип за ${url}`);
    }

    r = await fetch(B + '/hapi_enterprise/report-manifest.js');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /HapiReportManifest/);

    // 7. Пътища извън allowlist не се сервират.
    r = await fetch(B + '/ui/../package.json');
    assert.equal(r.status, 404);
    r = await fetch(B + '/ui/../../etc/passwd');
    assert.equal(r.status, 404);

    console.log('report-api OK');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
