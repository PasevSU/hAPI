'use strict';
// Договорът за административното API срещу самия код.
//
// Защо: `api-spec.js` описваше публичното портално API, а административното (с което
// работят панелът, интеграцията и скриптовете) нямаше никакъв машинен договор. Тогава
// „има ли маршрут“ се проверяваше само с надежда. Този тест затваря дупката в ДВЕТЕ
// посоки:
//   1. всеки маршрут, записан в кода като `url.pathname === '/admin/api/...'`, трябва да
//      е описан в `admin-api-spec.js` (със същия метод) — нова пътека не може да остане
//      неописана;
//   2. всеки описан литерален път трябва да съществува в кода — не може да се описва
//      маршрут, който не съществува;
//   3. живият сървър сервира документа само на автентикиран клиент.
const assert = require('node:assert/strict');
const path = require('node:path');

const { startServer } = require('./lib/gui-harness.cjs');
const surface = require('./lib/http-surface.cjs');
const spec = require(path.join(__dirname, '..', 'hapi_enterprise', 'admin-api-spec.js'));

const ROOT = path.join(__dirname, '..');

/** Маршрутите от кода: `url.pathname === '/admin/api/x' && method === 'GET'`. */
function routesInCode() {
  const src = surface.source(ROOT).replace(/\r\n/g, '\n');
  const out = [];
  for (const line of src.split('\n')) {
    if (/^\s*(\/\/|\*)/.test(line)) continue; // коментар
    const pathHit = /pathname\s*===\s*'(\/admin\/api[^']*)'/.exec(line);
    if (!pathHit) continue;
    const rest = line.slice(pathHit.index + pathHit[0].length);
    const methodHits = [...rest.matchAll(/(?:method|req\.method)\s*===\s*'([A-Z]+)'/g)].map((m) => m[1]);
    // Може да има две условия на един ред (`if (a) ... ; if (b) ...`) — вземаме само
    // първото, за да не приписваме метода на съседен маршрут.
    if (!methodHits.length) {
      out.push({ path: pathHit[1], method: 'GET', note: 'без изричен метод на реда' });
      continue;
    }
    out.push({ path: pathHit[1], method: methodHits[0] });
  }
  return out;
}

const code = routesInCode();
const described = new Set(spec.operations());
const describedPaths = new Set(spec.ROUTES.map(([, p]) => p));

// ── 1. Таблицата е валидна сама по себе си ────────────────────────────────────
assert.ok(spec.ROUTES.length >= 90, 'договорът описва поне 90 операции (намерени: ' + spec.ROUTES.length + ')');
const seen = new Set();
for (const [method, p, summary, tag, capability] of spec.ROUTES) {
  assert.ok(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method), 'познат метод: ' + method);
  assert.ok(p.startsWith('/admin/api/'), 'пътят е под /admin/api/: ' + p);
  assert.ok(summary && summary.length >= 10, 'резюме за ' + method + ' ' + p);
  assert.ok(tag, 'таг за ' + method + ' ' + p);
  assert.ok(capability, 'капацитет за ' + method + ' ' + p);
  const key = method + ' ' + p;
  assert.ok(!seen.has(key), 'без дубликати: ' + key);
  seen.add(key);
}

// ── 2. Всяка пътека в кода е описана ─────────────────────────────────────────
const missing = code.filter((r) => !described.has(r.method + ' ' + r.path)).map((r) => r.method + ' ' + r.path);
assert.deepEqual(missing, [], 'описани са всички административни маршрути от кода; липсват: ' + missing.join(', '));

