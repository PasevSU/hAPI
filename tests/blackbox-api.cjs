'use strict';
// ЧЕРНОКУТИЙНИ ТЕСТОВЕ (0.69.208): системата се съди САМО по онова, което се вижда отвън.
//
// Разликата с останалите тестове: тук НЕ се чете код и НЕ се викат вътрешни функции. Пуска се
// истинският сървър и се говори само по HTTP — както говори браузърът, HA Supervisor или
// интегратор. Затова тези проверки хващат неща, които вътрешните тестове пропускат: различен
// код на грешка, изтекла вътрешна информация в отговора, разминаване между обявен и реален
// маршрут.
//
// Проверките са договор, не „има отговор“:
//   1. `/health` отговаря 200 и НЕ разкрива вътрешности (пътища, версии на модули, токени);
//   2. административният API без токен е 401, а не 200 и не 500;
//   3. всеки отговор за грешка е JSON с `ok: false` и текст — без HTML и без стек;
//   4. публичната страница на портал се отваря без токен, а административните — не;
//   5. несъществуващ маршрут е 404 (не 500) и не издава файловата система;
//   6. обявеният API (`/admin/api` + `/api/v1`) отговаря с обявеното съдържание за празна база.
const assert = require('node:assert/strict');
const { startServer } = require('./lib/gui-harness.cjs');

const json = async (res) => ({ status: res.status, type: String(res.headers.get('content-type') || ''), body: await res.text() });

(async () => {
  const server = await startServer({ keepData: true });
  try {
    // ── 1. /health: жив, но не издава вътрешности ─────────────────────────────
    const health = await json(await fetch(server.base + '/health'));
    assert.equal(health.status, 200, '/health отговаря 200');
    assert.match(health.type, /application\/json/, '/health е JSON');
    const healthBody = JSON.parse(health.body);
    assert.equal(typeof healthBody, 'object', '/health връща обект');
    // Никакви пътища и тайни в отговора: това е публичен маршрут.
    assert.equal(/[A-Za-z]:\\|\/(?:home|data|share|media)\//.test(health.body), false, '/health не показва файлови пътища: ' + health.body.slice(0, 160));
    assert.equal(/gh[pousr]_|sk-|BEGIN [A-Z ]*PRIVATE KEY/.test(health.body), false, '/health не показва тайни');

    // ── 2. Административният API иска токен и не е 500 ────────────────────────
    const anonymous = await json(await fetch(server.base + '/admin/api/portals'));
    assert.equal(anonymous.status, 401, 'без токен административният API е 401, а не ' + anonymous.status);
    const anonBody = JSON.parse(anonymous.body);
    assert.equal(anonBody.ok, false, 'отказът е ok:false');
    assert.equal(/at [A-Za-z]:\\|\/app\//.test(anonymous.body), false, 'отказът не показва стек или път');

    // ── 3. Грешките са JSON с текст, не HTML и не 500 ─────────────────────────
    for (const probe of ['/admin/api/nope', '/api/v1/nope', '/ui/nope.js']) {
      const res = await json(await fetch(server.base + probe));
      assert.equal([401, 404].includes(res.status), true, probe + ' → ' + res.status + ' (очаква се 401/404, не 500)');
      assert.match(res.type, /application\/json/, probe + ' отговаря с JSON, не с HTML');
      const body = JSON.parse(res.body);
      assert.equal(body.ok, false, probe + ': грешката е ok:false');
      assert.ok(String(body.error || body.message || '').trim(), probe + ': грешката има съобщение');
      assert.equal(/\/app\/|[A-Za-z]:\\/.test(res.body), false, probe + ': отговорът не показва път до файл');
    }

    // ── 4. Публичното е публично, административното — не ─────────────────────
    const portal = await server.api('/admin/api/portals', 'POST', { slug: 'blackbox-portal', title: 'Черна кутия', visibility: 'public' });
    assert.equal(portal.status, 201, 'порталът се създава през API: ' + JSON.stringify(portal.data).slice(0, 160));
    const publicPage = await fetch(server.base + '/api/v1/p/blackbox-portal');
    assert.equal(publicPage.status, 200, 'публичната страница се отваря БЕЗ токен');
    const treeAnonymous = await fetch(server.base + '/admin/api/portals');
    assert.equal(treeAnonymous.status, 401, 'а административният списък не се отваря без токен');

    // ── 5. Обявеното съдържание на API-то е реално ────────────────────────────
    const spec = await server.api('/admin/api/openapi.json');
    assert.equal(spec.status, 200, 'спецификацията на API-то се дава с токен');
    const paths = Object.keys((spec.data && (spec.data.paths || spec.data.routes)) || {});
    assert.ok(paths.length >= 20, 'спецификацията изрежда поне 20 маршрута: ' + paths.length);
    assert.ok(paths.some((p) => p.startsWith('/admin/api/')), 'в спецификацията има административни маршрути');

    console.log('blackbox: /health чисто · 401 без токен · грешките са JSON без стек · публичното е публично · спецификацията изрежда ' + paths.length + ' маршрута');
  } finally {
    await server.stop();
  }
})()
  .then(() => console.log('PASS blackbox-api: договорът се вижда отвън — кодове, форми на грешка и липса на вътрешности в отговорите'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
