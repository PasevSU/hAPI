'use strict';
// ЧАСТИЧНА СТРАНИЦА НЕ БИВА ДА ЧУПИ СКРИПТА (0.69.209).
//
// Защо има тест: `portal.js` се слага на няколко вида страници (портала, файла, отказа
// „частен портал без токен“, 410 „закрит“). Намери се истинска грешка:
//   TypeError: Cannot set properties of null (setting 'textContent') at setStatus
// — тоест при липсващ `#status` целият скрипт падаше, вместо просто да не прави нищо.
// Тестът пази две неща:
//   1. реалната страница за частен портал без токен се зарежда без изключение;
//   2. минимална страница (без #status, #title, #q) също минава без изключение.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const { createDocument } = require('./lib/dom-stub.cjs');

/** Монтира portal.js върху подадения HTML и връща грешките (хвърлени и логнати). */
async function mount(base, pagePath, bodyHtml) {
  const errors = [];
  const location = {
    protocol: 'http:', origin: base, host: '127.0.0.1', pathname: pagePath,
    search: '', hash: '', href: base + pagePath, toString: () => base + pagePath,
  };
  const doc = createDocument({ lang: 'bg' });
  doc.body.innerHTML = bodyHtml;
  const sandbox = {
    document: doc,
    location,
    isSecureContext: true,
    console: { log() { }, warn() { }, error: (...a) => errors.push(a.join(' ')) },
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, TextEncoder, TextDecoder,
    Blob: class { constructor(parts) { this.parts = parts; this.size = 0 } },
    crypto: require('node:crypto').webcrypto,
    navigator: { clipboard: { writeText: async () => { } } },
    fetch: (url, init) => fetch(typeof url === 'string' && url.startsWith('/') ? base + url : url, init),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(await (await fetch(base + '/portal-i18n.js')).text(), sandbox, { filename: 'portal-i18n.js' });
  try {
    vm.runInContext(await (await fetch(base + '/portal.js')).text(), sandbox, { filename: 'portal.js' });
  } catch (e) {
    errors.push('ХВЪРЛЕНО: ' + e.message);
  }
  await new Promise((r) => setTimeout(r, 800));
  return { doc, errors };
}

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
    return { status: res.status, data: await res.text() };
  };

  // ── 1. Частен портал, отворен БЕЗ токен: страницата не е порталът ────────────
  const made = await api('/admin/api/portals', 'POST', { slug: 'partial', title: 'Частен', visibility: 'private' });
  assert.equal(made.status, 201, 'порталът се създава');
  const page = await fetch(base + '/p/partial');
  const html = await page.text();
  assert.ok(page.status === 404 || page.status === 410 || page.status === 401, 'без токен частният портал не се отдава: ' + page.status);
  const bodyHtml = html.includes('<body>') ? html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')) : html;
  const real = await mount(base, '/p/partial', bodyHtml);
  assert.deepEqual(real.errors, [], 'страницата на отказа се зарежда без изключение: ' + real.errors.join(' | '));

  // ── 2. Минимална страница: нито #status, нито #title, нито #q ────────────────
  const minimal = await mount(base, '/p/partial', '<div id="hapi-boot" data-base="" data-api="/api/v1/p/partial" data-folder="" data-folders="0" data-qr=""></div>');
  assert.deepEqual(minimal.errors, [], 'липсващите възли не чупят скрипта: ' + minimal.errors.join(' | '));
  assert.ok(!minimal.doc.getElementById('status'), 'в тази страница #status наистина липсва');

  // ── 3. Същият договор за интеграционния вариант (другият portal.js) ──────────
  const integration = path.join(__dirname, '..', 'custom_components', 'hapi_enterprise', 'portal.js');
  const errs = [];
  const sandbox = {
    document: createDocument({ lang: 'bg' }),
    location: { protocol: 'http:', origin: base, pathname: '/p/partial', search: '', hash: '', href: base + '/p/partial', toString: () => base + '/p/partial' },
    isSecureContext: true,
    console: { log() { }, warn() { }, error: (...a) => errs.push(a.join(' ')) },
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, TextEncoder, TextDecoder,
    crypto: require('node:crypto').webcrypto,
    navigator: { clipboard: { writeText: async () => { } } },
    fetch: (url, init) => fetch(typeof url === 'string' && url.startsWith('/') ? base + url : url, init),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(fs.readFileSync(integration, 'utf8'), sandbox, { filename: 'portal-integration.js' });
  } catch (e) {
    errs.push('ХВЪРЛЕНО: ' + e.message);
  }
  await new Promise((r) => setTimeout(r, 800));
  assert.deepEqual(errs, [], 'интеграционният вариант също не пада на частична страница: ' + errs.join(' | '));

  await server.stop();
  console.log('PASS portal-partial-page: отказ без токен и минимална страница се зареждат без TypeError');
})().catch((e) => {
  console.error('FAIL portal-partial-page:', e && e.message);
  process.exit(1);
});
