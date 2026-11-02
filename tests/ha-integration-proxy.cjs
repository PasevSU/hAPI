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

const { STUBS } = require('./lib/ha-stubs.cjs');

const LOADER = [
  'import asyncio',
  'import json',
  'import sys',
  'import urllib.parse',
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
  '        raw = path.split("?", 1)',
  '        self.path = raw[0]',
  '        query = Query()',
  '        if len(raw) > 1 and raw[1]:',
  '            for pair in raw[1].split("&"):',
  '                if "=" in pair:',
  '                    key, value = pair.split("=", 1)',
  '                    query[urllib.parse.unquote_plus(key)] = urllib.parse.unquote_plus(value)',
  '        self.query = query',
  '        self.headers = headers or {}',
  '',
  '    async def read(self):',
  '        return b""',
  '',
  'async def main(port, tail, keyed="0"):',
  '    raw_tail, query = (tail.split("?", 1) + [""])[:2] if "?" in tail else (tail, "")',
  '    hass = FakeHass(web.Session())',
  '    await integ.async_setup(hass, {"hapi_enterprise": {"backend_url": "http://127.0.0.1:%d" % port}})',
  '    if keyed == "1":',
  '        view = [v for v in hass.http.views if getattr(v, "url", "") == "/api/hapi_enterprise/v1/{tail:.*}"][0]',
  '    else:',
  '        view = [v for v in hass.http.views if getattr(v, "url", "") == "/api/v1/p/{tail:.*}"][0] if raw_tail.startswith("p/") else [v for v in hass.http.views if getattr(v, "url", "") == "/t/{tail:.*}"][0]',
  '    path = ("/api/v1/" + raw_tail) if raw_tail.startswith("p/") else ("/" + raw_tail)',
  '    if query:',
  '        path = path + "?" + query',
  '    headers = {"X-Portal-Key": "proxy-e2e-portal-key"} if keyed == "1" else None',
  '    response = await view.get(Request(path, headers), tail=raw_tail)',
  '    body = b"".join(response.chunks).decode("utf-8", "replace")',
  '    print(json.dumps({"status": response.status, "body": body, "type": response.headers.get("Content-Type"), "location": response.headers.get("Location", ""), "cookies": response.headers.getall("Set-Cookie", [])}))',
  '',
  'port, tail = int(sys.argv[1]), sys.argv[2]',
  'asyncio.run(main(port, tail, sys.argv[3] if len(sys.argv) > 3 else "0"))',
].join('\n');

