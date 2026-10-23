'use strict';
// Договорът за административното API — като компонент на HTTP слоя.
//
// Защо не е в `server.js`: монолитът има твърд таван (виж `tests/server-structure.cjs`)
// точно за да не расте с всеки нов маршрут. Тук е единственият маршрут на този дял, но
// мястото му е тук по същата причина, по която `reports.js` и `generator.js` са изнесени.
//
// Маршрутът иска токен като всеки друг административен: договорът описва повърхността,
// включително капацитетите за RBAC — публичен той би бил карта за нападателя.
const spec = require('../admin-api-spec');

/**
 * @param {{json: Function, adminGate: Function, baseUrl: Function, addonVersion: Function}} deps
 */
function build(deps) {
  const { json, adminGate, baseUrl, addonVersion } = deps;

  /** @returns {boolean} true, ако заявката е за този компонент (и е приключена). */
  async function handle({ req, res, url, method }) {
    if (url.pathname !== '/admin/api/openapi.json' || method !== 'GET') return false;
    if (!adminGate(req, res, 'whoami', method)) return true;
    json(res, 200, spec.build({ baseUrl: baseUrl(req), version: addonVersion() }));
    return true;
  }

  return { handle };
}

// Един екземпляр за целия сървър: `handle` е `async` по договора на компонентите, а
// извикването в `server.js` е на един ред — без кеша всяка заявка би създавала нов обект.
let singleton = null;
function create(deps) {
  if (!singleton) singleton = build(deps);
  return singleton;
}

module.exports = { create };
