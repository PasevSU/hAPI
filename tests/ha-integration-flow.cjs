'use strict';
// Функциите на HA интеграцията (пренесени от PasevSU/hAPI): config/options flow,
// координатор за телеметрия и сензори.
//
// Тестът е статичен (без Home Assistant в средата) и пази договора между:
//   - `const.py` (интервали, път на телеметрията),
//   - `coordinator.py` (превод на camelCase → snake_case),
//   - `sensor.py` (ключове на сензорите),
//   - `strings.json` / `translations/*.json` (имена и грешки),
//   - `manifest.json` (config_flow, iot_class).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'custom_components', 'hapi_enterprise');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
const json = (name) => JSON.parse(read(name));

// 1. Манифест: UI настройка + локално питанe (сензори).
const manifest = json('manifest.json');
assert.equal(manifest.config_flow, true, 'manifest.json: config_flow трябва да е true');
assert.equal(manifest.iot_class, 'local_polling', 'сензорите питaт add-on-а → local_polling');
assert.deepEqual(manifest.dependencies, ['http'], 'нужна е само http зависимост');

// 2. Константи.
const consts = read('const.py');
assert.match(consts, /PLATFORMS = \["sensor"\]/, 'const.py: платформа sensor');
assert.match(consts, /SENSORS_PATH = "\/admin\/api\/sensors"/, 'const.py: пътят на телеметрията');
assert.match(consts, /MIN_SCAN_INTERVAL = 10/, 'const.py: минимален интервал');
assert.match(consts, /MAX_SCAN_INTERVAL = 86400/, 'const.py: максимален интервал');

