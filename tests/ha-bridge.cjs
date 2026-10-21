const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'); const base = path.join(__dirname, '..'); const py = fs.readFileSync(path.join(base, 'custom_components/hapi_enterprise/__init__.py'), 'utf8'); const cfg = fs.readFileSync(path.join(base, 'hapi_enterprise/config.yaml'), 'utf8'); const run = fs.readFileSync(path.join(base, 'hapi_enterprise/start.js'), 'utf8'); assert.match(py, /requires_auth = False/); assert.match(py, /_ALLOWED.fullmatch\(tail\)/); assert.match(py, /X-Portal-Key/); assert.doesNotMatch(py, /backend \+ "\/admin/); assert.match(cfg, /8099\/tcp: null/); assert.match(cfg, /token:\s*""/); assert.match(cfg, /token:\s*password\?/); assert.match(cfg, /db_name:\s*str\?/); assert.match(cfg, /backup_folder:\s*str\?/); assert.match(run, /\/data\/admin-token/); assert.match(run, /REQUIRE_PORTAL_TOKEN\s*=\s*'true'/); assert.doesNotMatch(run, /Admin token:/);// PG-6: публичният gateway се излага на IP/порта на Home Assistant (без HA сесия).
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
assert.match(py, /\|storage\)\)\?\$/, 'storage е разрешен в bridge whitelist-а');
assert.match(py, /allowed = \{[^}]*"path"/, 'path се препредава за virtual storage');

console.log('PASS HA bridge contract and auto-provisioned admin token (NOT runtime integration)');
