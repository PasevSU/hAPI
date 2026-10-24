'use strict';
// Stage D — отрицателни тестове за достъп. Това е гейтът на изданието: тук се доказва
// какво НЕ може да се направи, а не че „общите тестове минават“.
//
// Проверява се:
//   1. токен за портал A не отваря портал B (нито страница, нито API, нито manifest);
//   2. отнемането убива и вече издадените бисквитки — веднага, без да чака срока;
//   3. `read` не дава изтегляне, `download` дава; ZIP иска `read`;
//   4. подписан адрес за файл на A не работи на B;
//   5. бисквитката е `__Host-…; Secure` по HTTPS и обикновена по HTTP;
//   6. потребителска сесия с ACL вижда само своите портали;
//   7. отказите влизат в сензорите, без да изтича токен;
//   8. администраторските функции продължават да работят.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freePort, stopChild } = require('./helpers.cjs');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-tokens-'));
  const port = await freePort(), adminPort = await freePort(), admin = 'stage-d-token-long-enough-1234567';
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PORT: String(adminPort),
      INGRESS_MODE: 'true', ADMIN_TOKEN: admin, REQUIRE_PORTAL_TOKEN: 'true',
    },
    stdio: 'pipe',
  });
  const pubBase = `http://127.0.0.1:${port}`, adminBase = `http://127.0.0.1:${adminPort}`;
  const A = { authorization: 'Bearer ' + admin, 'content-type': 'application/json' };
  const jsonReq = async (base, p, method, body, headers) => {
    const res = await fetch(base + p, { method, headers: headers || A, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { status: res.status, data, headers: res.headers };
  };
  // `redirect: 'manual'`, за да се види самата бисквитка, а не крайната страница.
  const enter = (token, extraHeaders = {}) => fetch(`${pubBase}/t/${encodeURIComponent(token)}`, { redirect: 'manual', headers: extraHeaders });
  const cookieOf = (res) => {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    return raw.join(' | ');
  };
  const nav = (url, cookie) => fetch(pubBase + url, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  const statusOf = async (url, cookie) => { const r = await nav(url, cookie); const body = await r.text(); return { status: r.status, body } };

  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { await fetch(adminBase + '/health'); ready = true; break } catch { await new Promise((r) => setTimeout(r, 40)) }
    }
    assert.ok(ready, 'add-on-ът стартира');

    // ── Подготовка: два частни портала с по един безплатен файл ────────────────
    const portalA = (await jsonReq(adminBase, '/admin/api/portals', 'POST', { slug: 'alpha', title: 'Алфа', visibility: 'private' })).data;
    const portalB = (await jsonReq(adminBase, '/admin/api/portals', 'POST', { slug: 'beta', title: 'Бета', visibility: 'private' })).data;
    assert.ok(portalA.id && portalB.id, 'двата портала са създадени');
    for (const portal of [portalA, portalB]) {
      const up = await fetch(`${adminBase}/admin/api/portals/${portal.id}/files`, {
        method: 'POST', headers: { ...A, 'x-file-name': 'document.txt' }, body: 'съдържание',
      });
      assert.equal(up.status, 201, 'файлът е качен в ' + portal.slug);
    }
    const filesA = (await jsonReq(adminBase, `/admin/api/portals/${portalA.id}/files?limit=10`, 'GET')).data.files;

    // ── 1. Издаване на токен за A (само четене) ───────────────────────────────
    const issued = await jsonReq(adminBase, `/admin/api/portals/${portalA.id}/tokens`, 'POST', { scopes: ['read'], label: 'тест', ttlSeconds: 3600 });
    assert.equal(issued.status, 201, 'токенът е издаден: ' + JSON.stringify(issued.data));
    assert.match(issued.data.token, /^pt_[A-Za-z0-9_-]{20,}$/, 'токенът е криптографски случаен');
    assert.equal(issued.data.scopes.join(','), 'read');
    assert.ok(issued.data.url.endsWith('/t/' + issued.data.token), 'връща се готов адрес за вход');
    const token = issued.data.token;

    // Отпечатъкът е това, което остава в базата — самият токен не се пази.
    const dbDump = fs.readFileSync(path.join(dir, 'db.sqlite')).toString('latin1');
    assert.equal(dbDump.includes(token), false, 'самият токен НЕ се записва в базата');
    const listed = await jsonReq(adminBase, `/admin/api/portals/${portalA.id}/tokens`, 'GET');
    assert.equal(listed.data.tokens.length, 1);
    assert.equal(JSON.stringify(listed.data).includes(token), false, 'списъкът не връща токена');

    // ── 2. Вход по токен: бисквитка + пренасочване към СВОЯ портал ────────────
    const entered = await enter(token);
    assert.equal(entered.status, 302, 'входът по токен пренасочва');
    assert.ok(String(entered.headers.get('location') || '').endsWith('/p/' + portalA.id), 'пренасочва към портала на токена');
    const setCookie = cookieOf(entered);
    assert.match(setCookie, /^hapi_session=/, 'по HTTP бисквитката е с обикновено име (Secure би я скрил)');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Max-Age=600/, 'сесията е краткотрайна (10 мин)');
    const cookie = setCookie.split(';')[0];

    // ── 3. Изолация: A се отваря, B — не ─────────────────────────────────────
    assert.equal((await statusOf('/p/' + portalA.id, cookie)).status, 200, 'своят портал се отваря');
    assert.equal((await statusOf('/api/v1/p/alpha', cookie)).status, 200, 'API-то на своя портал работи');
    for (const url of ['/p/' + portalB.id, '/api/v1/p/beta', '/api/v1/p/beta/manifest', '/portal.html?folder=beta']) {
      const res = await statusOf(url, cookie);
      assert.equal(res.status, 404, 'токен за A НЕ отваря ' + url);
      assert.equal(res.body.includes('Бета'), false, 'съдържанието на чуждия портал не изтича: ' + url);
    }

    // ── 4. Скоупи: read не сваля, download сваля ─────────────────────────────
    const fileA = filesA[0];
    assert.ok(fileA, 'има файл в A');
    assert.equal((await statusOf(`/api/v1/p/alpha/files/${fileA.id}/download`, cookie)).status, 404, 'read НЕ дава изтегляне');
    const downloaded = await jsonReq(adminBase, `/admin/api/portals/${portalA.id}/tokens`, 'POST', { scopes: ['read', 'download'], ttlSeconds: 600 });
    const dlEnter = await enter(downloaded.data.token);
    const dlCookie = cookieOf(dlEnter).split(';')[0];
    const dl = await nav(`/api/v1/p/alpha/files/${fileA.id}/download`, dlCookie);
    assert.equal(dl.status, 200, 'download дава файла');
    assert.equal(await dl.text(), 'съдържание');

    // ZIP пакетът иска `read` (строи се от съдържанието, не е изтегляне на един файл).
    const packRead = await fetch(`${pubBase}/api/v1/p/alpha/package`, { method: 'POST', headers: { cookie } });
    assert.equal(packRead.status, 201, 'read стига за ZIP пакет: ' + packRead.status);
    const packBody = await packRead.json();
    assert.ok(packBody.package && packBody.download && packBody.download.url, 'пакетът връща еднократен адрес');
    const packDl = await nav(packBody.download.url, cookie);
    assert.equal(packDl.status, 200, 'пакетът се сваля с бисквитката');
    await packDl.arrayBuffer();

    // ── 5. Отнемане: и бисквитките спират веднага ────────────────────────────
    const revoked = await jsonReq(adminBase, `/admin/api/portals/${portalA.id}/tokens/${issued.data.id}`, 'DELETE');
    assert.equal(revoked.status, 200, 'токенът е отнет');
    assert.equal((await statusOf('/p/' + portalA.id, cookie)).status, 404, 'старата бисквитка спира ВЕДНАГА след отнемане');
    assert.equal((await enter(token)).status, 404, 'старият токен не се приема повторно');

    // ── 6. HTTPS: `__Host-` префикс + Secure ─────────────────────────────────
    const second = await jsonReq(adminBase, `/admin/api/portals/${portalA.id}/tokens`, 'POST', { scopes: ['read'], ttlSeconds: 600 });
    const secureEntry = await enter(second.data.token, { 'x-forwarded-proto': 'https' });
    const secureCookie = cookieOf(secureEntry);
    assert.match(secureCookie, /^__Host-hapi_session=/, 'по HTTPS се ползва `__Host-` името');
    assert.match(secureCookie, /Secure/, 'по HTTPS бисквитката е Secure');
    assert.match(secureCookie, /Path=\//, '`__Host-` изисква Path=/');
    assert.equal(/Domain=/i.test(secureCookie), false, '`__Host-` забранява Domain');

    // ── 7. Подписани URL-и: при `require_portal_token` са ИЗКЛЮЧЕНИ, иначе работят само за своя ресурс
    const signed = await jsonReq(adminBase, `/admin/api/portals/${portalA.id}/files/${fileA.id}/signed-url`, 'POST', { ttlSeconds: 300 });
    assert.equal(signed.status, 201, 'подписаният адрес е издаден: ' + JSON.stringify(signed.data));
    // `require_portal_token` има предимство пред подписа — същото правило като при файловете.
    // Това е важно: иначе подписът би бил втори, по-слаб вход към портала.
    assert.equal((await nav(signed.data.path)).status, 404, 'при require_portal_token подписан адрес не отваря');

    // ── 8. Потребителска сесия + ACL по портали ─────────────────────────────
    await jsonReq(adminBase, '/admin/api/users', 'POST', { username: 'worker', password: 'worker-pass-123', scopes: ['read', 'download'] });
    const login = await jsonReq(pubBase, '/api/v1/auth/login', 'POST', { username: 'worker', password: 'worker-pass-123' }, { 'content-type': 'application/json' });
    const userToken = login.data.token;
    const asUser = (url) => statusOf(url + (url.includes('?') ? '&' : '?') + 'portal_token=' + encodeURIComponent(userToken));
    assert.equal((await asUser('/p/alpha')).status, 200, 'без ACL потребителят вижда порталите (старо поведение)');
    assert.equal((await asUser('/p/beta')).status, 200);
    const acl = await jsonReq(adminBase, `/admin/api/portals/${portalB.id}/acl`, 'PUT', { usernames: ['worker'] });
    assert.equal(acl.status, 200, 'ACL е записан');
    assert.deepEqual(acl.data.usernames, ['worker']);
    assert.equal((await asUser('/p/beta')).status, 200, 'с ACL за B порталът се отваря');
    assert.equal((await asUser('/p/alpha')).status, 404, 'с ACL само за B другият портал е затворен');

    // ── 9. Сензори: отказите се броят, без да изтича токен ───────────────────
    const sensors = await jsonReq(adminBase, '/admin/api/sensors', 'GET');
    assert.equal(sensors.status, 200);
    const security = sensors.data.security;
    assert.ok(security, 'сензорите носят `security`');
    assert.ok(security.denied.crossPortal >= 1, 'отказът между портали е отчетен: ' + JSON.stringify(security.denied));
    assert.ok(security.denied.revokedRefused >= 1, 'опитът с отнет токен е отчетен');
    assert.ok(typeof security.activePortalSessions === 'number', 'броят живи сесии се вижда');
    assert.equal(JSON.stringify(sensors.data).includes(token), false, 'сензорите не изтичат токена');
    assert.equal(JSON.stringify(sensors.data).includes(userToken), false, 'сензорите не изтичат потребителската сесия');

    // ── 10. Администраторът не е засегнат ────────────────────────────────────
    assert.equal((await jsonReq(adminBase, '/admin/api/portals', 'GET')).status, 200, 'админ списъкът работи');
    assert.equal((await jsonReq(adminBase, '/admin/api/whoami', 'GET')).status, 200, 'админ самоличността работи');
    // Публичният listener НЕ сервира админ API — независимо от токена (изолация на ingress-а).
    // (На loopback админ listener-ът приема и без токен: това е „този, който е инсталирал
    // add-on-а“. Затова тук се проверява публичната страна, а не 401.)
    const publicAdmin = await fetch(`${pubBase}/admin/api/portals`);
    assert.equal(publicAdmin.status, 404, 'публичният listener не отваря админ API');

    // ── 11. Без `require_portal_token`: подписът стига САМО до своя ресурс ─────
    {
      const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-tokens-open-'));
      const port2 = await freePort(), adminPort2 = await freePort();
      const base2 = `http://127.0.0.1:${port2}`, admin2 = `http://127.0.0.1:${adminPort2}`;
      const child2 = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
        env: {
          ...process.env, DATA_DIR: dir2, PORT: String(port2), ADMIN_PORT: String(adminPort2),
          INGRESS_MODE: 'true', ADMIN_TOKEN: admin, REQUIRE_PORTAL_TOKEN: 'false',
        },
        stdio: 'pipe',
      });
      try {
        let up = false;
        for (let i = 0; i < 120; i++) {
          try { await fetch(admin2 + '/health'); up = true; break } catch { await new Promise((r) => setTimeout(r, 40)) }
        }
        assert.ok(up, 'втората инстанция стартира');
        const makePortal = async (slug, title) => (await jsonReq(admin2, '/admin/api/portals', 'POST', { slug, title, visibility: 'private' })).data;
        const one = await makePortal('one', 'Едно'), two = await makePortal('two', 'Две');
        for (const portal of [one, two]) {
          const up2 = await fetch(`${admin2}/admin/api/portals/${portal.id}/files`, {
            method: 'POST', headers: { ...A, 'x-file-name': 'f.txt' }, body: 'данни',
          });
          assert.equal(up2.status, 201, 'файл в ' + portal.slug);
        }
        const filesOne = (await jsonReq(admin2, `/admin/api/portals/${one.id}/files?limit=10`, 'GET')).data.files;
        const sig = await jsonReq(admin2, `/admin/api/portals/${one.id}/files/${filesOne[0].id}/signed-url`, 'POST', { ttlSeconds: 300 });
        assert.equal(sig.status, 201, 'подписът е издаден');
        const good = await fetch(base2 + sig.data.path);
        assert.equal(good.status, 200, 'без require_portal_token подписът отваря своя файл');
        await good.arrayBuffer();
        const cross = await fetch(base2 + String(sig.data.path).replace('/p/one/', '/p/two/'));
        assert.equal(cross.status, 404, 'същият подпис не работи на друг портал');
        const tampered = await fetch(base2 + String(sig.data.path).replace(/sig=[a-f0-9]{8}/, 'sig=00000000'));
        assert.equal(tampered.status, 404, 'подправен подпис не минава');
      } finally {
        await stopChild(child2);
        fs.rmSync(dir2, { recursive: true, force: true });
      }
    }

    console.log('portal-tokens OK: изолация A↔B · отнемане убива бисквитки · read≠download · ZIP · подписан адрес · __Host- по HTTPS · ACL · сензори без изтичане');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1) });
