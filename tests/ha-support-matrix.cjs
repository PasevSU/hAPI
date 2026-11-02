'use strict';
// СЪВМЕСТИМОСТ С HOME ASSISTANT — договорът между трите страни:
//   1. какво кодът ОЧАКВА от домакина (пътища, портове, API-та на Supervisor/HA);
//   2. какво `config.yaml` на add-on-а ДЕКЛАРИРА пред Supervisor;
//   3. каква минимална версия на HA е обещана (`hacs.json`, `homeassistant` в add-on-а).
//
// Защо съществува: всички тези неща се проверяват само от hassfest/HACS в чужд CI, тоест
// след като изданието вече е излязло. Тук се проверяват локално и преди таг:
//   • mount `share:rw`, без който `/share` в контейнера е ефимерна папка, а не споделената;
//   • `homeassistant_config:rw`, без който Evidence View не може да стигне до `/homeassistant`;
//   • `ssl`, защото `tls_cert`/`tls_key` сочат в него;
//   • портовете в `ports`, `ports_description` и в преводите — за да не пише „порт 8099“
//     на екрана на Supervisor-а, когато портът е друг;
//   • `ingress_port`/`watchdog` срещу портовете, които кодът наистина слуша;
//   • `homeassistant_api: true`, защото notify.js вика Supervisor проксито;
//   • минималната версия на HA срещу реално използваните API-та.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ADDON = path.join(ROOT, 'hapi_enterprise');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const config = read(ADDON, 'config.yaml');
const hacs = JSON.parse(read(ROOT, 'hacs.json'));
const manifest = JSON.parse(read(ROOT, 'custom_components', 'hapi_enterprise', 'manifest.json'));

/** Минимална версия → сравнимо число (2024.6.0 → 20240600). */
const vnum = (v) => {
  const [a = 0, b = 0, c = 0] = String(v).split('.').map((n) => Number(n) || 0);
  return a * 10000 + b * 100 + c;
};

/** Стойност на прост ключ от config.yaml (без YAML библиотека — форматът е плосък). */
const yamlValue = (key) => {
  const m = new RegExp('^' + key + ':\\s*"?([^"\\n]*)"?\\s*$', 'm').exec(config);
  return m ? m[1].trim() : '';
};
/** Редове от YAML блок (напр. `map:`) до следващия ключ от нулево ниво. */
const yamlBlock = (key) => {
  const start = new RegExp('^' + key + ':', 'm').exec(config);
  if (!start) return [];
  const rest = config.slice(start.index + start[0].length).split('\n').slice(1);
  const out = [];
  for (const line of rest) {
    if (/^\S/.test(line)) break;
    const item = /^\s*(?:-\s*)?(.+?)\s*$/.exec(line);
    if (item && item[1] && !item[1].startsWith('#')) out.push(item[1]);
  }
  return out;
};

// ── 1. Mount-ове: какво кодът очаква да съществува в контейнера ───────────────
// Всяко от тези места се среща като корен в кода; без mount то е празна папка в
// контейнера и функцията, която го ползва, работи „успешно“ върху чуждо място.
const map = yamlBlock('map');
const mounted = (key) => map.some((item) => item.replace(/\s/g, '').startsWith(key + ':') || item.replace(/\s/g, '') === key);
const EXPECTED_MOUNTS = [
  ['share', 'папките на порталите (`/share/<slug>`, `storage_root`)'],
  ['media', 'общият корен `/media`, който кодът разпознава като споделен'],
  ['homeassistant_config', 'конфигурацията на HA за Evidence View (`/homeassistant/www/hapi/data`)'],
  ['app_config', 'собствената папка на add-on-а (`/config`)'],
  ['ssl', '`tls_cert`/`tls_key` сочат в `/ssl`'],
];
for (const [key, why] of EXPECTED_MOUNTS) {
  assert.ok(mounted(key), `config.yaml трябва да монтира \`${key}\` — иначе ${why} не работят в реален add-on`);
}

