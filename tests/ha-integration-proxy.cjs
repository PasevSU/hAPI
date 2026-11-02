'use strict';
// Доказателството, което липсваше: изгледът на интеграцията наистина проксира до истински
// работещ hAPI и връща данните. Досега тестовете само я зареждаха — нито един не извикваше
// `view.get(...)`, тоест `_forward`, копирането на заглавки и стриймването не бяха проверени.
//
// Тук се пуска ИСТИНСКИЯТ сървър (`hapi_enterprise/server.js`), създава се публичен портал, и
// след това Python модулът на интеграцията се зарежда срещу заготовки, в които "сесията" е
// истински HTTP клиент (urllib), а `web.StreamResponse` записва байтовете. Извиква се
// `view.get(request, tail='p/<slug>')` за изгледа `/api/v1/p/{tail:.*}` и се проверява, че
// тялото е JSON-ът на портала, статусът е 200, а `Content-Type` е запазен.
const { stopChild } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const port = 18422;
const token = 'proxy-e2e-admin-secret-2026-p7q3';

const findPython = () => {
  for (const cmd of ['python', 'py', 'python3']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return cmd;
  }
  return '';
};

const STUBS = {
  'homeassistant/__init__.py': '',
  'homeassistant/core.py': 'class HomeAssistant:\n    pass\n',
  'homeassistant/config_entries.py': 'class ConfigEntry:\n    pass\n',
  'homeassistant/const.py': 'CONF_NAME = "name"\nCONF_TOKEN = "token"\n',
  'homeassistant/components/__init__.py': '',
  'homeassistant/components/http.py': 'class HomeAssistantView:\n    url = None\n    name = None\n    requires_auth = True\n',
  'homeassistant/helpers/__init__.py': '',
  'homeassistant/helpers/config_validation.py': 'string = str\n',
  'homeassistant/helpers/aiohttp_client.py': 'def async_get_clientsession(hass, *a, **k):\n    return hass.session\n',
  'homeassistant/helpers/update_coordinator.py': [
    'class UpdateFailed(Exception):',
    '    pass',
    '',
    'class CoordinatorEntity:',
    '    def __init__(self, coordinator=None):',
    '        self.coordinator = coordinator',
    '',
    'class DataUpdateCoordinator:',
    '    def __init__(self, hass=None, **kwargs):',
    '        self.hass, self.data = hass, None',
    '',
  ].join('\n'),
  'homeassistant/util/__init__.py': '',
  'homeassistant/util/dt.py': 'def utcnow():\n    import datetime\n    return datetime.datetime.now(datetime.timezone.utc)\n',
  'voluptuous/__init__.py': [
    'ALLOW_EXTRA = "allow"',
    'class Invalid(Exception):',
    '    pass',
    'class _Key:',
    '    def __init__(self, key, default=None):',
    '        self.key, self.default = key, default',
    'class _Schema:',
    '    def __init__(self, schema, extra=None, required=False):',
    '        self.schema, self.extra = schema, extra',
    '    def __call__(self, value):',
    '        return value',
    'def Schema(schema, extra=None, required=False):',
    '    return _Schema(schema, extra, required)',
    'def Optional(key, default=None):',
    '    return _Key(key, default)',
    'def Required(key, default=None):',
    '    return _Key(key, default)',
    'def In(options):',
    '    return options',
    'def All(*v):',
    '    return v',
    'def Any(*v):',
    '    return v',
    'def Coerce(kind):',
    '    return kind',
  ].join('\n'),
  'aiohttp/__init__.py': 'from . import web  # noqa: F401\n\n\nclass ClientError(Exception):\n    pass\n',
  // Сесията е ИСТИНСКИ HTTP клиент: изгледът ще говори с пуснатия до него сървър.
  'aiohttp/web.py': [
    'import json',
    'import urllib.error',
    'import urllib.parse',
    'import urllib.request',
    '',
    'class Headers(dict):',
    '    def getall(self, key, default=None):',
    '        value = self.get(key.lower())',
    '        return [value] if value else (default or [])',
    '',
    'class _Content:',
    '    def __init__(self, body):',
    '        self.body = body',
    '',
    '    def iter_chunked(self, size):',
    '        body, step = self.body, min(int(size), 8192)',
    '',
    '        async def gen():',
    '            for i in range(0, len(body), step):',
    '                yield body[i:i + step]',
    '',
    '        return gen()',
    '',
    'class _Upstream:',
    '    def __init__(self, status, headers, body):',
    '        self.status = status',
    '        self.headers = headers',
    '        self.content = _Content(body)',
    '',
    '    async def __aenter__(self):',
    '        return self',
    '',
    '    async def __aexit__(self, *exc):',
    '        return False',
    '',
    'class Session:',
    '    """Само това, което мостът ползва: request(...) като async context manager."""',
    '',
    '    def request(self, method, url, headers=None, params=None, data=None, **kwargs):',
    '        if params:',
    '            url = url + "?" + urllib.parse.urlencode(params)',
    '        req = urllib.request.Request(url, method=method, data=data)',
    '        for key, value in (headers or {}).items():',
    '            req.add_header(key, value)',
    '        try:',
    '            with urllib.request.urlopen(req, timeout=20) as resp:',
    '                hdrs = Headers({k.lower(): v for k, v in resp.headers.items()})',
    '                head = Headers()',
    '                for k, v in resp.headers.items():',
    '                    head[k.lower()] = v',
    '                head.headers = resp.headers',
    '                class _H(Headers):',
    '                    def get(self, key, default=None):',
    '                        return resp.headers.get(key, default)',
    '                return _Upstream(resp.status, _H({k.lower(): v for k, v in resp.headers.items()}), resp.read())',
    '        except urllib.error.HTTPError as e:',
    '            class _H2(Headers):',
    '                def get(self, key, default=None):',
    '                    return e.headers.get(key, default)',
    '            return _Upstream(e.code, _H2(), e.read())',
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
    '        self.chunks = []',
    '',
    '    async def prepare(self, request):',
    '        return None',
    '',
    '    async def write(self, chunk):',
    '        self.chunks.append(bytes(chunk))',
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
    '',
  ].join('\n'),
};