// 3. Координатор: пътят и преводът на полетата от add-on-а (camelCase) към сензорите.
const coordinator = read('coordinator.py');
assert.match(coordinator, /SENSORS_PATH/, 'coordinator.py: използва SENSORS_PATH');
assert.match(coordinator, /"Authorization": f"Bearer \{self\.token\}"/, 'coordinator.py: Bearer токен');
assert.match(coordinator, /file_bytes": "fileBytes"/, 'coordinator.py: fileBytes → file_bytes');
assert.match(coordinator, /database_bytes": "databaseBytes"/, 'coordinator.py: databaseBytes → database_bytes');
assert.match(coordinator, /telemetry_bytes": "telemetryBytes"/, 'coordinator.py: telemetryBytes → telemetry_bytes');
assert.match(coordinator, /portal_count/, 'coordinator.py: portal_count от списъка портали');
assert.match(coordinator, /UpdateFailed/, 'coordinator.py: грешките се превръщат в UpdateFailed');

// 4. Сензори: ключовете съвпадат с тези в coordinator и в преводите.
const sensor = read('sensor.py');
const sensorKeys = [...sensor.matchAll(/(?<![_a-z])key="([a-z_0-9]+)"/g)].map((m) => m[1]);
assert.equal(sensorKeys.length, 13, 'очакват се 13 сензора, намерени ' + sensorKeys.length);
for (const key of ['visits', 'downloads', 'files', 'portal_count', 'file_bytes', 'database_bytes', 'telemetry_bytes', 'unique_visitors', 'visitors_new_24h', 'download_visitors', 'denied_total', 'admin_logins', 'countries_known']) {
  assert.ok(sensorKeys.includes(key), 'sensor.py: липсва сензор ' + key);
  assert.ok(coordinator.includes('"' + key + '"'), 'coordinator.py: липсва ключ ' + key);
  assert.ok(consts.includes('PLATFORMS'), 'const.py: платформи');
}

// 5. Config flow: валидация срещу същите граници и грешки, които преводите очакват.
const flow = read('config_flow.py');
assert.match(flow, /class PortalEnterpriseConfigFlow\(ConfigFlow, domain=DOMAIN\)/, 'config_flow.py: класът');
assert.match(flow, /class PortalEnterpriseOptionsFlow\(OptionsFlow\)/, 'config_flow.py: options flow');
assert.match(flow, /async_set_unique_id/, 'config_flow.py: уникален id по адреса');
assert.match(flow, /_abort_if_unique_id_configured/, 'config_flow.py: без дублирани записи');
assert.match(flow, /MIN_TOKEN_LENGTH|token_too_short/, 'config_flow.py: проверка за дължината на токена');

// 6. Преводи: еднаква структура + всички грешки и имена на сензори.
const strings = json('strings.json');
for (const lang of ['en', 'bg']) {
  const dict = json(path.posix.join('translations', lang + '.json'));
  assert.deepEqual(Object.keys(dict).sort(), Object.keys(strings).sort(), lang + ': различен набор секции');
  for (const step of ['user']) {
    assert.ok(dict.config.step[step], lang + ': липсва config.step.' + step);
    for (const field of ['backend_url', 'token', 'scan_interval']) {
      assert.ok(dict.config.step[step].data[field], `${lang}: липсва поле ${field}`);
    }
  }
  for (const err of Object.keys(strings.config.error)) {
    assert.ok(dict.config.error[err], `${lang}: липсва грешка ${err}`);
  }
  for (const key of sensorKeys) {
    assert.ok(dict.entity.sensor[key] && dict.entity.sensor[key].name, `${lang}: липсва име за сензор ${key}`);
  }
}

// 7. __init__.py: entry hooks + запазени bridge изгледи.
const init = read('__init__.py');
for (const needle of ['async def async_setup_entry', 'async def async_unload_entry', 'async def async_update_entry']) {
  assert.ok(init.includes(needle), '__init__.py: липсва ' + needle);
}
// Смяната на опциите трябва да се прилага веднага, а не след преинсталация.
assert.match(init, /add_update_listener\(async_update_entry\)/, '__init__.py: липсва update listener за опциите');
assert.match(init, /async_on_unload\(entry\.add_update_listener/, '__init__.py: listener-ът не се отписва при unload');
for (const needle of ['PortalAPI', 'PortalPage', 'PortalAsset', 'PublicGateway', 'api:hapi_enterprise:gateway']) {
  assert.ok(init.includes(needle), '__init__.py: загубен bridge изглед ' + needle);
}
assert.match(init, /return True/, '__init__.py: UI настройката не бива да се блокира без YAML');
// Порталната страница през моста показва и QR код → пътят трябва да е разрешен.
assert.match(init, /openapi\\\.json\|qr\\\.svg|qr\\\.svg/, '__init__.py: мостът не разрешава qr.svg');

// 8. Порталната страница на интеграцията е същата адаптивна страница като в add-on-а.
const portalPage = read('portal.html');
const portalScript = read('portal.js');
assert.ok(fs.statSync(path.join(dir, 'portal.css')).size > 3000, 'portal.css е старият празен стил');
for (const asset of ['/api/hapi_enterprise/assets/portal.css', '/api/hapi_enterprise/assets/portal.js']) {
  assert.ok(portalPage.includes(asset), 'portal.html: липсва ' + asset);
}
for (const id of ['title', 'files', 'qr', 'status', 'toolbar', 'qr-note', 'foot-note']) {
  assert.ok(portalPage.includes(`id="${id}"`), 'portal.html: липсва id="' + id + '"');
}
for (const marker of ['buildProfile', 'applyWording', 'KIND_BY_EXT', 'NOUNS', 'X-Portal-Key', 'X-File-Key']) {
  assert.ok(portalScript.includes(marker), 'portal.js: липсва ' + marker);
}
// Ключът за достъп се държи само във фрагмента — не и в адреса на заявките.
assert.ok(portalScript.includes('#token='), 'portal.js: ключът трябва да е във фрагмента');
assert.ok(!portalScript.includes('portal_token'), 'portal.js: ключът не бива да е query параметър');
assert.match(portalScript, /\/api\/hapi_enterprise\/v1\/p\//, 'portal.js: заявките минават през моста');
assert.ok(!/innerHTML\s*=\s*[^'"`]*(file\.|data\.|listing)/.test(portalScript), 'portal.js: данните не влизат през innerHTML');

console.log(`ha-integration-flow OK: ${sensorKeys.length} сензора, config/options flow, ${Object.keys(strings.config.error).length} грешки × 2 езика`);