// ── 2. Портове: код ↔ config.yaml ↔ преводи ─────────────────────────────────
const ports = yamlBlock('ports').map((line) => line.replace(/['"]/g, '').split(':')[0].trim());
const portDescriptions = yamlBlock('ports_description').map((line) => line.replace(/['"]/g, '').split(':')[0].trim());
for (const port of ['8099/tcp', '8088/tcp']) {
  assert.ok(ports.includes(port), `портът ${port} трябва да е обявен в \`ports\``);
  assert.ok(portDescriptions.includes(port), `портът ${port} трябва да има описание в \`ports_description\``);
  for (const lang of ['bg', 'en']) {
    const tr = read(ADDON, 'translations', `${lang}.yaml`);
    assert.ok(tr.includes(port), `преводът ${lang}.yaml трябва да описва ${port}`);
  }
}

// ── 3. Ingress и watchdog: същите портове, които кодът слуша ───────────────
const serverSource = read(ADDON, 'server.js');
assert.equal(Number(yamlValue('ingress_port')), 8098, 'ingress_port е 8098');
assert.ok(/ADMIN_PORT[^)]*\|\|\s*8098|ADMIN_PORT\s*=\s*Number\(process\.env\.ADMIN_PORT \|\| 8098\)/.test(serverSource),
  'кодът слуша admin порта по подразбиране на 8098 — същият, който ingress обявява');
assert.equal(yamlValue('ingress'), 'true', 'ingress е включен');
assert.equal(yamlValue('ingress_entry'), '/', 'ingress_entry е /');
const watchdog = /watchdog:\s*"([^"]+)"/.exec(config);
assert.ok(watchdog, 'watchdog е обявен');
assert.ok(watchdog[1].includes('[PORT:8099]'), 'watchdog проверява публичния порт 8099: ' + (watchdog && watchdog[1]));
assert.ok(/\/health/.test(watchdog[1]), 'watchdog сочи /health');
assert.ok(/env\.PORT \|\| 8099|PORT: "8099"/.test(serverSource + config), 'публичният порт по подразбиране е 8099');

// ── 4. Supervisor API: какво кодът вика ─────────────────────────────────────
const notify = read(ADDON, 'notify.js');
if (notify.includes('http://supervisor/')) {
  assert.equal(yamlValue('homeassistant_api'), 'true',
    'notify.js вика Supervisor проксито (http://supervisor/…) — без `homeassistant_api: true` то е забранено');
}
assert.equal(yamlValue('startup'), 'application', 'startup е application');
assert.equal(yamlValue('boot'), 'auto', 'boot е auto');
assert.equal(yamlValue('init'), 'false', 'init: false (add-on-ът сам управлява процесите си)');
assert.ok(['cold', 'hot'].includes(yamlValue('backup')), 'backup е cold или hot');

// ── 5. Минимална версия на HA срещу използваните API-та ────────────────────
// Списък на това, което интеграцията внася от Home Assistant, с версията, в която е
// ПОЯВЕНО. Ако някой добави ново API, тестът иска то да влезе тук — и така минималната
// версия не изостава от кода.
const HA_API_MIN = {
  'HomeAssistant': '2020.12',
  'HomeAssistantView': '2021.1',
  'ConfigFlow': '2020.12',
  'ConfigFlowResult': '2024.4',
  'OptionsFlow': '2020.12',
  'ConfigEntry': '2020.12',
  'EntityCategory': '2023.3',
  'UnitOfInformation': '2023.6',
  'SensorDeviceClass': '2022.6',
  'SensorStateClass': '2022.6',
  'BinarySensorDeviceClass': '2022.6',
  'SensorEntity': '2021.11',
  'BinarySensorEntity': '2021.11',
  'SensorEntityDescription': '2021.11',
  'BinarySensorEntityDescription': '2021.11',
  'AddEntitiesCallback': '2022.5',
  'DataUpdateCoordinator': '2020.12',
  'UpdateFailed': '2020.12',
  'ConfigEntryNotReady': '2020.12',
  'async_get_clientsession': '2020.12',
  'async_get_integration': '2020.12',
  'config_validation as cv': '2020.12',
  'selector': '2021.9',
  'DeviceInfo': '2021.1',
  'async_forward_entry_setups': '2023.7',
  'async_config_entry_first_refresh': '2022.12',
};
const pyFiles = fs.readdirSync(path.join(ROOT, 'custom_components', 'hapi_enterprise')).filter((f) => f.endsWith('.py'));
const imported = new Set();
for (const file of pyFiles) {
  const source = read(ROOT, 'custom_components', 'hapi_enterprise', file);
  for (const m of source.matchAll(/from homeassistant[.\w]* import \(([\s\S]*?)\)/g)) {
    for (const part of m[1].split(/[,\n]/)) {
      const name = part.replace(/#.*$/, '').trim();
      if (name && !name.startsWith(' ') && /^[A-Za-z_][\w.]*$/.test(name)) imported.add(name.split('.').pop());
    }
  }
  for (const m of source.matchAll(/from homeassistant[.\w]* import ([^\n(]+)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim();
      if (name) imported.add(name.split('.').pop());
    }
  }
}
const floor = yamlValue('homeassistant');
assert.ok(floor, 'config.yaml обявява `homeassistant` (минимална версия)');
assert.equal(hacs.homeassistant, floor, `hacs.json и add-on-ът трябва да обявяват СЪЩАТА минимална версия (${floor})`);
const unknown = [...imported].filter((name) => !(name in HA_API_MIN));
assert.deepEqual(unknown, [], 'ново HA API без запис в HA_API_MIN — добави го с версията, в която е появено: ' + unknown.join(', '));
const needed = [...imported].map((name) => HA_API_MIN[name]).sort((a, b) => vnum(b) - vnum(a))[0];
assert.ok(vnum(floor) >= vnum(needed),
  `обявената минимална версия ${floor} е по-ниска от нужното от кода ${needed}`);

// ── 6. Архитектури срещу базовия образ ────────────────────────────────────
const dockerfile = read(ADDON, 'Dockerfile');
const from = (/^FROM\s+(\S+)/m.exec(dockerfile) || [])[1];
assert.ok(from, 'Dockerfile има FROM');
// Официалният `node:22-alpine` се публикува за тези платформи; `armv7` = linux/arm/v7.
// Тагът е ЗАКАЧЕН (напр. `node:22.21.1-alpine3.23`) — това е нарочно: плаващ таг прави
// изданието невъзпроизводимо. Проверява се семейството, не точният номер.
const NODE_PLATFORMS = { amd64: 'linux/amd64', aarch64: 'linux/arm64', armv7: 'linux/arm/v7' };
assert.match(from, /^node:22(\.\d+)*-(alpine|bookworm|bullseye)/, 'базовият образ е node 22 (многоархивен): ' + from);
for (const arch of yamlBlock('arch')) {
  assert.ok(NODE_PLATFORMS[arch], `\`arch: ${arch}\` няма съответствие в базовия образ — не се билдва`);
}

// ── 7. Интеграцията: домейн, име, версия ──────────────────────────────────
assert.equal(manifest.domain, 'hapi_enterprise', 'домейнът съвпада с папката');
assert.equal(manifest.version, yamlValue('version'), 'интеграцията и add-on-ът носят една версия');
assert.equal(manifest.config_flow, true, 'config_flow е включен');
assert.ok(fs.existsSync(path.join(ROOT, 'custom_components', 'hapi_enterprise', 'config_flow.py')), 'config_flow.py съществува');
assert.ok(Array.isArray(manifest.dependencies) && manifest.dependencies.includes('http'), 'зависи от `http`');

console.log(`ha-support-matrix OK: ${map.length} mount-а (share/media/homeassistant_config/app_config/ssl) · портове 8099+8088 в config, описание и 2 превода · ingress 8098 + watchdog 8099 · homeassistant_api за Supervisor проксито · минимална HA ${floor} (кодът иска ${needed}) · arch ${yamlBlock('arch').join('/')} срещу ${from}`);