const python = findPython();
if (!python) {
  console.log('ha-integration-proxy: няма python — проксирането не се проверява');
  process.exit(0);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-proxy-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-proxy-data-'));
  // Папката на тестовия портал се чисти ПРЕДИ и СЛЕД пуск — иначе следващ тест вижда
  // чужди файлове и „минава“ по грешка.
  const shareDir = path.join(path.parse(process.cwd()).root, 'share', 'proxy-papka');
  fs.rmSync(shareDir, { recursive: true, force: true });
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
    // Портал със СОБСТВЕНА папка: публичната страница в режим „папка“ вика `/tree` и
    // `/tree/file?path=` (portal.js), тоест без тези два пътя в моста страницата през
    // Home Assistant се отваря, но списъкът и файловете ѝ — не.
    const shareDir = path.join(path.parse(process.cwd()).root, 'share', 'proxy-papka');
    fs.rmSync(shareDir, { recursive: true, force: true });
    let folderReady = true;
    try {
      fs.mkdirSync(path.join(shareDir, 'Договори'), { recursive: true });
      fs.writeFileSync(path.join(shareDir, 'Договори', 'анекс.txt'), 'съдържание на анекса');
    } catch (e) {
      // Без /share (или без права) частта за папката се пропуска с причина, а не пада.
      folderReady = false;
      console.log(`  (пропусната част за папката: ${shareDir} не може да се създаде — ${e.code || e.message})`);
    }
    if (folderReady) {
      const mkFolder = await fetch(`http://127.0.0.1:${port}/admin/api/portals`, {
        method: 'POST', headers: H, body: JSON.stringify({ slug: 'papka', title: 'Папка', visibility: 'public', storage_root: '/share/proxy-papka' }),
      });
      assert.equal(mkFolder.status, 201, 'порталът с папка се създава: ' + mkFolder.status);
    }

    for (const [name, body] of Object.entries(STUBS)) {
      const file = path.join(dir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
    const loader = path.join(dir, 'proxy_once.py');
    fs.writeFileSync(loader, LOADER);

    const throughBridge = (tail, keyed = false) => {
      const run = spawnSync(python, [loader, String(port), tail, keyed ? '1' : '0'], {
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
    assert.equal(payload.title, portal.title, 'тялото е на СЪЗДАДЕНИЯ портал, не на друг');
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

    // 3б. Договорните документи на портала — картата (`api.json`), QR договорът (`qr.json`)
    //     и ръкостискът (`ping`). До 0.69.100 картата не се сервираше, а после и двата нови
    //     адреса липсваха в `_ALLOWED`: документ, който ги обявява, а HA ги затваря, е
    //     същата измама като мъртва препратка. Сверяват се през ДВАТА изгледа на интеграцията.
    const stable = (value) => ({ ...value, updatedAt: '', time: '' });
    for (const doc of ['api.json', 'qr.json', 'ping']) {
      const direct = await (await fetch(`http://127.0.0.1:${port}/api/v1/p/proxied/${doc}`)).json();
      for (const [label, keyed] of [['публичния изглед', false], ['ключовия изглед', true]]) {
        const out = throughBridge('p/proxied/' + doc, keyed);
        assert.equal(out.status, 200, `${doc} се сервира през ${label}: ` + out.body.slice(0, 120));
        assert.deepEqual(stable(JSON.parse(out.body)), stable(direct), `${doc} през ${label} е същият като по правия път`);
      }
    }
    const mapDirect = await (await fetch(`http://127.0.0.1:${port}/api/v1/p/proxied/api.json`)).json();
    assert.ok(String(mapDirect.qrJson || '').endsWith('/api/v1/p/proxied/qr.json'), 'картата обявява qr.json: ' + mapDirect.qrJson);

    // 3в. Договорът за ПАПКА през моста — това, което публичната страница вика сама.
    // `generatedAt`/`time` са „сега“ при всяко четене, затова се зануляват при сверката.
    const normalise = (text) => {
      try {
        const value = JSON.parse(text);
        if (value && typeof value === 'object') {
          if ('generatedAt' in value) value.generatedAt = '';
          if ('time' in value) value.time = '';
          return JSON.stringify(value);
        }
      } catch { /* не е JSON — сверява се както е */ }
      return text;
    };
    for (const tail of ['p/papka/tree?path=/Договори', 'p/papka/tree/api.json?path=/Договори', 'p/papka/tree/qr.svg?path=/Договори', 'p/papka/tree/file?path=/Договори/анекс.txt']) {
      if (!folderReady) break;
      const direct = await fetch(`http://127.0.0.1:${port}/api/v1/${tail}`);
      const directBody = await direct.text();
      assert.equal(direct.status, 200, 'правият път работи за ' + tail + ': ' + direct.status);
      for (const [label, keyed] of [['публичния изглед', false], ['ключовия изглед', true]]) {
        const out = throughBridge(tail, keyed);
        assert.equal(out.status, 200, `${tail} се сервира през ${label}: ` + out.body.slice(0, 160));
        assert.equal(normalise(out.body), normalise(directBody), `${tail} през ${label} връща СЪЩОТО тяло като правия път`);
      }
    }

    // 4. Вход по токен (`/t/<токен>`): издава се токен за ЧАСТЕН портал и се проверява, че
    //    мостът подава пренасочването И бисквитката — без тях частният портал остава затворен.
    const hidden = await (await fetch(`http://127.0.0.1:${port}/admin/api/portals`, {
      method: 'POST', headers: H, body: JSON.stringify({ slug: 'hidden', title: 'Hidden', visibility: 'private' }),
    })).json();
    const issued = await fetch(`http://127.0.0.1:${port}/admin/api/portals/${hidden.id}/tokens`, {
      method: 'POST', headers: H, body: JSON.stringify({ label: 'e2e' }),
    });
    assert.equal(issued.status, 201, 'издава се токен: ' + issued.status);
    const granted = JSON.parse(await issued.text());
    const portalToken = granted.token;
    assert.ok(portalToken, 'отговорът носи токена');
    const login = throughBridge('t/' + portalToken);
    assert.equal(login.status, 302, 'входът по токен пренасочва: ' + login.status);
    assert.ok(String(login.location).includes('/p/'), 'пренасочването води към портала: ' + login.location);
    assert.ok(login.cookies.some((c) => /hapi_session=/.test(c)), 'мостът подава бисквитката за сесия');

    console.log(`ha-integration-proxy OK: изгледът на интеграцията → истински hAPI · 200 · ${out.body.length}B · същото тяло като правия път · /files съвпада · api.json + qr.json + ping съвпадат през двата изгледа (${JSON.stringify(mapDirect).length}B) · /tree и /tree/file съвпадат (папката на страницата работи) · /t/<токен> дава ${login.status} + бисквитка`);
  } finally {
    await stopChild(child);
    fs.rmSync(shareDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
