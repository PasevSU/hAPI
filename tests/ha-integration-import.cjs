'use strict';
// Интеграцията е Python, а досега `ha-integration-python.cjs` само я КОМПИЛИРАШЕ. Компилацията
// не хваща нито един от грешките, които спират зареждането в истински Home Assistant:
// сгрешено име при `import` (ImportError), липсващ символ в тялото (NameError при първо
// извикване), счупен `CONFIG_SCHEMA` или изглед, който изобщо не се регистрира.
//
// Тук интеграцията се ЗАРЕЖДА срещу минимални заготовки на `homeassistant`/`aiohttp`/
// `voluptuous` (истинските пакети не са зависимост на репото) и се вика `async_setup` с
// фалшив `hass`, който записва регистрираните изгледи. Така се проверява, че:
//   1. модулът се внася без грешка;
//   2. `CONFIG_SCHEMA` съществува и приема `hapi_enterprise: {backend_url: …}`;
//   3. без `backend_url` се регистрират само статичните изгледи (fail-closed);
//   4. с `backend_url` се регистрират всички публични пътища и `/hapi/…`, всичките без сесия.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

const findPython = () => {
  for (const cmd of ['python', 'py', 'python3']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return cmd;
  }
  return '';
};

const python = findPython();
if (!python) {
  console.log('ha-integration-import: няма python — зареждането не се проверява');
  process.exit(0);
}

const STUBS = {
  'homeassistant/__init__.py': '',
  'homeassistant/core.py': 'class HomeAssistant:\n    pass\n',
  'homeassistant/config_entries.py': 'class ConfigEntry:\n    pass\n',
  'homeassistant/const.py': 'CONF_NAME = "name"\nCONF_TOKEN = "token"\n',
  'homeassistant/components/__init__.py': '',
  'homeassistant/components/http.py': [
    'class HomeAssistantView:',
    '    url = None',
    '    name = None',
    '    requires_auth = True',
    '',
  ].join('\n'),
  'homeassistant/helpers/__init__.py': '',
  'homeassistant/helpers/config_validation.py': 'string = str\n',
  'homeassistant/helpers/aiohttp_client.py': [
    'class _Session:',
    '    pass',
    '',
    'def async_get_clientsession(hass, *args, **kwargs):',
    '    return _Session()',
    '',
  ].join('\n'),
  'homeassistant/helpers/update_coordinator.py': [
    'class UpdateFailed(Exception):',
    '    pass',
    '',
    'class CoordinatorEntity:',
    '    def __init__(self, coordinator=None):',
    '        self.coordinator = coordinator',
    '',
    'class DataUpdateCoordinator:',
    '    def __init__(self, hass=None, logger=None, name=None, update_interval=None):',
    '        self.hass, self.name, self.update_interval = hass, name, update_interval',
    '        self.data = None',
    '',
    '    async def async_config_entry_first_refresh(self):',
    '        return None',
    '',
    '    async def async_request_refresh(self):',
    '        return None',
    '',
    '    def async_add_listener(self, *args, **kwargs):',
    '        return lambda: None',
    '',
  ].join('\n'),
  'homeassistant/util/__init__.py': '',
  'homeassistant/util/dt.py': 'def utcnow():\n    import datetime\n    return datetime.datetime.now(datetime.timezone.utc)\n',
  'voluptuous/__init__.py': [
    'ALLOW_EXTRA = "allow"',
    '',
    'class Invalid(Exception):',
    '    pass',
    '',
    'class _Key:',
    '    def __init__(self, key, default=None):',
    '        self.key, self.default = key, default',
    '',
    'class _Schema:',
    '    def __init__(self, schema, extra=None, required=False):',
    '        self.schema, self.extra, self.required = schema, extra, required',
    '',
    '    def __call__(self, value):',
    '        return value',
    '',
    'def Schema(schema, extra=None, required=False):',
    '    return _Schema(schema, extra, required)',
    '',
    'def Optional(key, default=None):',
    '    return _Key(key, default)',
    '',
    'def Required(key, default=None):',
    '    return _Key(key, default)',
    '',
    'def In(options):',
    '    return options',
    '',
    'def All(*validators):',
    '    return validators',
    '',
    'def Any(*validators):',
    '    return validators',
    '',
    'def Coerce(kind):',
    '    return kind',
    '',
    'def Range(*args, **kwargs):',
    '    return args',
    '',
  ].join('\n'),
  'aiohttp/__init__.py': 'from . import web  # noqa: F401\n\n\nclass ClientError(Exception):\n    pass\n',
  'aiohttp/web.py': [
    'class Headers(dict):',
    '    def getall(self, key, default=None):',
    '        return []',
    '',
    'class Response:',
    '    def __init__(self, *args, **kwargs):',
    '        self.body = kwargs.get("text")',
    '        self.status = kwargs.get("status", 200)',
    '        self.headers = Headers(kwargs.get("headers") or {})',
    '',
    'class StreamResponse:',
    '    def __init__(self, *args, **kwargs):',
    '        self.status = kwargs.get("status", 200)',
    '        self.headers = Headers(kwargs.get("headers") or {})',
    '',
    '    async def prepare(self, request):',
    '        return None',
    '',
    '    async def write(self, chunk):',
    '        return None',
    '',
    '    async def write_eof(self):',
    '        return None',
    '',
    'class HTTPException(Exception):',
    '    pass',
    '',
    'class HTTPNotFound(HTTPException):',
    '    pass',
    '',
    'class HTTPBadRequest(HTTPException):',
    '    pass',
    '',
    'class HTTPUnauthorized(HTTPException):',
    '    pass',
    '',
    'class HTTPBadGateway(HTTPException):',
    '    pass',
    '',
    'class HTTPRequestEntityTooLarge(HTTPException):',
    '    def __init__(self, *args, **kwargs):',
    '        self.max_size = kwargs.get("max_size")',
    '        self.actual_size = kwargs.get("actual_size")',
    '',
  ].join('\n'),
};

