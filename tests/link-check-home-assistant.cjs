'use strict';
// `POST /admin/api/links/check` казва причината, но най-честият случай изглеждаше като
// „страницата не съществува“: на публичния адрес отговаря САМИЯТ Home Assistant (неговият API
// изглед връща `404: Not Found`) вместо hAPI. Човек вижда 404 и не разбира, че пътят просто не е
// проксиран към add-on-а.
//
// Проверката тук е на ниво маршрут: `handle()` се вика с фалшиви `req`/`res`, а двата сървъра са
// истински — единият отговаря точно като aiohttp на HA, другият с обикновено 404.
const assert = require('node:assert/strict');
const http = require('node:http');

const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

(async () => {
  const ha = await listen((req, res) => {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404: Not Found');
  });
  const plain = await listen((req, res) => {
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<h1>Not here</h1>');
  });

  const state = { target: '' };
  let captured = null;
  // Отделна инстанция на маршрута за всеки проверяван хост: правилото „само свои адреси“
  // пуска само обявения публичен базов адрес, а тук всеки случай има свой собствен.
  const build = (base) => require('../hapi_enterprise/routes/link-check').create({
    json: (res, status, body) => { captured = { status, body }; },
    fail: (res, status, body) => { captured = { status, ...body, failed: true }; },
    parse: async () => ({ url: state.target }),
    audit: () => { },
    adminGate: () => true,
    baseUrl: () => base,
    publicBaseUrl: () => base,
  });

  const check = async (routes, target) => {
    state.target = target;
    captured = null;
    const handled = await routes.handle({
      req: {}, res: {}, url: new URL('http://127.0.0.1:8123/admin/api/links/check'), method: 'POST',
    });
    assert.notEqual(handled, false, 'маршрутът поема заявката');
    assert.ok(captured, 'има отговор');
    assert.equal(captured.status, 200, 'проверката отговаря с 200 и резултат: ' + JSON.stringify(captured));
    return captured.body;
  };

  try {
    // 1. Отговорът на Home Assistant се разпознава и се казва какво да се направи.
    const fromHa = await check(build(`http://127.0.0.1:${ha.port}`), `http://127.0.0.1:${ha.port}/api/v1/p/demo`);
    assert.equal(fromHa.ok, false, 'адресът не е ok');
    assert.equal(fromHa.status, 404, 'статусът е 404');
    assert.match(fromHa.reason, /Home Assistant/, 'причината казва кой отговаря: ' + fromHa.reason);
    assert.ok(fromHa.hint && fromHa.hint.length > 10, 'има подсказка какво да се направи');
    assert.match(fromHa.hint, /интеграцията|reverse proxy/, 'подсказката сочи решение');

    // 2. Обикновен 404 НЕ получава тази подсказка — иначе съобщението би лъжaло.
    const plain404 = await check(build(`http://127.0.0.1:${plain.port}`), `http://127.0.0.1:${plain.port}/api/v1/p/demo`);
    assert.equal(plain404.ok, false, 'обикновеният 404 също не е ok');
    assert.equal(plain404.hint, '', 'без подсказка за Home Assistant при чуждо тяло');
    assert.doesNotMatch(plain404.reason, /Home Assistant/, 'причината не споменава HA: ' + plain404.reason);

    console.log('link-check-home-assistant OK: 404 от HA → точна причина + подсказка · обикновен 404 → без подсказка');
  } finally {
    ha.server.close();
    plain.server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
