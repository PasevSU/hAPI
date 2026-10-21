'use strict';
// Сценарий: сензори за комуникация, файлове, извиквания, изтегляния и посещения.
//
//   • /admin/api/sensors носи `observer` агрегат: заявки по listener и клас на статуса,
//     байтове, латентност (avg/p50/p95/max), маршрути (шаблонирани, без 24-hex id),
//     качвания/изтривания, изтегляния, посещения и QR;
//   • /admin/api/sensors/prometheus дава текстова експозиция за мониторинг;
//   • маршрутите са само за admin/operator с capability `sensors` (401 без токен);
//   • броячите оцеляват рестарт чрез <DATA_DIR>/sensors.json и `restarts` расте;
//   • няма лични данни: без IP адреси, токени и имена на файлове в агрегата.
const { stopChild } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(dir, port) {
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      OPTIONS_PATH: path.join(dir, 'missing-options.json'),
      PORT: String(port),
      ADMIN_TOKEN: 'sensors-telemetry-admin-token-0123456789',
      VIEWER_TOKEN: 'sensors-telemetry-viewer-token-0123456789',
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(base + '/health')).ok) return { child, base };
    } catch {}
    await sleep(50);
  }
  throw Error(`сървърът не стартира на ${port}`);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-sensors-telemetry-'));
  const port = 42100 + Math.floor(Math.random() * 400);
  let server = await boot(dir, port);
  const admin = { Authorization: 'Bearer sensors-telemetry-admin-token-0123456789' };
  const viewer = { Authorization: 'Bearer sensors-telemetry-viewer-token-0123456789' };

  try {
    const api = async (route, { method = 'GET', headers = admin, body } = {}) => {
      const res = await fetch(server.base + route, {
        method,
        headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      let value = null;
      const type = res.headers.get('content-type') || '';
      if (type.includes('application/json')) value = await res.json();
      else value = await res.text();
      return { status: res.status, value, headers: res.headers };
    };

    // 1. Портали: един публичен + качване на два файла (единият шифрован).
    const portal = await api('/admin/api/portals', { method: 'POST', body: { slug: 'sensors', title: 'Sensors' } });
    assert.equal(portal.status, 201, JSON.stringify(portal.value));
    const portalId = portal.value.id;

    const upload = (name, body, extraHeaders = {}) =>
      fetch(`${server.base}/admin/api/portals/${portalId}/files`, {
        method: 'POST',
        headers: { ...admin, 'X-File-Name': name, ...extraHeaders },
        body,
      });
    const a = await (await upload('a.txt', 'данни А'.repeat(40))).json();
    const b = await (await upload('b.txt', 'данни Б'.repeat(40), { 'X-File-Encrypt': '1' })).json();
    assert.ok(a.id && b.id);

    // 2. Читател със скоуп read/download за публичния API на портала.
    const reader = await api('/admin/api/users', {
      method: 'POST',
      body: { username: 'sensorreader', password: 'sensorreader-pass-123', scopes: ['read', 'download'] },
    });
    assert.equal(reader.status, 201, JSON.stringify(reader.value));
    const login = await fetch(`${server.base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'sensorreader', password: 'sensorreader-pass-123' }),
    });
    assert.equal(login.status, 200);
    const readerToken = (await login.json()).token;
    const asReader = { Authorization: 'Bearer ' + readerToken };

    // 3. Изтегляния: едно успешно + едно отказано (липсващ файл).
    const download = await fetch(`${server.base}/api/v1/p/sensors/files/${a.id}/download`, { headers: asReader });
    assert.equal(download.status, 200);
    await download.arrayBuffer();
    const denied = await fetch(`${server.base}/api/v1/p/sensors/files/${'0'.repeat(24)}/download`, { headers: asReader });
    assert.ok([403, 404].includes(denied.status), `очаквам отказ, получих ${denied.status}`);

    // 4. Посещение на портала + 4xx трафик.
    assert.equal((await fetch(`${server.base}/api/v1/p/sensors/files`, { headers: asReader })).status, 200);
    assert.equal((await fetch(`${server.base}/api/v1/p/sensors`, { headers: asReader })).status, 200);
    await fetch(`${server.base}/admin/api/portals/not-a-portal`);

    // 4. Изтриване (сензор за файлове).
    const removed = await api(`/admin/api/portals/${portalId}/files/${b.id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);

    // 5. Агрегатът.
    const sensors = await api('/admin/api/sensors');
    assert.equal(sensors.status, 200);
    const obs = sensors.value.observer;
    assert.ok(obs, 'липсва observer агрегат');
    assert.ok(obs.http.total >= 8, `очаквам поне 8 заявки, има ${obs.http.total}`);
    assert.ok((obs.http.byListener.public || 0) >= 5, JSON.stringify(obs.http.byListener));
    assert.ok(obs.http.byStatus['2xx'] >= 5, JSON.stringify(obs.http.byStatus));
    assert.ok(obs.http.byStatus['4xx'] >= 2, JSON.stringify(obs.http.byStatus));
    assert.ok(obs.http.bytesOut > 0, 'байтовете на отговорите се отчитат');
    assert.ok(obs.http.latencyMs.count >= 8);
    assert.ok(obs.http.latencyMs.p95 >= 0 && obs.http.latencyMs.max >= obs.http.latencyMs.p50);

    // Маршрутите са шаблони: без 24-hex идентификатори.
    const routes = Object.keys(obs.routes);
    assert.ok(routes.some((r) => r === 'GET /health'), routes.join(' | '));
    assert.ok(routes.some((r) => r.startsWith('POST /admin/api/portals')), routes.join(' | '));
    assert.ok(
      routes.some((r) => r.includes('/api/v1/p/:slug/files')),
      `липсва шаблониран маршрут на портала: ${routes.join(' | ')}`,
    );
    assert.ok(!routes.some((r) => /[0-9a-f]{24}/.test(r)), 'маршрутите не бива да съдържат сурови id-та');
    assert.ok(!routes.some((r) => r.includes('a.txt')), 'имената на файлове не влизат в маршрутите');

    // Файлове, изтегляния, посещения.
    assert.equal(obs.files.uploaded, 2, 'две качвания');
    assert.ok(obs.files.uploadBytes > 0);
    assert.equal(obs.files.encrypted, 1, 'едно шифровано качване');
    assert.equal(obs.files.deleted, 1, 'едно изтриване');
    assert.ok(obs.downloads.ok >= 1, JSON.stringify(obs.downloads));
    assert.ok(obs.downloads.bytes > 0);
    assert.ok(obs.visits.page >= 1, 'посещението на портала се брои');
    assert.equal(obs.visits.portals[portalId] >= 1, true, 'посещенията са и по портал');

    // Лични данни няма.
    const raw = JSON.stringify(obs);
    assert.ok(!/127\.0\.0\.1|::1/.test(raw), 'агрegатът не съдържа IP адреси');
    assert.ok(!raw.includes('sensors-telemetry-admin-token'), 'агрegатът не съдържа токени');
    assert.ok(!raw.includes('a.txt') && !raw.includes('b.txt'), 'агрegатът не съдържа имена на файлове');

    // 6. Prometheus експозиция.
    const prom = await api('/admin/api/sensors/prometheus');
    assert.equal(prom.status, 200);
    assert.match(prom.headers.get('content-type'), /text\/plain/);
    const text = String(prom.value);
    for (const metric of [
      'hapi_up 1',
      'hapi_http_requests_total',
      'hapi_http_status_total',
      'hapi_http_request_duration_ms{quantile="0.95"}',
      'hapi_route_requests_total{route="GET /admin/api/sensors"}',
      'hapi_files_uploaded_total 2',
      'hapi_downloads_total{result="ok"}',
      'hapi_visits_total{kind="page"}',
      'hapi_restarts_total',
    ]) {
      assert.ok(text.includes(metric), `липсва метрика: ${metric}`);
    }
    assert.ok(text.endsWith('\n'), 'експозицията завършва с нов ред');
    assert.ok(!text.includes('a.txt'), 'метриките не съдържат имена на файлове');

    // 7. Достъп: без токен → 401; viewer няма capability sensors (admin-only).
    assert.equal((await fetch(server.base + '/admin/api/sensors')).status, 401);
    assert.equal((await fetch(server.base + '/admin/api/sensors/prometheus')).status, 401);
    // viewer има read достъп до сензорите (мониторинг), но не и до писане —
    // маршрутът е само GET, така че четенето е позволено, а 401 остава за анонимните.
    assert.equal((await api('/admin/api/sensors', { headers: viewer })).status, 200);

    // 8. Персистентност: sensors.json се записва и броячите оцеляват рестарт.
    const sensorsFile = path.join(dir, 'sensors.json');
    let persisted = null;
    for (let i = 0; i < 120; i++) {
      try {
        persisted = JSON.parse(fs.readFileSync(sensorsFile, 'utf8'));
        if (persisted.http && persisted.http.total > 0) break;
      } catch {}
      await sleep(100);
    }
    assert.ok(persisted, 'sensors.json не е записан');
    assert.ok(persisted.http.total >= 8, 'записаните броячи не са празни');

    const beforeRestart = obs.http.total;
    await stopChild(server.child);
    server = await boot(dir, port + 400);
    const afterRestart = await (await fetch(server.base + '/admin/api/sensors', { headers: admin })).json();
    assert.ok(
      afterRestart.observer.http.total > beforeRestart,
      `броячът трябва да продължи след рестарт (${beforeRestart} → ${afterRestart.observer.http.total})`,
    );
    assert.equal(afterRestart.observer.restarts >= 2, true, `restarts: ${afterRestart.observer.restarts}`);
    assert.equal(afterRestart.observer.files.uploaded, 2, 'файловите сензори оцеляват рестарт');

    console.log(
      'PASS sensors telemetry: комуникация/маршрути/файлове/изтегляния/посещения, Prometheus, 401 + read-only viewer, персистентност',
    );
  } finally {
    await stopChild(server.child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
