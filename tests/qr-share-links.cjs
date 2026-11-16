'use strict';
// QR СТУДИО: ВРЕМЕННА · САМО ЗА ЧЕТЕНЕ · С ПАРОЛА ВРЪЗКА (0.69.229).
//
// Защо има тест: собственикът поиска от панела да издава код, който (а) важи само определен срок,
// (б) води към спътника „само за преглед“ и (в) иска парола — без това да променя самия портал,
// защото иначе „временният“ код би заключил и постоянния. Договорът е:
//   • записът живее в ПОРТАЛА (`links[]`), а адресът е къс и непредвидим (`/x/<id>`);
//   • отварянето ПРЕНАСОЧВА към подписания достъп — не се въвежда втори начин за влизане;
//   • срокът е между 5 минути и 24 часа (таванът е същият като на подписания достъп);
//   • паролата се пази като `scrypt$…`, никога в чист вид и никога в адрес;
//   • изтекла връзка дава 410, изтрита — 404.
const assert = require('node:assert/strict');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const { stopChild } = require('./helpers.cjs');

(async () => {
  const server = await startServer();
  const base = server.base;
  const token = server.token;
  const api = async (p, method = 'GET', body) => {
    const res = await fetch(base + p, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };
  const open = (url, init) => fetch(url.startsWith('http') ? url : base + url, { redirect: 'manual', ...(init || {}) });

  try {
    // Портал с частна видимост и спътник „само за преглед“ (иначе „само за четене“ няма накъде).
    const made = await api('/admin/api/portals', 'POST', { slug: 'qr-links', title: 'Връзки', visibility: 'private', readonlyView: true });
    assert.equal(made.status, 201, 'порталът се създава: ' + JSON.stringify(made.data));
    const portalId = made.data.id;
    const companionId = made.data.contract && made.data.contract.readOnly ? made.data.contract.readOnly.id : '';
    assert.ok(companionId, 'порталът има спътник „само за преглед“: ' + JSON.stringify(made.data.contract));

    // ── 1. Обикновена временна връзка ─────────────────────────────────────
    const created = await api(`/admin/api/portals/${portalId}/links`, 'POST', { ttlSeconds: 600 });
    assert.equal(created.status, 201, 'връзката се създава: ' + JSON.stringify(created.data));
    const link = created.data.link;
    assert.match(link.url, /^\/x\/[A-Za-z0-9_-]{12}$/, 'адресът е къс и непредвидим: ' + link.url);
    const ttlMs = Date.parse(link.expiresAt) - Date.now();
    assert.ok(ttlMs > 540_000 && ttlMs <= 600_000, 'срокът е поисканите 10 минути: ' + ttlMs);

    const hop = await open(link.url);
    assert.equal(hop.status, 302, 'връзката пренасочва: ' + hop.status);
    const location = String(hop.headers.get('location') || '');
    assert.match(location, new RegExp(`/p/${portalId}\\?expires=\\d+&sig=[a-f0-9]{64}$`), 'води към подписания достъп: ' + location);
    const page = await fetch(location);
    assert.equal(page.status, 200, 'подписаният адрес отваря портала: ' + page.status);
    await page.text();

    // ── 2. Само за четене води към СПЪТНИКА ───────────────────────────────
    const ro = await api(`/admin/api/portals/${portalId}/links`, 'POST', { ttlSeconds: 600, readOnly: true });
    assert.equal(ro.status, 201, 'връзката „само за четене“ се създава');
    assert.equal(ro.data.link.readOnly, true, 'връзката е отбелязана като „само за четене“');
    const roHop = await open(ro.data.link.url);
    assert.equal(roHop.status, 302, 'и тя пренасочва');
    assert.match(String(roHop.headers.get('location') || ''), new RegExp(`/p/${companionId}\\?`), 'води към спътника, не към портала');

    // ── 3. Парола: страница, грешка, успех ────────────────────────────────
    const withPass = await api(`/admin/api/portals/${portalId}/links`, 'POST', { ttlSeconds: 600, password: 'tajna123' });
    assert.equal(withPass.status, 201, 'връзката с парола се създава');
    assert.equal(withPass.data.link.hasPassword, true, 'административният изглед казва, че има парола');
    assert.equal(JSON.stringify(withPass.data).includes('tajna123'), false, 'паролата НЕ се връща в отговора');
    assert.equal('passwordHash' in withPass.data.link, false, 'хешът не излиза навън');
    const form = await open(withPass.data.link.url);
    assert.equal(form.status, 200, 'без парола се показва форма: ' + form.status);
    assert.equal(form.headers.get('location'), null, 'никакво пренасочване преди паролата');
    assert.match(await form.text(), /<form[^>]+action="\/x\//, 'формата праща към същия адрес');
    const wrong = await open(withPass.data.link.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=greshna',
    });
    assert.equal(wrong.status, 401, 'грешната парола е 401: ' + wrong.status);
    const right = await open(withPass.data.link.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=tajna123',
    });
    assert.equal(right.status, 302, 'вярната парола пренасочва: ' + right.status);
    assert.match(String(right.headers.get('location') || ''), /expires=\d+&sig=/, 'след паролата се дава подписаният достъп');

    // ── 4. Срокът се затяга в границите ───────────────────────────────────
    const short = await api(`/admin/api/portals/${portalId}/links`, 'POST', { ttlSeconds: 5 });
    const shortMs = Date.parse(short.data.link.expiresAt) - Date.now();
    assert.ok(shortMs > 240_000, 'под 5 минути не се пуска — срокът се вдига до минимума: ' + shortMs);
    const long = await api(`/admin/api/portals/${portalId}/links`, 'POST', { ttlSeconds: 9999999 });
    const longMs = Date.parse(long.data.link.expiresAt) - Date.now();
    assert.ok(longMs <= 86_400_000, 'над 24 часа не се пуска: ' + longMs);
    const badPass = await api(`/admin/api/portals/${portalId}/links`, 'POST', { password: 'ab' });
    assert.equal(badPass.status, 400, 'къса парола се отказва: ' + badPass.status);

    // ── 5. Нивото влиза във връзката: папка и файл водят до СВОИТЕ адреси ──
    // Код, издаден за папка, не бива да отваря корена „ей така“ — иначе „временен QR за папката“
    // е просто втори код на портала.
    const put = async (p, bytes) => {
      const res = await fetch(base + p, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: bytes });
      return res.status;
    };
    assert.equal(
      await put(`/admin/api/portals/${portalId}/tree/upload?path=${encodeURIComponent('/Dogovori/vatreshno.txt')}&mkdir=1`, 'abc'),
      201,
      'файлът се качва',
    );
    const folderLink = await api(`/admin/api/portals/${portalId}/links`, 'POST', { ttlSeconds: 600, rel: 'Dogovori', kind: 'folder' });
    assert.equal(folderLink.status, 201, 'връзката за папка се създава');
    assert.equal(folderLink.data.link.rel, 'Dogovori', 'нивото се пази във връзката');
    const folderHop = await open(folderLink.data.link.url);
    assert.equal(folderHop.status, 302, 'връзката за папка пренасочва');
    const folderTarget = String(folderHop.headers.get('location') || '');
    assert.match(folderTarget, /\/p\/[^?]+\?folder=%2FDogovori&expires=/, 'води към папката с подпис: ' + folderTarget);
    const fileLink = await api(`/admin/api/portals/${portalId}/links`, 'POST', { ttlSeconds: 600, rel: 'Dogovori/vatreshno.txt', kind: 'file' });
    assert.equal(fileLink.status, 201, 'връзката за файл се създава');
    const fileHop = await open(fileLink.data.link.url);
    assert.equal(fileHop.status, 302, 'връзката за файл пренасочва');
    const fileTarget = String(fileHop.headers.get('location') || '');
    assert.match(fileTarget, /\/file\.html:qr-links\/Dogovori\/vatreshno\.txt\?expires=/, 'води към страницата на файла: ' + fileTarget);
    // Опасен път се отказва: `..` не излиза от папката на портала.
    const badRel = await api(`/admin/api/portals/${portalId}/links`, 'POST', { rel: '../../etc/passwd', kind: 'file' });
    assert.equal(badRel.status, 400, 'път с „..“ се отказва: ' + badRel.status);

    // ── 6. Списък и изтриване ─────────────────────────────────────────────
    const list = await api(`/admin/api/portals/${portalId}/links`);
    assert.equal(list.status, 200, 'списъкът се дава');
    assert.equal(list.data.links.length, 7, 'седемте връзки са в списъка: ' + list.data.links.length);
    assert.equal(list.data.links.some((l) => l.passwordHash || l.hash), false, 'списъкът не носи хешове');
    const del = await api(`/admin/api/portals/${portalId}/links/${link.id}`, 'DELETE');
    assert.equal(del.status, 200, 'връзката се трие');
    const gone = await open(link.url);
    assert.equal(gone.status, 404, 'изтритата връзка е 404: ' + gone.status);

    // ── 7. Изтекла връзка: 410 и ясно съобщение ───────────────────────────
    // Срокът не се чака в тест — модулът се вика с портал, чиято връзка вече е изтекла.
    const route = require(path.join(__dirname, '..', 'hapi_enterprise', 'routes', 'portal-links.js'));
    const expiredPortal = {
      id: 'p1',
      slug: 'expired',
      visibility: 'private',
      links: [{ id: 'expiredlink1', portalId: 'p1', expiresAt: new Date(Date.now() - 1000).toISOString(), createdAt: new Date().toISOString() }],
    };
    const deps = {
      json: () => {},
      fail: (res, status) => {
        res.statusCode = status;
      },
      parse: async () => ({}),
      audit: () => {},
      adminGate: () => true,
      resolvePortal: (id) => (id === 'p1' ? expiredPortal : null),
      portals: () => [expiredPortal],
      update: async (fn) => fn(),
      portalAccess: { issue: () => ({ query: '?expires=1&sig=x' }) },
      portalTerm: require(path.join(__dirname, '..', 'hapi_enterprise', 'portal-term.js')),
      baseUrl: () => 'http://x',
      htmlEsc: (v) => String(v),
    };
    const handler = route.create(deps);
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      writeHead(code) {
        this.statusCode = code;
        return this;
      },
      end() {},
    };
    await handler.handle({ req: { headers: {}, on() {} }, res, url: new URL('http://x/x/expiredlink1'), parts: ['x', 'expiredlink1'], method: 'GET' });
    assert.equal(res.statusCode, 410, 'изтеклата връзка е 410, не 404 (казва защо): ' + res.statusCode);
  } finally {
    await stopChild(server.child);
  }
  console.log(
    'PASS qr-share-links: временна връзка · само за четене към спътника · парола (401, 302) · ' +
      'срок в границите · ниво папка/файл · „..“ се отказва · списък и триене · изтекла = 410',
  );
})();
