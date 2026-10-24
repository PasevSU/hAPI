'use strict';
// Decision Sensors (Stage E): измерване → решение.
//
// Проверява се точно това, което обещава модулът, а не „има ключ в JSON-а“:
//   • под прага за извадка НЕ се вдига тревога (процент от 4 заявки е шум);
//   • праг И продължителност: предупреждението чака `sustainMs`, критичното — не;
//   • текущо срещу историческо: стара грешка не се брои за нов инцидент (прозорец);
//   • всеки сигнал носи компонент, измерена стойност, праг и КОНКРЕТНО действие;
//   • живият add-on връща `guidance` в `/admin/api/sensors`.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const { freePort, stopChild } = require('./helpers.cjs');
const { create, THRESHOLDS } = require('../hapi_enterprise/decision-sensors.js');

const facts = (over = {}) => ({
  http: { total: 200, byStatus: { '5xx': 0 }, latencyMs: { p95: 100, count: 200 }, ...(over.http || {}) },
  downloads: { ok: 100, denied: 0, ...(over.downloads || {}) },
  files: { mirrorFailed: 0, ...(over.files || {}) },
  databaseBytes: 10 * 1024 * 1024,
  telemetryBytes: 1024,
  ...over,
});

// ── 1. Без извадка няма заключение ────────────────────────────────────────────
{
  // Часовникът е подаден, за да е детерминистично „продължителността“.
  let clock = 1_000_000;
  const engine = create({ now: () => clock });
  const thin = engine.evaluate(facts({ http: { total: 4, byStatus: { '5xx': 2 }, latencyMs: { p95: 9000, count: 4 } } }));
  assert.equal(thin.status, 'unknown', 'под прага за извадка статусът е „не знам“, не „зле“');
  assert.ok(thin.signals.some((s) => s.id === 'insufficient_samples'), 'липсата на измервания е отделен сигнал');
  assert.equal(thin.recommended, null, 'без извадка няма препоръчано действие');
  assert.equal(thin.checks.http_error_rate, 50, 'процентът се показва, но не вдига тревога');
}

// ── 2. Праг И продължителност ─────────────────────────────────────────────────
{
  let clock = 2_000_000;
  const engine = create({ now: () => clock });
  const first = engine.evaluate(facts({ http: { total: 200, byStatus: { '5xx': 6 }, latencyMs: { p95: 2600, count: 200 } } }));
  const latency = first.signals.find((s) => s.id === 'http_latency');
  assert.ok(latency, 'p95 над 2000 ms е сигнал');
  assert.equal(latency.severity, 'warning');
  assert.equal(latency.active, false, 'първото виждане е `pending`, не тревога');
  assert.equal(first.status, 'ok', 'едно бавно измерване не вдига статуса');

  clock += THRESHOLDS.sustainMs + 1000;
  const second = engine.evaluate(facts({ http: { total: 400, byStatus: { '5xx': 12 }, latencyMs: { p95: 2600, count: 400 } } }));
  const sustained = second.signals.find((s) => s.id === 'http_latency');
  assert.equal(sustained.active, true, 'след sustainMs сигналът е активен');
  assert.equal(second.status, 'warning', 'статусът вдига предупреждение');
  assert.match(second.recommended.action, /бавн|маршрут/i, 'препоръката казва какво да се провери');
  assert.equal(second.recommended.component, 'http');
}

// ── 3. Текущо срещу историческо (прозорец) ────────────────────────────────────
{
  let clock = 3_000_000;
  const engine = create({ now: () => clock });
  engine.evaluate(facts({ http: { total: 200, byStatus: { '5xx': 12 }, latencyMs: { p95: 100, count: 200 } } }));
  clock += 60_000;
  // Натрупано: 12 от 400 (3%) — над прага. В прозореца: 0 нови грешки → проблем няма.
  const later = engine.evaluate(facts({ http: { total: 400, byStatus: { '5xx': 12 }, latencyMs: { p95: 100, count: 400 } } }));
  assert.equal(later.basis, 'window', 'при достатъчно нови заявки се смята прозорецът');
  assert.equal(later.window.requests, 200);
  assert.equal(later.window.errors, 0);
  assert.equal(later.signals.some((s) => s.id === 'http_5xx'), false, 'стара грешка не е нов инцидент');
  assert.equal(later.status, 'ok');
}

