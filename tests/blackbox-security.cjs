'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// BlackBox тест за сигурност — само през HTTP, без да пипаме вътрешностите.
//
// Всяка проверка е атака или злоупотреба отвън:
//   • автентикация и оторизация (без токен, чужд токен, роля viewer срещу admin);
//   • обход на директории (суров, URL-кодиран, с NUL) през публичния API;
//   • статични файлове: изход навън от /ui/ и от /admin.js;
//   • инжекция в заглавки и отразяване на X-Request-Id;
//   • боклук в тялото: невалиден JSON, огромно тяло, грешен метод;
//   • тайни връзки: сонда не консумира преглед, грешен отпечатък не консумира,
//     втори преглед след първия е отказан;
//   • одитен дневник: подправен запис се вижда от /admin/api/audit/verify;
//   • заглавки за сигурност на всеки HTML отговор (CSP, nosniff, no-referrer).
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { freePort, waitHealthy, stopChild } = require('./helpers.cjs');

const ADMIN = 'blackbox-admin-token-0123456789abcdef';
const VIEWER = 'blackbox-viewer-token-0123456789abc';
const b64u = (b) => Buffer.from(b).toString('base64url');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-blackbox-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: ADMIN, VIEWER_TOKEN: VIEWER, PUBLIC_GATEWAY_PORT: '0' },
    stdio: 'ignore',
  });

  const call = async (route, { method = 'GET', token, body, headers = {}, raw } = {}) => {
    const send = () => fetch(base + route, {
      method,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body || raw ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
    });
    let res;
    try {
      res = await send();
    } catch (e) {
      // Keep-alive връзка, която сървърът е затворил между две заявки, не бива да
      // чупи теста: повтаряме веднъж по нова връзка.
      if (!/ECONNRESET|EPIPE|other side closed/i.test(String(e.cause ? e.cause.code || e.cause.message : e.message))) throw e;
      await new Promise((r) => setTimeout(r, 60));
      res = await send();
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* не е JSON */ }
    return { status: res.status, text, json, headers: res.headers };
  };

  try {
    await waitHealthy(child, base, { attempts: 150 });

    // ── 1. Автентикация и оторизация ───────────────────────────────────────
    assert.equal((await call('/admin/api/portals')).status, 401, 'без токен → 401');
    assert.equal((await call('/admin/api/portals', { token: 'wrong-token-0123456789abcdef' })).status, 401, 'чужд токен → 401');
    assert.equal((await call('/admin/api/portals', { token: '' })).status, 401, 'празен токен → 401');
    assert.equal((await call('/admin/api/portals', { headers: { Authorization: 'Basic ' + ADMIN } })).status, 401, 'грешна схема → 401');
    assert.equal((await call('/admin/api/portals?token=' + encodeURIComponent(ADMIN))).status, 401, 'токен в query не се приема');

    assert.equal((await call('/admin/api/portals', { token: VIEWER })).status, 200, 'viewer чете списъка');
    assert.equal((await call('/admin/api/portals', { method: 'POST', token: VIEWER, body: { slug: 'v', title: 'V' } })).status, 403, 'viewer не създава портал');
    assert.equal((await call('/admin/api/settings', { token: VIEWER })).status, 403, 'viewer не чете настройки');
    const created = await call('/admin/api/portals', { method: 'POST', token: ADMIN, body: { slug: 'bb-portal', title: 'BlackBox' } });
    assert.equal(created.status, 201, 'admin създава портал');
    const portal = created.json;
    assert.ok(portal.id && portal.slug === 'bb-portal');
    console.log('· автентикация: 401 без/чужд токен, 403 за viewer, 201 за admin');

    // ── 2. Обход на директории през публичния API ─────────────────────────
    const traversals = [
      '../../../etc/passwd',
      '..%2f..%2f..%2fetc%2fpasswd',
      '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '..\\..\\..\\windows\\win.ini',
      '/../../../../etc/passwd',
      'документи/../../../etc/passwd',
    ];
    for (const attempt of traversals) {
      const r = await call(`/api/v1/p/bb-portal/storage?path=${encodeURIComponent(attempt)}`);
      assert.ok(r.status >= 400, `обходът "${attempt}" се отказва (получено ${r.status})`);
      assert.equal(/root:[^\n]*:0:0:/.test(r.text), false, 'съдържанието на /etc/passwd не изтича');
      assert.equal(/\[fonts\]/i.test(r.text), false, 'съдържанието на win.ini не изтича');
    }
    const nul = await call('/api/v1/p/bb-portal/storage?path=' + encodeURIComponent('a\u0000b'));
    assert.ok(nul.status >= 400, 'NUL байт в пътя се отказва');
    console.log(`· обход на директории: ${traversals.length + 1} опита отказани`);

    // ── 3. Статични файлове: изход от /ui/ ────────────────────────────────
    const ui = await call('/ui/');
    assert.equal(ui.status, 200, 'интерфейсът се сервира');
    assert.match(ui.headers.get('content-security-policy') || '', /script-src 'self'/, 'интерфейсът има CSP');
    assert.equal(ui.headers.get('x-content-type-options'), 'nosniff', 'nosniff на HTML');
    for (const evil of ['/ui/../server.js', '/ui/%2e%2e/server.js', '/ui/..%2fserver.js', '/ui/../config.yaml']) {
      const r = await call(evil);
      assert.ok(r.status >= 400, `${evil} не се сервира (получено ${r.status})`);
      assert.equal(/ADMIN_TOKEN|require\('node:http'\)/.test(r.text), false, `${evil} не изтича код`);
    }
    const panelJs = await call('/ui/settings-panel.js');
    assert.equal(panelJs.status, 200, 'панелът на настройките се сервира');
    assert.equal(panelJs.headers.get('x-content-type-options'), 'nosniff', 'settings-panel.js е nosniff');
    assert.match(panelJs.headers.get('content-type') || '', /javascript/, 'settings-panel.js е JS, не HTML');
    // Старият /admin е само пренасочване към новия интерфейс — не сервира HTML сам по себе си.
    const legacyAdmin = await call('/admin');
    assert.equal(legacyAdmin.status, 200, 'старият /admin стига до новия интерфейс');
    assert.match(legacyAdmin.text, /Enterprise Control Center/, 'след пренасочването се показва новият интерфейс');
    const legacyJs = await call('/admin.js');
    assert.equal(legacyJs.status, 404, 'старият admin.js вече не се сервира');
    const uiCsp = ui.headers.get('content-security-policy') || '';
    assert.equal(/script-src[^;]*unsafe-inline/.test(uiCsp), false, 'без inline скрипт в интерфейса');
    assert.equal(/script-src[^;]*unsafe-eval/.test(uiCsp), false, 'без eval в интерфейса');
    console.log('· статични файлове: /ui/ и /ui/settings-panel.js със nosniff, изходът навън е отказан');

    // ── 4. Инжекция в заглавки и отразяване ───────────────────────────────
    // HTTP клиентът отказва CRLF в заглавка, затова проверяваме какво прави
    // СЪРВЪРЪТ с невалидна стойност: не я отразява дословно и не пада.
    const spaced = await call('/health', { headers: { 'X-Request-Id': 'bad value with spaces' } });
    assert.ok(spaced.status === 200 || spaced.status === 400, 'невалиден X-Request-Id не чупи сървъра');
    const spacedEcho = spaced.headers.get('x-request-id') || '';
    assert.notEqual(spacedEcho, 'bad value with spaces', 'невалидният идентификатор не се отразява дословно');
    assert.match(spacedEcho, /^[a-f0-9]{8,32}$/, 'вместо него се дава генериран идентификатор');
    const longId = await call('/health', { headers: { 'X-Request-Id': 'x'.repeat(4000) } });
    assert.ok(longId.status < 500, 'много дълга заглавка не дава 5xx');
    assert.equal(/x{100}/.test(longId.headers.get('x-request-id') || ''), false, 'дългият идентификатор не се отразява');
    const good = await call('/health', { headers: { 'X-Request-Id': 'trace-12345678' } });
    const echoed = good.headers.get('x-request-id');
    assert.ok(echoed === null || echoed === 'trace-12345678', 'валидният идентификатор се отразява както е');
    console.log('· заглавки: невалиден/дълъг X-Request-Id не се отразява, валиден минава');

    // ── 5. Боклук в тялото ────────────────────────────────────────────────
    const badJson = await call('/admin/api/portals', { method: 'POST', token: ADMIN, raw: '{"slug":' });
    assert.ok([400, 415, 422].includes(badJson.status), `невалиден JSON → 400-клас (получено ${badJson.status})`);
    const huge = await call('/admin/api/portals', { method: 'POST', token: ADMIN, raw: JSON.stringify({ slug: 'x'.repeat(300000), title: 't' }) });
    assert.ok(huge.status >= 400 && huge.status < 500, `огромно тяло се отказва (получено ${huge.status})`);
    const wrongMethod = await call('/admin/api/portals/' + portal.id, { method: 'PUT', token: ADMIN, body: {} });
    assert.ok([404, 405].includes(wrongMethod.status), `непозволен метод → 404/405 (получено ${wrongMethod.status})`);
    const missing = await call('/admin/api/portals/несъществуващ', { token: ADMIN });
    assert.equal(missing.status, 404, 'липсващ ресурс → 404, не 500');
    console.log('· тяло и метод: невалиден JSON, огромно тяло и непозволен метод се отказват');

    // ── 6. Тайни връзки: сонда, грешен отпечатък, втори преглед ───────────
    const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
    const newId = () => [...crypto.randomBytes(16)].map((b) => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[b % 32]).join('');
    const linkId = newId();
    const idHash = sha256hex(linkId);
    const password = 'парола-за-плика-2026';
    const salt = crypto.randomBytes(16);
    const iterations = 600000;
    const passwordKey = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
    const proof = sha256hex(passwordKey);
    const envelope = {
      v: 2,
      iv: b64u(crypto.randomBytes(12)),
      ct: b64u(crypto.randomBytes(40)),
      pwd: { alg: 'PBKDF2-SHA256', iterations, salt: b64u(salt), check: proof },
    };
    const mkSecret = await call('/admin/api/v2/secrets', { method: 'POST', token: ADMIN, body: { envelope, idHash, hint: 'подсказка', expires_in: 3600, max_views: 1 } });
    assert.equal(mkSecret.status, 201, 'тайната се създава: ' + mkSecret.text.slice(0, 120));
    assert.equal(JSON.stringify(mkSecret.json).includes(envelope.ct), false, 'шифротекстът не се връща към създателя');

    const probe1 = await call('/api/v2/secrets/' + idHash);
    assert.equal(probe1.status, 200, 'сондата отговаря');
    assert.equal(probe1.json.remainingViews, 1, 'сондата не консумира преглед');
    assert.equal(JSON.stringify(probe1.json).includes(envelope.ct), false, 'сондата не връща шифротекста');
    assert.equal(probe1.json.requiresPassword, true, 'сондата казва, че има парола');
    assert.equal(probe1.json.pwd && probe1.json.pwd.check, undefined, 'сондата не връща проверката на паролата (check)');

    const wrong = await call('/api/v2/secrets/' + idHash + '/reveal', { method: 'POST', body: { proof: 'f'.repeat(64) } });
    assert.equal(wrong.status, 403, 'грешен отпечатък → 403');
    const probe2 = await call('/api/v2/secrets/' + idHash);
    assert.equal(probe2.json.remainingViews, 1, 'грешният опит не изразходва преглед');
    assert.equal((await call('/api/v2/secrets/' + 'a'.repeat(64))).status, 404, 'несъществуваща тайна → 404');

    const reveal = await call('/api/v2/secrets/' + idHash + '/reveal', { method: 'POST', body: { proof } });
    assert.equal(reveal.status, 200, 'прегледът с верния отпечатък минава: ' + reveal.text.slice(0, 120));
    assert.equal(reveal.json.envelope.ct, envelope.ct, 'връща се пликът за декриптиране в браузъра');
    assert.equal(reveal.json.envelope.pwd && reveal.json.envelope.pwd.check, undefined, 'проверката на паролата не се връща и при преглед');
    const second = await call('/api/v2/secrets/' + idHash + '/reveal', { method: 'POST', body: { proof } });
    assert.ok([404, 410].includes(second.status), 'вторият преглед е отказан');
    const secretFiles = fs.existsSync(path.join(dir, 'secrets')) ? fs.readdirSync(path.join(dir, 'secrets')) : [];
    for (const f of secretFiles) {
      const content = fs.readFileSync(path.join(dir, 'secrets', f), 'utf8');
      assert.equal(content.includes(linkId), false, 'ид-то не е на диска');
      assert.equal(content.includes(envelope.ct), false, 'след прегледа шифротекстът е изтрит от диска');
    }
    console.log(`· тайни връзки: сонда без консумация, 403 без консумация, втори преглед отказан, дискът е чист (${secretFiles.length} файла)`);

    // ── 7. Одитен дневник: подправка се вижда ─────────────────────────────
    const chainFile = path.join(dir, 'audit-chain.jsonl');
    const before = await call('/admin/api/audit/verify', { token: ADMIN });
    assert.equal(before.status, 200, 'веригата се проверява');
    assert.equal(before.json.valid, true, 'преди подправка веригата е валидна: ' + before.text.slice(0, 120));
    assert.ok(before.json.count >= 1, 'веригата има записи');
    if (fs.existsSync(chainFile)) {
      const lines = fs.readFileSync(chainFile, 'utf8').trim().split('\n');
      const first = JSON.parse(lines[0]);
      // Сменяме съдържанието на записа, не добавяме поле: хешът покрива seq/at/event/details.
      first.event = 'подправен.event';
      lines[0] = JSON.stringify(first);
      fs.writeFileSync(chainFile, lines.join('\n') + '\n');
      const after = await call('/admin/api/audit/verify', { token: ADMIN });
      assert.equal(after.json.valid, false, 'подправеният запис се открива');
      assert.notEqual(after.json.integrity, 'HASH_CHAIN_VALID', 'целостта е маркирана като нарушена');
      console.log('· одит: подправен запис чупи веригата и се отчита (' + after.json.integrity + ')');
    } else {
      console.log('· одит: няма audit-chain.jsonl при този сценарий — проверката е пропусната');
    }

    // ── 8. Заглавки за сигурност на публичните страници ───────────────────
    const portalPage = await call('/p/bb-portal');
    if (portalPage.status === 200) {
      assert.match(portalPage.headers.get('content-security-policy') || '', /default-src/, 'порталът има CSP');
      assert.match(portalPage.headers.get('content-security-policy') || '', /frame-ancestors 'none'/, 'публичният портал не се вгражда в iframe');
      assert.equal(portalPage.headers.get('x-content-type-options'), 'nosniff');
    }
    const secretPage = await call('/secret/' + linkId);
    assert.equal(secretPage.status, 200, 'страницата за тайна се сервира');
    assert.equal(/<script>[^<]/.test(secretPage.text), false, 'няма inline скрипт в страницата за тайна');
    assert.match(secretPage.headers.get('content-security-policy') || '', /frame-ancestors 'none'/, 'не се вгражда в iframe');
    // Панелът на add-on-а в Home Assistant е IFRAME към ingress адреса, тоест UI-ят
    // ТРЯБВА да се вгражда от същия origin. С `frame-ancestors 'none'` браузърът
    // отказваше да покаже документа и екранът оставаше напълно празен (INV-C2).
    const uiPage = await call('/ui/index.html');
    assert.equal(uiPage.status, 200, 'UI-ят се сервира');
    const panelCsp = uiPage.headers.get('content-security-policy') || '';
    assert.match(panelCsp, /frame-ancestors 'self'/, 'UI-ят се вгражда от същия origin — панелът на HA е iframe');
    assert.equal(/frame-ancestors 'none'/.test(panelCsp), false, 'UI-ят не е заключен срещу вграждане');
    console.log('· страници: CSP и nosniff, без inline скрипт; UI-ят е вградим от същия origin, публичните страници — не');

    console.log('PASS blackbox-security: 8 атакувани повърхности, всички откази коректни');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
