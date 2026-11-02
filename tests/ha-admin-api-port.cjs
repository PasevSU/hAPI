'use strict';
// 0.69.96 — Home Assistant ТРЯБВА да може да стигне до админ API-то, иначе интеграцията е
// неработеща по определение: сензорите ѝ се хранят от `/admin/api/sensors`.
//
// Проблемът, който този тест заключва: в add-on режим (`INGRESS_MODE=true`) admin пътищата се
// сервират САМО на ingress listener-а (8098), а той приема само Supervisor и loopback. Home
// Assistant не е нито едно от двете, тоест:
//   • на 8098 → 403 (peer не е в allowlist-а);
//   • на публичния порт → 404 (админ пътищата са забранени там).
// Резултатът беше „интеграцията се инсталира и не работи“ — точно това, което човек нарича
// „не е съвместимо с Home Assistant“.
//
// Правилото сега: програмен клиент с Bearer токен минава и на публичния порт, защото токенът е
// самоличността и RBAC го проверява на всеки маршрут. Без токен админ пътищата остават 404 —
// браузърната повърхност не се отваря.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const root = path.join(__dirname, '..');
const freePort = () => new Promise((resolve) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

(async () => {
  const adminPort = await freePort();
  const server = await startServer({ env: { INGRESS_MODE: 'true', ADMIN_PORT: String(adminPort) } });
  try {
    const call = (url, headers) => fetch(url, { headers });

    // 1. Без токен публичният порт НЕ отваря админ API-то (браузърна повърхност).
    assert.equal((await call(`${server.base}/admin/api/whoami`)).status, 404, 'без токен админ API-то е скрито');
    assert.equal((await call(`${server.base}/admin/api/sensors`)).status, 404, 'сензорите също са скрити без токен');
    assert.equal((await call(`${server.base}/ui/`)).status, 404, 'панелът не се сервира на публичния порт');

    // 2. С валиден Bearer токен минава — това е пътят на интеграцията на Home Assistant.
    const whoami = await call(`${server.base}/admin/api/whoami`, { authorization: 'Bearer ' + server.token });
    assert.equal(whoami.status, 200, 'с токен whoami минава на публичния порт: ' + whoami.status);
    const role = await whoami.json();
    assert.equal(role.role, 'admin', 'токенът дава админ роля: ' + JSON.stringify(role).slice(0, 120));

    // 3. Точно endpoint-ът, който coordinator.py чете.
    const sensors = await call(`${server.base}/admin/api/sensors`, { authorization: 'Bearer ' + server.token });
    assert.equal(sensors.status, 200, 'сензорите се четат с токен: ' + sensors.status);
    const payload = await sensors.json();
    assert.equal(typeof payload, 'object', 'сензорите връщат JSON');

    // 4. Грешен токен НЕ минава: изключението е за самоличност, не за „всеки с Bearer“.
    const wrong = await call(`${server.base}/admin/api/whoami`, { authorization: 'Bearer ' + 'x'.repeat(40) });
    assert.ok([401, 403].includes(wrong.status), 'грешен токен се отказва с 401/403, не с 200: ' + wrong.status);

    // 5. Ingress listener-ът остава както беше: там и без токен се работи (Supervisor/loopback).
    assert.equal((await call(`http://127.0.0.1:${adminPort}/admin/api/whoami`)).status, 200, 'ingress listener-ът не се променя');
    assert.equal((await call(`http://127.0.0.1:${adminPort}/health`)).status, 200, 'health е достъпен и на ingress listener-а');

    // 6. Документацията трябва да сочи порта, който НАИСТИНА работи за интеграцията (8099),
    //    а не admin listener-а (8098), който отказва на Home Assistant.
    for (const file of ['strings.json', 'translations/en.json', 'translations/bg.json']) {
      const text = fs.readFileSync(path.join(root, 'custom_components', 'hapi_enterprise', file), 'utf8');
      assert.equal(/8098/.test(text), false, file + ' не бива да сочи 8098 (той отказва на Home Assistant)');
      assert.match(text, /8099/, file + ' трябва да сочи порта, който интеграцията наистина достига');
    }

    console.log('PASS ha-admin-api-port: без токен админ API-то е 404 · с валиден Bearer → 200 (whoami + sensors) · грешен токен → 401/403 · ingress listener непроменен · документацията сочи 8099');
  } finally {
    await server.stop();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
