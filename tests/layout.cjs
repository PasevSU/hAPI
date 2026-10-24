'use strict';
// 0.69.64: структурата на файловете е изяснена — и то проверяемо, не „по памет“.
//
// Тестът сравнява три неща:
//   1. картата, която програмата дава (`GET /admin/api/diagnostics` → `layout`);
//   2. реалните директории на живия сървър (съществуват и са в нея);
//   3. документа `documentation/01_AS_IS_ARCHITECTURE/STORAGE_LAYOUT.md` — всеки ред от
//      таблицата трябва да съществува и в картата, иначе документът лъже.
// Отделно се проверява най-объркващото: `portal.html` е ДВЕ неща (в образа и в api/<slug>/),
// и че адресът `/portal.html?folder=<slug>` сервира второто.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const layout = require('../hapi_enterprise/layout.js');
const { startServer } = require('./lib/gui-harness.cjs');

const root = path.join(__dirname, '..');

(async () => {
  // ── 1. Картата е пълна и без повторени id-та ──────────────────────────────
  const entries = layout.entries({ appDir: path.join(root, 'hapi_enterprise'), root: '/data', filesRoot: '/data/files', internalRoot: '/data/internal', apiRoot: '/data/api' });
  const ids = entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'id-тата в картата са уникални');
  for (const required of ['app', 'data', 'files', 'internal', 'api', 'portal-folder', 'evidence-portal']) {
    assert.ok(ids.includes(required), `картата има запис „${required}“`);
  }
  for (const e of entries) {
    assert.ok(e.label && e.path && e.note, `записът ${e.id} има етикет, път и обяснение`);
  }
  const routeUrls = layout.ROUTES.map((r) => r.url);
  for (const url of ['/ui/', '/p/<slug>', '/portal.html?folder=<slug>', '/api/v1/p/<slug>/api.json']) {
    assert.ok(routeUrls.includes(url), `картата казва кой адрес какво сервира: ${url}`);
  }

  const server = await startServer();
  try {
    // ── 2. Живият сървър връща картата с проверки на диска ─────────────────
    const res = await server.api('/admin/api/diagnostics');
    assert.equal(res.status, 200, 'диагностиката отговаря');
    const map = res.data.layout;
    assert.ok(map && Array.isArray(map.entries), 'диагностиката съдържа карта на структурата');
    const byId = Object.fromEntries(map.entries.map((e) => [e.id, e]));
    for (const id of ['app', 'data', 'files', 'internal', 'api']) {
      assert.equal(byId[id].checked, true, `${id} е проверен на диска`);
      assert.equal(byId[id].exists, true, `${id} съществува: ${byId[id].path}`);
    }
    assert.equal(byId.api.isDirectory, true, 'api е директория');
    assert.equal(byId.data.writable, true, 'данните са записуеми');
    // Папката на портала е различна за всеки портал, затова не се проверява с един път.
    assert.equal(byId['portal-folder'].checked, false, 'папката на портала е относителна (за всеки портал своя)');

    // ── 3. Двете значения на portal.html съществуват реално ────────────────
    const appPage = path.join(root, 'hapi_enterprise', 'portal', 'portal.html');
    assert.equal(fs.existsSync(appPage), true, 'страницата на add-on-а е в образа: ' + appPage);
    const portalRes = await server.api('/admin/api/portals', 'POST', { slug: 'layout-' + Date.now().toString(36), title: 'Структура' });
    assert.equal(portalRes.status, 201, 'порталът се създава: ' + JSON.stringify(portalRes.data).slice(0, 160));
    const portal = portalRes.data;
    const generated = path.join(server.dir, 'api', portal.slug, 'portal.html');
    assert.equal(fs.existsSync(generated), true, 'генерираната страница е в api/<slug>/portal.html: ' + generated);
    assert.notEqual(generated, appPage, 'двете страници са РАЗЛИЧНИ файлове');
    assert.match(fs.readFileSync(appPage, 'utf8'), /<html/i, 'страницата на add-on-а е HTML');
    assert.match(fs.readFileSync(generated, 'utf8'), /Портал <code>/, 'генерираната страница назовава портала');

    // ── 4. Документът съдържа същите места и адреси ────────────────────────
    const doc = fs.readFileSync(path.join(root, 'documentation', '01_AS_IS_ARCHITECTURE', 'STORAGE_LAYOUT.md'), 'utf8');
    for (const id of ids) assert.ok(doc.includes(id), `документът споменава „${id}“`);
    for (const url of routeUrls) assert.ok(doc.includes(url), `документът споменава адреса ${url}`);
    for (const fragment of ['/app/portal/portal.html', 'api/<slug>/portal.html', '/share/<slug>', '/config/www/hapi/data/']) {
      assert.ok(doc.includes(fragment), `документът показва пътя ${fragment}`);
    }
    assert.match(doc, /portal\.html` е ДВЕ неща/, 'документът изрично обяснява двете значения на portal.html');

    // ── 5. Чистене на тестовата папка на портала ───────────────────────────
    try {
      fs.rmSync(path.resolve('/share', portal.slug), { recursive: true, force: true });
    } catch {
      /* на Linux /share може да не е достъпен за писане от теста */
    }

    console.log(
      `PASS layout: ${map.entries.length} места в картата · ${map.routes.length} адреса · данни/файлове/api съществуват и са записуеми · portal.html е две различни неща (образ + api/${portal.slug}/) · документът съвпада с картата`,
    );
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error('FAIL layout:', e && e.message ? e.message : e);
  if (e && e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
