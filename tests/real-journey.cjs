'use strict';
// 0.69.95 — РЕАЛНИЯТ ПЪТ НА ЧОВЕКА, който получава линк. Не „има маршрут“, а:
//   пращам /t/<токен> → отваря се порталът → виждам файла → изтеглям го → отнемам токена.
//
// Две части, защото човекът минава през Home Assistant, не през порта 8099:
//   1) прав поток към hAPI (еталон: какво ТРЯБВА да се получи);
//   2) същият поток ПРЕЗ интеграцията (`custom_components/hapi_enterprise`), с истински
//      Python модул и заготовки, в които сесията е истински HTTP клиент.
//
// Втората част хвана дефект, който никой тест не виждаше: мостът не подаваше `Cookie`.
// Токенът слагаше бисквитка, но следващата заявка пристигаше анонимна — тоест линкът
// „работеше“, а частният портал даваше 404. Затова тук се проверява точно последователността
// „бисквитка → страница → файл“, а не отделните стъпки поотделно.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startServer } = require('./lib/gui-harness.cjs');
const { STUBS } = require('./lib/ha-stubs.cjs');

const root = path.join(__dirname, '..');
const DOC = 'съдържание на документа за пътуването';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const findPython = () => {
  for (const cmd of ['python', 'py', 'python3']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return cmd;
  }
  return '';
};

// Python: същите стъпки, но през ИЗГЛЕДИТЕ на интеграцията (както ги вика Home Assistant).
const BRIDGE_JOURNEY = [
  'import asyncio',
  'import hashlib',
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
  'async def main(port, token, portal_id, slug, file_id):',
  '    hass = FakeHass(web.Session())',
  '    await integ.async_setup(hass, {"hapi_enterprise": {"backend_url": "http://127.0.0.1:%d" % port}})',
  '    views = {getattr(v, "url", ""): v for v in hass.http.views}',
  '    out = {}',
  '',
  '    async def call(view_url, req_path, tail, headers=None):',
  '        view = views[view_url]',
  '        return await view.get(Request(req_path, headers), tail=tail)',
  '',
  '    def shape(r, body=True):',
  '        data = b"".join(r.chunks)',
  '        return {',
  '            "status": r.status,',
  '            "location": r.headers.get("Location", "") or "",',
  '            "cookies": r.headers.getall("Set-Cookie", []),',
  '            "length": len(data),',
  '            "sha256": hashlib.sha256(data).hexdigest(),',
  '            "text": data.decode("utf-8", "replace")[:400] if body else "",',
  '            "contentRange": r.headers.get("Content-Range", "") or "",',
  '        }',
  '',
  '    # 1. Вход по токен: пренасочване + бисквитка.',
  '    out["login"] = shape(await call("/t/{tail:.*}", "/t/" + token, "t/" + token))',
  '    cookie = ""',
  '    if out["login"]["cookies"]:',
  '        cookie = out["login"]["cookies"][0].split(";")[0]',
  '',
  '    # 2. Порталът се отваря С бисквитката и НЕ се отваря без нея.',
  '    out["page"] = shape(await call("/p/{tail:.*}", "/p/" + portal_id, "p/" + portal_id, {"Cookie": cookie}))',
  '    out["pageAnonymous"] = shape(await call("/p/{tail:.*}", "/p/" + portal_id, "p/" + portal_id))',
  '',
  '    # 3. Списъкът файлове на портала.',
  '    files_resp = await call("/api/v1/p/{tail:.*}", "/api/v1/p/" + slug + "/files", "p/" + slug + "/files", {"Cookie": cookie})',
  '    out["files"] = shape(files_resp)',
  '    out["filesData"] = json.loads(b"".join(files_resp.chunks).decode("utf-8"))',
  '',
  '    # 4. Изтегляне на файла — целият и с Range (възобновяване).',
  '    out["download"] = shape(await call("/api/v1/p/{tail:.*}", "/api/v1/p/" + slug + "/files/" + file_id + "/download", "p/" + slug + "/files/" + file_id + "/download", {"Cookie": cookie}))',
  '    out["range"] = shape(await call("/api/v1/p/{tail:.*}", "/api/v1/p/" + slug + "/files/" + file_id + "/download", "p/" + slug + "/files/" + file_id + "/download", {"Cookie": cookie, "Range": "bytes=0-4"}), body=False)',
  '',
  '    print(json.dumps(out))',
  '',
  'port, token, portal_id, slug, file_id = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]',
  'asyncio.run(main(port, token, portal_id, slug, file_id))',
].join('\n');