// ── 3. Нищо описано не е измислено ───────────────────────────────────────────
// Пътят може да дойде по два начина в кода: като литерал (`pathname === '/admin/api/x'`)
// или като блок по сегменти (`parts[2] === 'cases'`, после `parts[3] === 'merge'`, а в
// шкафа — `act === 'list'`, защото `act = parts[3]`). Затова всеки статичен сегмент
// трябва да се среща някъде като такова сравнение — иначе пътят е измислен.
const src = surface.source(ROOT);
function segmentIsReal(seg) {
  const quoted = "'" + seg + "'";
  if (!src.includes(quoted)) return false;
  return new RegExp("parts\\[\\d\\]\\s*===\\s*" + quoted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(src) ||
    new RegExp("act\\s*===\\s*" + quoted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(src) ||
    src.includes('pathname === ' + quoted);
}
const phantom = [];
for (const p of describedPaths) {
  if (src.includes("'" + p + "'")) continue; // точен литерал
  const segs = p.replace('/admin/api/', '').split('/').filter((s) => s && !s.startsWith('{'));
  const bad = segs.filter((s) => !segmentIsReal(s));
  if (bad.length) phantom.push(p + ' (липсва: ' + bad.join(', ') + ')');
}
assert.deepEqual(phantom, [], 'няма описан маршрут, който липсва в кода: ' + phantom.join(' · '));

// ── 4. Документът е валиден OpenAPI 3.1 ──────────────────────────────────────
const doc = spec.build({ baseUrl: 'https://hapi.example.bg', version: '9.9.9' });
assert.equal(doc.openapi, '3.1.0', 'версия на OpenAPI');
assert.equal(doc.info.version, '9.9.9', 'версията се подава отвън, не се измисля');
assert.equal(doc.servers[0].url, 'https://hapi.example.bg', 'сървърът е адресът на клиента');
assert.ok(doc.components.securitySchemes.adminToken, 'има схема за сигурност');
const opCount = Object.values(doc.paths).reduce((n, entry) => n + Object.keys(entry).length, 0);
assert.equal(opCount, spec.ROUTES.length, 'всеки ред от таблицата става операция');
for (const [p, entry] of Object.entries(doc.paths)) {
  for (const [method, op] of Object.entries(entry)) {
    assert.ok(op.summary, 'резюме: ' + method + ' ' + p);
    assert.ok(op.responses['200'], 'има отговор 200: ' + method + ' ' + p);
    assert.ok(op.responses['401'] && op.responses['403'], 'има 401/403: ' + method + ' ' + p);
    assert.ok(Array.isArray(op.security) && op.security[0].adminToken, 'иска токен: ' + method + ' ' + p);
    const params = (op.parameters || []).map((x) => x.name);
    for (const m of p.matchAll(/\{([A-Za-z0-9_]+)\}/g)) assert.ok(params.includes(m[1]), 'параметърът ' + m[1] + ' е описан в ' + p);
  }
}
// Base URL без наклон в края — иначе `//admin` в клиентите.
assert.equal(spec.build({ baseUrl: 'https://x.bg/' }).servers[0].url, 'https://x.bg', 'маха наклона в края');
// Без baseUrl документът пак е валиден (демо режим, file://).
assert.equal(spec.build().servers[0].url, '/', 'подразбиращ се сървър');

// ── 5. Живият сървър: само с токен ───────────────────────────────────────────
// Токенът е дълъг и случаен, защото сървърът отказва старт с кратък/подразбиращ се.
const token = require('node:crypto').randomBytes(24).toString('hex');

async function live() {
  const server = await startServer({ token });
  try {
    const anon = await fetch(server.base + '/admin/api/openapi.json');
    const anonBody = await anon.text();
    assert.equal(anon.status, 401, 'без токен документът е 401, не публичен: ' + anonBody.slice(0, 120));

    const res = await server.authFetch(server.base + '/admin/api/openapi.json');
    const text = await res.text();
    assert.equal(res.status, 200, 'с токен документът е 200');
    const body = JSON.parse(text);
    assert.equal(body.openapi, '3.1.0', 'сървърът сервира OpenAPI 3.1');
    const served = Object.values(body.paths).reduce((n, entry) => n + Object.keys(entry).length, 0);
    assert.equal(served, spec.ROUTES.length, 'сервираният документ има същите операции');
    assert.ok(body.paths['/admin/api/openapi.json'], 'документът описва и себе си');
    assert.ok(body.info.version && body.info.version !== '0.0.0', 'версията идва от add-on-а: ' + body.info.version);
  } finally {
    await server.stop();
  }
}

live()
  .then(() => {
    process.stdout.write(
      'PASS admin-api-spec: ' + spec.ROUTES.length + ' операции · ' + code.length + ' маршрута от кода са описани · ' +
        'нищо измислено · 401 без токен, 200 с токен\n'
    );
  })
  .catch((e) => {
    process.stderr.write('FAIL admin-api-spec: ' + (e && e.message ? e.message : e) + '\n');
    process.exitCode = 1;
  });
