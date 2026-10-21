'use strict';
// Debug лог през API: четене от ring buffer-а, смяна на нивото в runtime,
// correlation header и ролеви ограничения (viewer чете, но не променя).
const { stopChild } = require('./helpers.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-logs-'));
  const port = 29000 + Math.floor(Math.random() * 1500);
  const adminPort = port + 1;
  const token = 'logs-test-admin-token-1234567890';
  const viewer = 'logs-test-viewer-token-0987654321';
  const base = `http://127.0.0.1:${port}`;
  const admin = `http://127.0.0.1:${adminPort}`;
  let child;

  const call = async (url, { method = 'GET', body, headers = {}, bearer } = {}) => {
    const res = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let value = null;
    try {
      value = await res.json();
    } catch {
      value = null;
    }
    return { status: res.status, value, headers: res.headers };
  };

  try {
    child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
      env: {
        ...process.env,
        DATA_DIR: dir,
        OPTIONS_PATH: path.join(dir, 'missing-options.json'),
        PORT: String(port),
        ADMIN_TOKEN: token,
        VIEWER_TOKEN: viewer,
        INGRESS_MODE: 'true',
        ADMIN_PORT: String(adminPort),
        ADMIN_BIND_HOST: '127.0.0.1',
      },
      stdio: 'ignore',
    });
    for (let i = 0; i < 120; i++) {
      try {
        if ((await call(base + '/health')).status === 200) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }

    // 1. Без токен на ingress listener-а → admin по подразбиране.
    assert.equal((await call(admin + '/admin/api/logs')).status, 200);

    // 2. Admin чете: ниво info, файл в <DATA_DIR>/logs.
    const first = await call(admin + '/admin/api/logs', { bearer: token });
    assert.equal(first.status, 200);
    assert.equal(first.value.level, 'info');
    assert.ok(Array.isArray(first.value.entries));
    assert.ok(first.value.stats.dir && first.value.stats.dir.endsWith('logs'), 'лог директорията се отчита');
    assert.equal(first.value.order, 'newest-first');

    // 3. Viewer има read достъп, но не може да сменя нивото.
    assert.equal((await call(admin + '/admin/api/logs', { bearer: viewer })).status, 200);
    assert.equal(
      (await call(admin + '/admin/api/logs/level', { method: 'POST', body: { level: 'debug' }, bearer: viewer })).status,
      403,
    );

    // 4. Admin вдига нивото до debug.
    const raised = await call(admin + '/admin/api/logs/level', { method: 'POST', body: { level: 'debug' }, bearer: token });
    assert.equal(raised.status, 200);
    assert.equal(raised.value.level, 'debug');

    // 5. Невалидно ниво → 400.
    assert.equal(
      (await call(admin + '/admin/api/logs/level', { method: 'POST', body: { level: 'verbose' }, bearer: token })).status,
      400,
    );

    // 6. Заявка с валиден X-Request-Id се отразява във втория хедър и в лога.
    const traced = await call(base + '/health', { headers: { 'X-Request-Id': 'debug-test-1' } });
    assert.equal(traced.headers.get('x-request-id'), 'debug-test-1');
    const invalid = await call(base + '/health', { headers: { 'X-Request-Id': 'bad value with spaces' } });
    assert.notEqual(invalid.headers.get('x-request-id'), 'bad value with spaces', 'невалиден идентификатор не се връща обратно');
    assert.match(invalid.headers.get('x-request-id') || '', /^[A-Za-z0-9._-]{1,64}$/);

    const logs = await call(admin + '/admin/api/logs?level=debug&limit=50', { bearer: token });
    assert.equal(logs.status, 200);
    const request = logs.value.entries.find((e) => e.msg === 'request' && e.ctx && e.ctx.reqId === 'debug-test-1');
    assert.ok(request, 'debug заявката е записана с нейния reqId');
    assert.equal(request.ns, 'http');
    assert.equal(request.ctx.status, 200);
    assert.equal(typeof request.ctx.ms, 'number');

    // 7. Тайни не попадат в лога.
    await call(admin + '/admin/api/logs', { bearer: token, headers: { 'X-Portal-Key': 'pk_should_not_leak' } });
    const all = await call(admin + '/admin/api/logs?limit=200', { bearer: token });
    assert.doesNotMatch(JSON.stringify(all.value.entries), /pk_should_not_leak/);

    // 8. Логовете съществуват и като JSONL файл.
    assert.ok(all.value.files.length >= 1, 'има поне един файл');
    const file = path.join(dir, 'logs', all.value.files[all.value.files.length - 1]);
    assert.ok(fs.existsSync(file), 'лог файлът е на диска');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n')[0]).msg.length > 0, true);

    console.log('PASS debug logs API: admin по подразбиране + 403 при изрична роля, ring buffer, runtime level, X-Request-Id, без теч на тайни, JSONL на диска');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
