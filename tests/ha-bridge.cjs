const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const base=path.join(__dirname,'..');const py=fs.readFileSync(path.join(base,'custom_components/hapi_enterprise/__init__.py'),'utf8');const cfg=fs.readFileSync(path.join(base,'hapi_enterprise/config.yaml'),'utf8');const run=fs.readFileSync(path.join(base,'hapi_enterprise/run.sh'),'utf8');assert.match(py,/requires_auth = False/);assert.match(py,/_ALLOWED.fullmatch\(tail\)/);assert.match(py,/X-Portal-Key/);assert.doesNotMatch(py,/backend \+ "\/admin/);assert.match(cfg,/8099\/tcp: null/);assert.match(cfg,/token:\s*""/);assert.match(cfg,/token:\s*password\?/);assert.match(cfg,/db_name:\s*str\?/);assert.match(cfg,/backup_folder:\s*str\?/);assert.match(run,/\/data\/admin-token/);assert.match(run,/REQUIRE_PORTAL_TOKEN=true/);assert.doesNotMatch(run,/Admin token:/);// PG-6: публичният gateway се излага на IP/порта на Home Assistant (без HA сесия).
assert.match(py,/url = "\/api\/public\/v1\/\{tail:\.\*\}"/);
assert.match(py,/api:hapi_enterprise:gateway/);
assert.match(py,/hass\.http\.register_view\(PublicGateway\(\)\)/);
assert.match(py,/_PUBLIC_TAIL = re\.compile/);
assert.match(py,/\^portals\/\(\?P<slug>/);
assert.match(py,/\^files\/\(\?P<file>/);
assert.doesNotMatch(py,/\/api\/public\/v1\/admin/);
assert.match(py,/for field in \("Range", "If-Range"\)/);
assert.match(py,/https\?:\/\//);
const manifest=JSON.parse(fs.readFileSync(path.join(base,'custom_components/hapi_enterprise/manifest.json'),'utf8'));
assert.ok(manifest.dependencies.includes('http'),'интеграцията зависи от http');
console.log('PASS HA bridge contract and auto-provisioned admin token (NOT runtime integration)');