const LOADER = [
  'import asyncio',
  'import json',
  'import sys',
  'import types',
  '',
  'import custom_components.hapi_enterprise as integ',
  '',
  'class FakeHttp:',
  '    def __init__(self):',
  '        self.views = []',
  '',
  '    def register_view(self, view):',
  '        self.views.append(view)',
  '',
  'class FakeConfig:',
  '    def path(self, *parts):',
  '        return "/tmp"',
  '',
  'class FakeHass:',
  '    def __init__(self):',
  '        self.data = {}',
  '        self.http = FakeHttp()',
  '        self.config = FakeConfig()',
  '',
  '    async def async_add_executor_job(self, func, *args):',
  '        return func(*args)',
  '',
  'async def run(config):',
  '    hass = FakeHass()',
  '    result = await integ.async_setup(hass, config)',
  '    return {',
  '        "result": bool(result),',
  '        "schema": integ.CONFIG_SCHEMA is not None,',
  '        "views": [{"url": getattr(v, "url", None), "auth": getattr(v, "requires_auth", None)} for v in hass.http.views],',
  '    }',
  '',
  'async def main():',
  '    empty = await run({})',
  '    wired = await run({"hapi_enterprise": {"backend_url": "http://hapi_enterprise:8099"}})',
  '    print(json.dumps({"empty": empty, "wired": wired}))',
  '',
  'asyncio.run(main())',
].join('\n');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-import-'));
try {
  for (const [name, body] of Object.entries(STUBS)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  const loader = path.join(dir, 'load_integration.py');
  fs.writeFileSync(loader, LOADER);
  const run = spawnSync(python, [loader], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: [dir, root].join(path.delimiter), PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(run.status, 0, 'интеграцията се зарежда:\n' + (run.stderr || run.stdout || ''));
  const out = JSON.parse(String(run.stdout).trim().split(/\r?\n/).pop());
  const urls = (list) => list.map((v) => v.url);

  // 1. Без `backend_url` — само статичните изгледи (fail-closed), и то без отворена сесия.
  assert.equal(out.empty.result, true, 'без backend_url async_setup връща True (не блокира HA)');
  assert.equal(out.empty.schema, true, 'CONFIG_SCHEMA съществува');
  assert.deepEqual(urls(out.empty.views).sort(), ['/api/hapi_enterprise/assets/{asset}', '/api/hapi_enterprise/portal/{slug}'], 'без backend_url се регистрират само статичните изгледи');
  for (const v of out.empty.views) assert.equal(v.auth, false, 'статичните изгледи не искат сесия: ' + v.url);

  // 2. С `backend_url` — цялата публична повърхност, включително `/hapi/…`.
  const wired = urls(out.wired.views);
  for (const must of [
    '/hapi/{tail:.*}',
    '/api/v1/p/{tail:.*}',
    '/p/{tail:.*}',
    '/s/{tail:.*}',
    '/qr/{tail:.*}',
    '/site/{tail:.*}',
    '/t/{tail:.*}',
    '/secret',
    '/portal.js',
    '/api/hapi_enterprise/public/v1/{tail:.*}',
  ]) {
    assert.ok(wired.includes(must), 'регистриран е изглед ' + must);
  }
  for (const v of out.wired.views) assert.equal(v.auth, false, 'публичните изгледи не искат HA сесия: ' + v.url);
  const names = out.wired.views.map((v) => v.url);
  assert.equal(new Set(names).size, names.length, 'няма дублирани изгледи');

  console.log(`ha-integration-import OK: зарежда се · CONFIG_SCHEMA · ${out.empty.views.length} изгледа без backend · ${out.wired.views.length} с backend · всички без сесия`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