const LOADER = [
  'import asyncio',
  'import json',
  'import sys',
  'import aiohttp.web as web',
  'import custom_components.hapi_enterprise as integ',
  '',
  'class FakeHttp:',
  '    def __init__(self):',
  '        self.views = []',
  '',
  '    def register_view(self, view):',
  '        self.views.append(view)',
  '',
  'class FakeHass:',
  '    def __init__(self, session):',
  '        self.data = {}',
  '        self.http = FakeHttp()',
  '        self.session = session',
  '        self.config = type("C", (), {"path": staticmethod(lambda *a: "/tmp")})()',
  '',
  '    async def async_add_executor_job(self, func, *args):',
  '        return func(*args)',
  '',
  'class Query(dict):',
  '    pass',
  '',
  'class Request:',
  '    def __init__(self, path, headers=None):',
  '        self.method = "GET"',
  '        self.path = path',
  '        self.headers = headers or {}',
  '        self.query = Query()',
  '',
  '    async def read(self):',
  '        return b""',
  '',
  'async def main(port, tail):',
  '    hass = FakeHass(web.Session())',
  '    await integ.async_setup(hass, {"hapi_enterprise": {"backend_url": "http://127.0.0.1:%d" % port}})',
  '    view = [v for v in hass.http.views if getattr(v, "url", "") == "/api/v1/p/{tail:.*}"][0]',
  '    response = await view.get(Request("/api/v1/" + tail), tail=tail)',
  '    body = b"".join(response.chunks).decode("utf-8")',
  '    print(json.dumps({"status": response.status, "body": body, "type": response.headers.get("Content-Type")}))',
  '',
  'port, tail = int(sys.argv[1]), sys.argv[2]',
  'asyncio.run(main(port, tail))',
].join('\n');

const python = findPython();
if (!python) {
  console.log('ha-integration-proxy: няма python — проксирането не се проверява');
  process.exit(0);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-proxy-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-proxy-data-'));
  const child = spawn(process.execPath, [path.join(root, 'hapi_enterprise', 'server.js')], {
    env: { ...process.env, DATA_DIR: data, ADMIN_TOKEN: token, PORT: String(port), PUBLIC_GATEWAY_PORT: '0', PUBLIC_BASE_URL: '' },
    stdio: 'pipe',
  });
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { ready = true; break; } } catch { /* още се вдига */ }
      await new Promise((r) => setTimeout(r, 80));
    }
    assert.ok(ready, 'сървърът се вдига');
    const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    const mk = await fetch(`http://127.0.0.1:${port}/admin/api/portals`, {
      method: 'POST', headers: H, body: JSON.stringify({ slug: 'proxied', title: 'Proxied', visibility: 'public' }),
    });
    assert.equal(mk.status, 201, 'порталът се създава');
    const portal = JSON.parse(await mk.text());

    for (const [name, body] of Object.entries(STUBS)) {
      const file = path.join(dir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
    const loader = path.join(dir, 'proxy_once.py');
    fs.writeFileSync(loader, LOADER);

    const throughBridge = (tail) => {
      const run = spawnSync(python, [loader, String(port), tail], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, PYTHONPATH: [dir, root].join(path.delimiter), PYTHONDONTWRITEBYTECODE: '1' },
      });
      assert.equal(run.status, 0, 'изгледът се изпълнява:\n' + (run.stderr || run.stdout || ''));
      return JSON.parse(String(run.stdout).trim().split(/\r?\n/).pop());
    };

    // 1. Изгледът връща 200 и ТЯЛОТО на портала — не празно, не грешка.
    const out = throughBridge('p/proxied');
    assert.equal(out.status, 200, 'изгледът връща 200');
    const payload = JSON.parse(out.body);
    assert.equal(payload.slug, 'proxied', 'тялото е JSON-ът на портала');
    assert.ok(String(out.type).includes('application/json'), 'Content-Type се запазва: ' + out.type);

    // 2. Същото тяло идва и по правия път — сверка, че не е измислено от заготовките.
    const direct = await (await fetch(`http://127.0.0.1:${port}/api/v1/p/proxied`)).json();
    assert.deepEqual(payload, direct, 'през моста идва същото, което дава сървърът');

    // 3. Втори endpoint (списъкът файлове) минава по същия път и също съвпада.
    const filesOut = throughBridge('p/proxied/files');
    assert.equal(filesOut.status, 200, 'списъкът файлове се сервира през моста');
    const filesBridge = JSON.parse(filesOut.body);
    const filesDirect = await (await fetch(`http://127.0.0.1:${port}/api/v1/p/proxied/files`)).json();
    assert.deepEqual(filesBridge, filesDirect, 'списъкът файлове е същият през моста');
    assert.equal(portal.slug, filesDirect.slug ?? portal.slug, 'порталът е един и същ');

    console.log(`ha-integration-proxy OK: изгледът на интеграцията → истински hAPI · 200 · ${out.body.length}B · същото тяло като правия път · /files също съвпада`);
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
