'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const csp = require('../hapi_enterprise/site-csp.js');
const { startServer } = require('./lib/gui-harness.cjs');
// §HTML_IN_SANDBOX (§7 от HAPI-ARCH-API-001): недовереният HTML проект НЕ бива да живее в
// същия origin като админ API-то. Досега имаше само `script-src 'self'` — тоест страница от
// `/site/…` можеше да извика `/admin/api/...` с бисквитките на посетителя.
//
// Проверява се това, което СПЕЦИФИКАЦИЯТА иска, а не „има заглавка“:
//   • `sandbox` БЕЗ `allow-same-origin` → непрозрачен origin: няма бисквитки и сесия;
//   • `connect-src 'none'` → няма fetch/XHR/WebSocket към нас;
//   • ресурсите (.css/.js) остават обичайната статика, за да не се чупят проектите;
//   • пътят не излиза от папката на проекта (realpath), както досега.
const shareRoot = path.resolve('/share');
const HTML = '<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>Проект</title>'
  + '<link rel="stylesheet" href="./style.css"></head><body><h1>Здравей</h1>'
  + '<script src="./app.js"></script><script>fetch("/admin/api/portals")</script></body></html>';

(async () => {
  const cspUnit = [
    ['документ получава пясъчник', () => {
      const value = csp.forFile('.html', 'http://127.0.0.1:8123');
      assert.match(value, /^sandbox /, 'политиката започва със sandbox');
      assert.equal(/allow-same-origin/.test(value), false, 'allow-same-origin НЕ се дава (иначе пясъчникът не пази нищо)');
      assert.match(value, /allow-scripts/, 'скриптовете на самия проект работят');
      assert.match(value, /connect-src 'none'/, 'няма мрежови заявки към нас');
      assert.match(value, /script-src http:\/\/127\.0\.0\.1:8123/, 'ресурсите са от ТОЧНИЯ origin (не \'self\' — при непрозрачен origin не съвпада)');
    }],
    ['ресурс не получава пясъчник', () => {
      const value = csp.forFile('.css', 'http://x');
      assert.equal(/sandbox/.test(value), false, 'CSS не се пясъчни');
      assert.match(value, /default-src 'self'/, 'статиката остава както преди, за да не се чупят проектите');
    }],
    ['разширението решава', () => {
      assert.equal(csp.isDocument('.htm'), true);
      assert.equal(csp.isDocument('.HTML'.toLowerCase()), true);
      assert.equal(csp.isDocument('.js'), false);
    }],
  ];
  for (const [name, run] of cspUnit) { run(); void name }

  const server = await startServer();
  const slug = 'html-sandbox-' + Date.now().toString(36);
  try {
    const call = async (route, method = 'GET', bodyJson) => {
      const res = await server.authFetch(server.base + route, {
        method,
        headers: bodyJson === undefined ? {} : { 'content-type': 'application/json' },
        body: bodyJson === undefined ? undefined : JSON.stringify(bodyJson),
      });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      return { status: res.status, data, headers: res.headers, text };
    };

    const portal = await call('/admin/api/portals', 'POST', { slug, title: 'HTML пясъчник', visibility: 'public' });
    assert.equal(portal.status, 201, 'порталът се създава');
    const portalId = portal.data.id;
    const folder = path.join(server.dir, 'html-projects', slug + '-site');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'index.html'), HTML);
    fs.writeFileSync(path.join(folder, 'style.css'), 'body{font-family:sans-serif}');
    fs.writeFileSync(path.join(folder, 'app.js'), 'console.log("ok")');
    const registered = await call(`/admin/api/portals/${portalId}/html-projects`, 'POST', { title: 'Проект', folder: slug + '-site' });
    assert.ok([200, 201].includes(registered.status), 'проектът се регистрира: ' + JSON.stringify(registered.data).slice(0, 200));

    const base = `/site/${slug}/${registered.data.id}`;
    const page = await call(base + '/');
    assert.equal(page.status, 200, 'страницата се сервира: ' + page.text.slice(0, 120));
    const policy = page.headers.get('content-security-policy') || '';
    assert.match(policy, /^sandbox /, 'HTML-ът върви с sandbox: ' + policy.slice(0, 80));
    assert.equal(/allow-same-origin/.test(policy), false, 'без allow-same-origin — няма бисквитки и сесия');
    assert.match(policy, /connect-src 'none'/, 'няма fetch/XHR към админ API-то');
    assert.match(policy, /frame-ancestors 'none'/, 'не се вгражда');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');

    const css = await call(base + '/style.css');
    assert.equal(css.status, 200, 'стиловете се сервират');
    assert.equal(/sandbox/.test(css.headers.get('content-security-policy') || ''), false, 'ресурсите не се пясъчнят');

    for (const evil of ['/../server.js', '/%2e%2e/server.js', '/../../etc/passwd']) {
      const res = await call(base + evil);
      assert.ok(res.status >= 400, 'изход от папката на проекта се отказва: ' + evil + ' → ' + res.status);
    }

    console.log('HTML_IN_SANDBOX OK: ' + csp.CODE + ' · sandbox без allow-same-origin · connect-src none · ресурсите остават статика · изходът от папката → 4xx');
  } finally {
    fs.rmSync(path.join(server.dir, 'html-projects', slug + '-site'), { recursive: true, force: true });
    fs.rmSync(path.join(shareRoot, slug), { recursive: true, force: true });
    if (server.stop) await server.stop();
  }
})().catch((e) => { console.error(e); process.exit(1) });
