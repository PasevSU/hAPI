const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'); const base = path.join(__dirname, '..'); const py = fs.readFileSync(path.join(base, 'custom_components/hapi_enterprise/__init__.py'), 'utf8'); const cfg = fs.readFileSync(path.join(base, 'hapi_enterprise/config.yaml'), 'utf8'); const run = fs.readFileSync(path.join(base, 'hapi_enterprise/start.js'), 'utf8'); assert.match(py, /requires_auth = False/); assert.match(py, /_ALLOWED.fullmatch\(tail\)/); assert.match(py, /X-Portal-Key/); assert.doesNotMatch(py, /backend \+ "\/admin/); assert.match(cfg, /8099\/tcp: null/);
// 0.69.67: токенът Е опция и е задължителен при старт (обърнат договор спрямо по-старото „няма опция“).
assert.match(cfg, /^\s{2}token:\s*""$/m, 'опцията `token` трябва да съществува и да е празна по подразбиране');
assert.match(cfg, /token:\s*password\?/, 'схемата трябва да приема `token` като password');
assert.match(run, /ADMIN_TOKEN_REQUIRED/, 'стартът трябва да отказва без токен');
assert.match(run, /optionText\('token'\)/, 'токенът се чете от опцията');
assert.match(cfg, /db_name:\s*str\?/); assert.match(cfg, /backup_folder:\s*str\?/); assert.match(run, /\/data\/admin-token/); assert.match(run, /REQUIRE_PORTAL_TOKEN\s*=\s*'true'/); assert.doesNotMatch(run, /Admin token:/);// PG-6: публичният gateway се излага на IP/порта на Home Assistant (без HA сесия).
assert.match(py, /url = "\/api\/public\/v1\/\{tail:\.\*\}"/);
assert.match(py, /api:hapi_enterprise:gateway/);
assert.match(py, /hass\.http\.register_view\(PublicGateway\(\)\)/);
assert.match(py, /_PUBLIC_TAIL = re\.compile/);
assert.match(py, /\^portals\/\(\?P<slug>/);
assert.match(py, /\^files\/\(\?P<file>/);
assert.doesNotMatch(py, /\/api\/public\/v1\/admin/);
assert.match(py, /for field in \("Range", "If-Range"\)/);
assert.match(py, /https\?:\/\//);
const manifest = JSON.parse(fs.readFileSync(path.join(base, 'custom_components/hapi_enterprise/manifest.json'), 'utf8'));
assert.ok(manifest.dependencies.includes('http'), 'интеграцията зависи от http');
// ── P1: публичният канал се сервира от Home Assistant, на неговия порт ──────────
assert.match(py, /url = "\/api\/hapi_enterprise\/public\/v1\/\{tail:\.\*\}"/, 'каноничният публичен адрес е под домейна на интеграцията');
assert.match(py, /class LegacyPublicGateway\(PublicGateway\)/, 'старият адрес остава като alias');
assert.match(py, /url = "\/api\/public\/v1\/\{tail:\.\*\}"/, 'legacy адресът е регистриран');
assert.match(py, /"Deprecation": "true"/, 'legacy отговорът е маркиран като deprecated');
assert.match(py, /successor-version/, 'legacy отговорът сочи наследника');
assert.match(py, /hass\.async_add_executor_job\(_read_static_files\)/, 'статичните файлове се четат извън event loop');
const viewStart = py.indexOf('class PortalPage');
const viewEnd = py.indexOf('def _entry_settings');
const views = py.slice(viewStart, viewEnd > viewStart ? viewEnd : py.length);
assert.doesNotMatch(views, /read_text\(/, 'view handler-ите не четат файлове синхронно');
// Allowlist-ът се ВЗИМА от кода и се проверява с РЕАЛНИ пътища, а не с регулярен израз върху
// текста. До 0.69.102 тук стоеше `/\|storage\)\)\?\$/` — той се счупи, щом списъкът се
// разшири с договора за папка, макар в моста нищо да не беше сгрешено. Тестът, който пази
// граница, трябва да проверява границата (пуска ли този път), не нейния правопис.
const patternOf = (name) => {
  const at = py.indexOf(name + ' = re.compile(');
  assert.ok(at >= 0, name + ' не се намира в __init__.py');
  const open = py.indexOf('(', at);
  const close = py.indexOf('\n)', open);
  assert.ok(close > open, name + ': не се намира краят на re.compile(');
  const parts = [...py.slice(open + 1, close).matchAll(/r"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  assert.ok(parts.length >= 1, name + ': няма шаблон в re.compile(');
  return new RegExp(parts.join('').replace(/\(\?P</g, '(?<'));
};
const ALLOWED = patternOf('_ALLOWED');
// Всичко, което `api.json` и картата на папката обявяват като адрес, трябва да минава.
for (const tail of ['p/demo', 'p/demo/storage', 'p/demo/api.json', 'p/demo/openapi.json', 'p/demo/manifest', 'p/demo/qr.svg', 'p/demo/qr.json', 'p/demo/ping', 'p/demo/tree', 'p/demo/tree/file', 'p/demo/tree/api.json']) {
  assert.match(tail, ALLOWED, 'мостът разрешава обявения адрес ' + tail);
}
for (const tail of ['admin/api/portals', 'admin', 'p/Demo', 'p/demo/unknown']) {
  assert.doesNotMatch(tail, ALLOWED, 'мостът НЕ разрешава ' + tail);
}
assert.match(py, /allowed = \{[^}]*"path"/, 'path се препредава за virtual storage');

console.log('PASS HA bridge contract: токенът е задължителна опция, портът 8099 е само за интеграцията');
