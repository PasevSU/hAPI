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

// ── 2б. Маршрутите на компонентите (`routes/*.js`) ─────────────────────────
// Те не са литерали в `server.js`, а дял: `/admin/api/v2` + `parts[3]`/`parts[4]`.
// Затова таблицата тук е изрична, но всяка двойка носи ДОКАЗАТЕЛСТВО — регулярен израз,
// който трябва да се намери в компонента. Промяна в кода без промяна в договора чупи
// теста (изчезнало условие), а нов `parts[3] === 'x'` без ред в договора — също.
const COMPONENT_ROUTES = [
  // файл, метод, път, котва в кода, условие за метода (в същия или следващ ред)
  ['reports.js', 'POST', '/admin/api/v2/reports/render', /parts\[3\] === 'reports' && parts\[4\] === 'render'/, "method === 'POST'"],
  ['reports.js', 'POST', '/admin/api/v2/reports/package', /parts\[3\] === 'reports' && parts\[4\] === 'package'/, "method === 'POST'"],
  ['reports.js', 'POST', '/admin/api/v2/reports/sign', /parts\[3\] === 'reports' && parts\[4\] === 'sign'/, "method === 'POST'"],
  ['reports.js', 'POST', '/admin/api/v2/cms/verify', /parts\[3\] === 'cms' && parts\[4\] === 'verify'/, "method === 'POST'"],
  ['reports.js', 'GET', '/admin/api/v2/rfc3161', /parts\[3\] === 'rfc3161' && parts\.length === 4/, "method === 'GET'"],
  ['reports.js', 'POST', '/admin/api/v2/rfc3161', /parts\[3\] === 'rfc3161' && parts\.length === 4/, "method !== 'POST'"],
  ['reports.js', 'GET', '/admin/api/v2/rfc3161/verify', /parts\[3\] === 'rfc3161' && parts\.length === 5 && parts\[4\] === 'verify'/, "['GET', 'POST'].includes(method)"],
  ['reports.js', 'POST', '/admin/api/v2/rfc3161/verify', /parts\[3\] === 'rfc3161' && parts\.length === 5 && parts\[4\] === 'verify'/, "['GET', 'POST'].includes(method)"],
  ['generator.js', 'GET', '/admin/api/generator/templates', /parts\[3\] !== 'templates'/, "method === 'GET' && parts.length === 4"],
  ['generator.js', 'POST', '/admin/api/generator/templates', /parts\[3\] !== 'templates'/, "method === 'POST' && parts.length === 4"],
  ['generator.js', 'GET', '/admin/api/generator/templates/{name}', /parts\[3\] !== 'templates'/, "method === 'GET' && parts.length === 5"],
  ['generator.js', 'DELETE', '/admin/api/generator/templates/{name}', /parts\[3\] !== 'templates'/, "method === 'DELETE' && parts.length === 5"],
];

const routesDir = path.join(ROOT, 'hapi_enterprise', 'routes');
const componentSrc = (file) => {
  const full = path.join(routesDir, file);
  assert.ok(require('node:fs').existsSync(full), 'има компонент ' + file);
  return require('node:fs').readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
};

// Доказателството се търси по редове от котвата надолу: така „методът“ може да е на
// същия ред (`... && method === 'POST'`) или в тялото на блока (RFC 3161). Прозорецът е
// ограничен, за да не „намери“ метод от съседен дял.
function evidenceFound(src, anchor, token, window = 40) {
  const lines = src.split('\n');
  const at = lines.findIndex((line) => anchor.test(line) && !/^\s*(\/\/|\*)/.test(line));
  if (at < 0) return false;
  const scope = lines.slice(at, at + window).join('\n');
  return scope.includes(token);
}

for (const [file, method, p, anchor, token] of COMPONENT_ROUTES) {
  assert.ok(evidenceFound(componentSrc(file), anchor, token), 'доказателството за ' + method + ' ' + p + ' липсва в routes/' + file);
  assert.ok(described.has(method + ' ' + p), 'описан е ' + method + ' ' + p + ' (routes/' + file + ')');
}

// Обратната посока за компонентите: всеки `parts[3] === 'x'` в тях трябва да води до
// поне един описан път — иначе нов дял остава извън договора, без никой да забележи.
for (const file of ['reports.js', 'generator.js']) {
  const src = componentSrc(file);
  const segments = new Set([...src.matchAll(/parts\[3\]\s*===\s*'([^']+)'/g)].map((m) => m[1]));
  for (const m of src.matchAll(/parts\[3\]\s*!==\s*'([^']+)'/g)) segments.add(m[1]);
  const owned = COMPONENT_ROUTES.filter((row) => row[0] === file).map((row) => row[2]);
  for (const seg of segments) {
    assert.ok(
      owned.some((p) => p.split('/').includes(seg)),
      'routes/' + file + ': дялът „' + seg + '“ няма описан маршрут в договора'
    );
  }
}

// ── 3. Нищо описано не е измислено ───────────────────────────────────────────
// Пътят може да дойде по два начина в кода: като литерал (`pathname === '/admin/api/x'`)
// или като блок по сегменти (`parts[2] === 'cases'`, после `parts[3] === 'merge'`, а в
// шкафа — `act === 'list'`, защото `act = parts[3]`). Затова всеки статичен сегмент
// трябва да се среща някъде като такова сравнение — иначе пътят е измислен.
const src = surface.source(ROOT);
function segmentIsReal(seg) {
  const quoted = "'" + seg + "'";
  if (!src.includes(quoted)) return false;
  const esc = quoted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `parts[n] === 'x'` (обикновено), `parts[n] !== 'x'` (генераторът пази останалото с 404),
  // `act === 'x'` (шкафът, защото `act = parts[3]`), `pathname === '/admin/api/x'`.
  return (
    new RegExp('parts\\[\\d\\]\\s*[!=]==\\s*' + esc).test(src) ||
    new RegExp('act\\s*===\\s*' + esc).test(src) ||
    src.includes('pathname === ' + quoted)
  );
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
// `operationId` трябва да е уникален — иначе генераторите на клиенти правят един метод за два пътя.
const ids = new Set();
for (const [p, entry] of Object.entries(doc.paths)) {
  for (const [method, op] of Object.entries(entry)) {
    assert.ok(!ids.has(op.operationId), 'уникален operationId: ' + op.operationId + ' (' + method + ' ' + p + ')');
    ids.add(op.operationId);
  }
}
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