// ── 4. Огледалото: критично веднага, и то по НОВИ откази ──────────────────────
{
  let clock = 4_000_000;
  const engine = create({ now: () => clock });
  engine.evaluate(facts({ files: { mirrorFailed: 2 } }));
  clock += 60_000;
  const now = engine.evaluate(facts({ files: { mirrorFailed: 3 }, http: { total: 400, byStatus: { '5xx': 0 }, latencyMs: { p95: 100, count: 400 } } }));
  const mirror = now.signals.find((s) => s.id === 'mirror_failures');
  assert.ok(mirror, 'нов отказ в огледалото е сигнал');
  assert.equal(mirror.severity, 'critical');
  assert.equal(mirror.active, true, 'критичното не чака продължителност');
  assert.equal(now.recommended.id, 'mirror_failures');
  assert.match(mirror.reason, /общо 3 от старта/, 'казва и натрупаното, за да не се загуби следата');

  clock += 60_000;
  const quiet = engine.evaluate(facts({ files: { mirrorFailed: 3 }, http: { total: 600, byStatus: { '5xx': 0 }, latencyMs: { p95: 100, count: 600 } } }));
  assert.equal(quiet.signals.some((s) => s.id === 'mirror_failures'), false, 'без нови откази сигналът утихва');
}

// ── 5. Откази при изтегляне и размери на диска ────────────────────────────────
{
  let clock = 5_000_000;
  const engine = create({ now: () => clock });
  engine.evaluate(facts());
  clock += THRESHOLDS.sustainMs + 1000;
  const bad = engine.evaluate(facts({
    http: { total: 400, byStatus: { '5xx': 0 }, latencyMs: { p95: 100, count: 400 } },
    downloads: { ok: 120, denied: 60 },
    databaseBytes: 2 * 1024 ** 3,
    telemetryBytes: 300 * 1024 ** 2,
  }));
  const ids = bad.signals.map((s) => s.id);
  assert.ok(ids.includes('download_denials'), 'откази над 20% са сигнал');
  assert.ok(ids.includes('database_size'), 'база над 1 GiB е сигнал');
  assert.ok(ids.includes('telemetry_size'), 'телеметрия над 256 MiB е сигнал');
  const db = bad.signals.find((s) => s.id === 'database_size');
  assert.equal(db.measured.unit, 'MiB', 'мерната единица е изрична');
  assert.equal(db.measured.value, 2048);
  const denials = bad.signals.find((s) => s.id === 'download_denials');
  assert.equal(denials.active, true, 'след sustainMs отказите са активни');
  assert.match(denials.action, /права/i);
}

// ── 6. Живият add-on: `guidance` в /admin/api/sensors ────────────────────────
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-sensors-'));
  const port = await freePort(), adminPort = await freePort(), token = 'decision-token-long-enough-1234567';
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PORT: String(adminPort), INGRESS_MODE: 'true', ADMIN_TOKEN: token },
    stdio: 'pipe',
  });
  const admin = `http://127.0.0.1:${adminPort}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { await fetch(admin + '/health'); ready = true; break } catch { await new Promise((r) => setTimeout(r, 40)) }
    }
    assert.ok(ready, 'сървърът стартира');
    const res = await fetch(admin + '/admin/api/sensors', { headers: { authorization: 'Bearer ' + token } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.guidance, 'отговорът носи `guidance`');
    const g = data.guidance;
    assert.ok(['ok', 'unknown', 'warning', 'critical'].includes(g.status), 'статусът е от фиксиран списък: ' + g.status);
    assert.equal(g.basis, 'cumulative', 'първото извикване няма прозорец');
    assert.equal(g.window, null, 'без предишно измерване няма прозорец');
    assert.ok(g.checks && typeof g.checks === 'object', 'компактните стойности за HA сензорите са налични');
    for (const key of ['http_error_rate', 'latency_p95', 'download_denial_rate', 'mirror_problem', 'database_bytes', 'telemetry_bytes']) {
      assert.ok(Object.hasOwn(g.checks, key), 'checks: липсва ' + key);
    }
    assert.ok(Array.isArray(g.signals), 'signals е списък');
    // Старите данни остават — `guidance` се ДОБАВЯ, не заменя.
    assert.ok(data.observer && data.observer.http, 'observer остава в отговора');
    assert.ok(Object.hasOwn(data, 'uniqueVisitors'), 'сензорите за посетители остават');

    // Второ извикване: вече има база за сравнение → прозорецът е наличен.
    const second = await (await fetch(admin + '/admin/api/sensors', { headers: { authorization: 'Bearer ' + token } })).json();
    assert.ok(second.guidance.window, 'второто измерване дава прозорец');
    // Заявката се отчита при `finish`, тоест СЛЕД сглобяването на отговора: в прозореца
    // влизат заявките между двете извиквания (първата), не текущата.
    assert.ok(second.guidance.window.requests >= 1, 'прозорецът брои новите заявки');
    assert.ok(second.guidance.window.seconds >= 0, 'прозорецът носи и дължината си');
    console.log('decision-sensors OK: прагове, продължителност, прозорец и живият `guidance` в /admin/api/sensors');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1) });