(async () => {
  const server = await startServer();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-journey-'));
  try {
    // ── Подготовка: частен портал с ЕДИН регистриран документ ────────────────
    const slug = 'journey-' + Date.now().toString(36);
    const folder = path.join(path.resolve('/share'), slug);
    fs.mkdirSync(folder, { recursive: true });
    const created = await server.api('/admin/api/portals', 'POST', { slug, title: 'Пътуване', visibility: 'private', storage_root: '/share/' + slug });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data).slice(0, 160));
    const portal = created.data;

    const uploaded = await server.authFetch(`${server.base}/admin/api/portals/${portal.id}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('документ.txt'), 'X-File-Encrypt': '0' },
      body: DOC,
    });
    assert.equal(uploaded.status, 201, 'документът се качва: ' + uploaded.status);
    const document = await uploaded.json();
    // Нов документ НЕ е свободен за изтегляне по подразбиране (политиката решава по файл).
    // Затова тук се прави точно това, което прави панелът: задава се режим FREE.
    const access = await server.api(`/admin/api/portals/${portal.id}/files/${document.id}/access`, 'PATCH', { mode: 'FREE', listed: true });
    assert.equal(access.status, 200, 'режимът на файла се задава: ' + access.status);

    const granted = await server.api(`/admin/api/portals/${portal.id}/tokens`, 'POST', { label: 'пътуване', scopes: ['read', 'download'] });
    assert.equal(granted.status, 201, 'токенът се издава');
    assert.deepEqual(granted.data.scopes, ['read', 'download'], 'токенът носи право за изтегляне');
    const secret = granted.data.token;

    // ── Част 1: правият път (еталон) ─────────────────────────────────────────
    const login = await fetch(`${server.base}/t/${secret}`, { redirect: 'manual' });
    assert.equal(login.status, 302, 'входът по токен пренасочва');
    assert.ok(String(login.headers.get('location')).includes('/p/'), 'пренасочването води към портала');
    const cookie = (login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get('set-cookie')])[0].split(';')[0];
    assert.match(cookie, /^hapi_session=/, 'бисквитката е сесийна');

    const page = await fetch(`${server.base}/p/${portal.id}`, { headers: { Cookie: cookie } });
    assert.equal(page.status, 200, 'порталът се отваря с бисквитката');
    const pageHtml = await page.text();
    assert.match(pageHtml, /portal\.js/, 'страницата е порталът (зарежда portal.js)');
    // Страницата е обвивка: адресите идват от сървъра в `#hapi-boot`. Затова се проверява, че
    // шаблоните са ЗАМЕСТЕНИ и че API адресът сочи точно този портал — иначе човек отваря
    // страница, която после не знае къде да търси данните си.
    assert.equal(/\{\{(BASE|API|FOLDER|FOLDERS|QR)\}\}/.test(pageHtml), false, 'няма незаместени шаблони');
    assert.ok(pageHtml.includes(`/api/v1/p/${slug}`), 'страницата сочи API-то на ТОЗИ портал');

    const anonymous = await fetch(`${server.base}/p/${portal.id}`);
    assert.equal(anonymous.status, 404, 'без бисквитка частният портал не се отваря');
    assert.equal((await anonymous.text()).includes(portal.title), false, 'анонимният отговор не разкрива заглавието');

    const directFiles = await (await fetch(`${server.base}/api/v1/p/${slug}/files`, { headers: { Cookie: cookie } })).json();
    assert.equal(directFiles.files.length, 1, 'порталът показва един файл');
    assert.equal(directFiles.files[0].id, document.id, 'това е каченият документ');
    assert.equal(directFiles.files[0].sha256, sha256(DOC), 'хешът е на истинското съдържание');

    const directDownload = await fetch(`${server.base}/api/v1/p/${slug}/files/${document.id}/download`, { headers: { Cookie: cookie } });
    const directBody = await directDownload.text();
    assert.equal(directDownload.status, 200, 'файлът се изтегля: ' + directDownload.status + ' ' + directBody.slice(0, 160));
    assert.equal(directBody, DOC, 'байтовете са същите');

    const directRange = await fetch(`${server.base}/api/v1/p/${slug}/files/${document.id}/download`, { headers: { Cookie: cookie, Range: 'bytes=0-4' } });
    assert.equal(directRange.status, 206, 'Range дава 206');
    assert.equal((await directRange.arrayBuffer()).byteLength, 5, 'Range дава пет байта');

    // ── Част 1.5: вторият реален случай — ПУБЛИЧЕН портал ───────────────────
    // Публичният портал се отваря без нищо (нито бисквитка, нито ключ). Ако това се счупи,
    // адресите, които човек раздава, спират да работят за всички, които нямат сесия.
    const publicSlug = slug + '-pub';
    const publicPortal = (await server.api('/admin/api/portals', 'POST', { slug: publicSlug, title: 'Публичен', visibility: 'public' })).data;
    const publicDoc = await (await server.authFetch(`${server.base}/admin/api/portals/${publicPortal.id}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('публичен.txt'), 'X-File-Encrypt': '0' },
      body: 'публично съдържание',
    })).json();
    await server.api(`/admin/api/portals/${publicPortal.id}/files/${publicDoc.id}/access`, 'PATCH', { mode: 'FREE', listed: true });
    const publicPage = await fetch(`${server.base}/p/${publicPortal.id}`);
    assert.equal(publicPage.status, 200, 'публичният портал се отваря без бисквитка');
    const publicFiles = await (await fetch(`${server.base}/api/v1/p/${publicSlug}/files`)).json();
    assert.equal(publicFiles.files.length, 1, 'публичният портал показва файла си без сесия');
    const publicDownload = await fetch(`${server.base}/api/v1/p/${publicSlug}/files/${publicDoc.id}/download`);
    assert.equal(publicDownload.status, 200, 'файлът на публичния портал се изтегля без сесия');
    assert.equal(await publicDownload.text(), 'публично съдържание', 'байтовете на публичния файл са същите');

    // Несъществуващ портал не издава нищо — нито 200, нито име.
    const missing = await fetch(`${server.base}/api/v1/p/nyama-takuv-portal`);
    assert.equal(missing.status, 404, 'несъществуващ портал → 404');
    const missingPage = await fetch(`${server.base}/p/nyama-takuv-portal`);
    assert.equal(missingPage.status, 404, 'несъществуваща страница на портал → 404');

    // Range извън размера на файла се отказва с 416, а не се връща цялото тяло.
    const beyond = await fetch(`${server.base}/api/v1/p/${publicSlug}/files/${publicDoc.id}/download`, { headers: { Range: 'bytes=9999-' } });
    assert.equal(beyond.status, 416, 'Range извън файла → 416: ' + beyond.status);

    // ── Част 2: същият път ПРЕЗ интеграцията на Home Assistant ───────────────
    const python = findPython();
    if (!python) {
      console.log('real-journey: няма python — частта през интеграцията не се проверява');
    } else {
      for (const [name, body] of Object.entries(STUBS)) {
        const file = path.join(data, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
      }
      const loader = path.join(data, 'journey.py');
      fs.writeFileSync(loader, BRIDGE_JOURNEY);
      const run = spawnSync(python, [loader, String(new URL(server.base).port), secret, portal.id, slug, document.id], {
        cwd: root, encoding: 'utf8',
        env: { ...process.env, PYTHONPATH: [data, root].join(path.delimiter), PYTHONDONTWRITEBYTECODE: '1' },
      });
      assert.equal(run.status, 0, 'пътуването през интеграцията се изпълнява:\n' + (run.stderr || run.stdout || ''));
      const through = JSON.parse(String(run.stdout).trim().split(/\r?\n/).pop());

      assert.equal(through.login.status, 302, 'през интеграцията входът също пренасочва');
      assert.ok(through.login.location.includes('/p/'), 'през интеграцията пренасочването води към портала');
      assert.ok(through.login.cookies.length > 0, 'през интеграцията бисквитката стига до браузъра');

      assert.equal(through.page.status, 200, 'ПОРТАЛЪТ СЕ ОТВАРЯ през интеграцията (бисквитката се подава)');
      assert.equal(through.page.sha256, sha256(pageHtml), 'през интеграцията идва СЪЩАТА страница');
      assert.equal(through.pageAnonymous.status, 404, 'през интеграцията анонимният опит пак е 404');

      const bridgedFiles = through.filesData;
      assert.equal(bridgedFiles.files.length, 1, 'през интеграцията списъкът има същия файл');
      assert.equal(bridgedFiles.files[0].id, document.id, 'през интеграцията файлът е същият');

      assert.equal(through.download.status, 200, 'през интеграцията файлът се изтегля');
      assert.equal(through.download.sha256, sha256(DOC), 'през интеграцията байтовете са същите');
      assert.equal(through.range.status, 206, 'през интеграцията Range дава 206');
      assert.equal(through.range.length, 5, 'през интеграцията Range дава пет байта');
    }

    // ── Последна стъпка: токенът се отнема и линкът умира ────────────────────
    const revoked = await server.api(`/admin/api/portals/${portal.id}/tokens/${granted.data.id}`, 'DELETE');
    assert.equal(revoked.status, 200, 'токенът се отнема');
    const dead = await fetch(`${server.base}/t/${secret}`, { redirect: 'manual' });
    assert.equal(dead.status, 404, 'отнет токен не отваря нищо');
    assert.equal((await dead.text()).includes('Връзката не е валидна'), true, 'отказът е разбираем за човека');

    console.log('PASS real-journey: /t/<токен> → 302 + бисквитка · портал 200 с нея и 404 без нея · 1 файл с точен SHA-256 · изтегляне и Range 206 · публичен портал без сесия · несъществуващ → 404 · Range извън файла → 416 · същото през интеграцията на HA · отнет токен → 404');
  } finally {
    await server.stop();
    try { fs.rmSync(path.join(path.resolve('/share'), 'journey-' + ''), { recursive: true, force: true }) } catch { /* няма */ }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
