'use strict';
// Add-on readiness invariants that the Supervisor relies on but does not enforce for
// us: option/schema parity, translations coverage, cold backups for WAL SQLite and a
// watchdog that points at a real health endpoint.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../hapi_enterprise');
const cfg = fs.readFileSync(path.join(root, 'config.yaml'), 'utf8');

function keysOf(section) {
  const start = cfg.indexOf('\n' + section + ':\n');
  assert.ok(start >= 0, 'липсва секция ' + section);
  const rest = cfg.slice(start + section.length + 2);
  const end = rest.search(/\n[a-z_]+:\n/);
  return rest
    .slice(0, end === -1 ? undefined : end)
    .split('\n')
    .filter((line) => /^ {2}[A-Za-z0-9_]+:/.test(line))
    .map((line) => line.trim().split(':')[0]);
}

const options = keysOf('options');
const schema = keysOf('schema');
assert.ok(options.length >= 17, 'трябва да има поне 17 опции, намерени: ' + options.length);
assert.equal(options.length, schema.length, 'options и schema трябва да са с еднакъв брой ключове');
for (const key of options) assert.ok(schema.includes(key), 'опция „' + key + '“ липсва в schema');
for (const key of schema) assert.ok(options.includes(key), 'schema ключ „' + key + '“ липсва в options');

// ── Стойностите по подразбиране трябва да минават собствената си схема ────────────
// Supervisor валидира `options` срещу `schema` при старт и отказва add-on-а с
// „Невалидна конфигурация: value must be one of [...]“, ако примерно `list(a|b|c)`
// е с празен низ, а `bool` — с null. Локално това не се вижда — add-on-ът просто не
// тръгва. Затова тук се прилагат същите правила върху стойностите по подразбиране.
function valuesOf(section) {
  const start = cfg.indexOf('\n' + section + ':\n');
  assert.ok(start >= 0, 'липсва секция ' + section);
  const rest = cfg.slice(start + section.length + 2);
  const end = rest.search(/\n[a-z_]+:\n/);
  const out = {};
  for (const line of rest.slice(0, end === -1 ? undefined : end).split('\n')) {
    const m = /^ {2}([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return out;
}

// YAML скалар → стойност, както го вижда Supervisor (низове, bool, числа, null).
// В кавички стойността е низ, дори да изглежда число (`db_id: "1"`).
function scalar(text) {
  const raw = String(text).trim();
  if (/^'.*'$/.test(raw) || /^".*"$/.test(raw)) return raw.slice(1, -1);
  if (raw === '') return '';
  if (raw === 'true' || raw === 'false') return raw === 'true';
  if (raw === 'null' || raw === '~') return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}

// Връща null, ако стойността е валидна за типа, иначе обяснение защо не е.
function typeViolation(rawValue, rawType) {
  // Типът в YAML може да е в кавички (заради `|` в list(...)) — Supervisor ги маха.
  const type = String(rawType).replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1').trim();
  const base = type.endsWith('?') ? type.slice(0, -1) : type;
  const name = base.replace(/\(.*\)$/, '').trim();
  const args = (base.match(/\(([\s\S]*)\)$/) || [])[1] || '';
  const value = scalar(rawValue);
  const show = JSON.stringify(value);
  if (name === 'str' || name === 'password') return typeof value === 'string' ? null : show + ' не е низ';
  if (name === 'bool') return typeof value === 'boolean' ? null : show + ' не е true/false';
  if (name === 'int' || name === 'float') {
    const [min, max] = args.split(',').map((x) => Number(String(x).trim()));
    if (typeof value !== 'number' || (name === 'int' && !Number.isInteger(value))) return show + ' не е ' + name;
    if (Number.isFinite(min) && value < min) return show + ' е под ' + min;
    if (Number.isFinite(max) && value > max) return show + ' е над ' + max;
    return null;
  }
  if (name === 'list') {
    const allowed = args.split('|').map((x) => x.trim());
    return allowed.includes(String(value)) ? null : show + ' не е от ' + JSON.stringify(allowed);
  }
  if (name === 'match') return typeof value === 'string' && new RegExp(args).test(value) ? null : show + ' не пасва на ' + args;
  if (name === 'device') return typeof value === 'string' ? null : show + ' не е устройство';
  return 'непознат тип „' + type + '“';
}

// Самата проверка трябва да хване точно дефекта, който стигна до потребител.
assert.notEqual(typeViolation('""', '"list(hashed|masked|full)?"'), null, 'празен низ за list(...) трябва да се хване');
assert.notEqual(typeViolation('null', 'bool?'), null, 'null за bool трябва да се хване');
assert.notEqual(typeViolation('0', 'int(1,10)?'), null, 'стойност под минимума трябва да се хване');
assert.equal(typeViolation('hashed', '"list(hashed|masked|full)?"'), null, 'валидна стойност от списъка минава');
assert.equal(typeViolation('0', 'int(0,3650)?'), null, '0 в диапазона минава');

const optionDefaults = valuesOf('options');
const schemaTypes = valuesOf('schema');
const violations = [];
for (const key of options) {
  const why = typeViolation(optionDefaults[key], schemaTypes[key]);
  if (why) violations.push(key + ': ' + why + ' (schema ' + schemaTypes[key] + ')');
}
assert.deepEqual(violations, [], 'Supervisor би отказал тези стойности по подразбиране:\n  ' + violations.join('\n  '));

// ── Обновяване на съществуваща инсталация ────────────────────────────────────────
// Supervisor пази записаните от потребителя опции и след обновяване ги валидира
// отново. Затова схемата трябва да приема и СТАРИТЕ стойности, иначе add-on-ът
// отказва старт точно след ъпдейт (така се стигна до „Невалидна конфигурация“).
assert.equal(typeViolation('""', schemaTypes.visitor_ip_mode), null, 'старото празно "" за visitor_ip_mode трябва да минава');
for (const good of ['hashed', 'masked', 'full']) {
  assert.equal(typeViolation('"' + good + '"', schemaTypes.visitor_ip_mode), null, 'режимът „' + good + '“ трябва да минава');
}
assert.notEqual(typeViolation('raw', schemaTypes.visitor_ip_mode), null, 'непознат режим трябва да се откаже');
// `null` не може да се изрази в HA схема — затова проксито не е опция, а живее в конзолата.
assert.equal(options.includes('visitor_trust_proxy'), false, 'visitor_trust_proxy не бива да е add-on опция (старото null не минава схема)');
assert.equal(schema.includes('visitor_trust_proxy'), false, 'visitor_trust_proxy не бива да е в schema');
assert.equal(optionDefaults.visitor_ip_mode.replace(/"/g, ''), 'hashed', 'visitor_ip_mode трябва да е реална стойност от списъка, не празен низ');

// Storage selection is implemented in storage-preflight.js and must stay configurable.
for (const key of ['storage_location', 'storage_subdirectory', 'storage_mode', 'storage_mount_name', 'min_free_mb']) {
  assert.ok(options.includes(key), 'липсва add-on опция ' + key);
  assert.ok(schema.includes(key), 'липсва schema тип за ' + key);
}
assert.match(cfg, /storage_location: "list\(addon_config\|media\|share\)"/, 'storage_location трябва да е списък');
assert.match(cfg, /storage_mode: "list\(local\|ha_network\)"/, 'storage_mode трябва да е списък');

// WAL SQLite must never be captured by a hot Supervisor backup, and stop must be graceful.
assert.match(cfg, /^backup: cold$/m, 'backup трябва да е cold (SQLite WAL)');
assert.match(cfg, /^timeout: 30$/m, 'timeout трябва да дава време за затваряне на SQLite');
assert.match(cfg, /^ingress_stream: true$/m, 'ingress_stream трябва да е true за големи качвания');

// The Supervisor only restarts a hung process when a watchdog is declared.
assert.match(cfg, /^watchdog: "http:\/\/\[HOST\]:\[PORT:8099\]\/health"$/m, 'watchdog трябва да сочи /health на 8099');

// API достъп: notify.js праща съобщения през Supervisor проксито
// `http://supervisor/core/api/services/...`. Без `homeassistant_api: true` проксито
// е забранено (default false) — изпращането гърми с 403/502 в реален add-on.
assert.match(cfg, /^homeassistant_api: true$/m, 'липсва homeassistant_api: true — notify няма достъп до /core/api');

// app_config is the current name; addon_config is deprecated and logs a warning.
assert.match(cfg, /^ {2}- app_config:rw$/m, 'map трябва да ползва app_config');
assert.doesNotMatch(cfg, /addon_config:rw/, 'map не трябва да ползва deprecated addon_config');

// Every port must be described, otherwise the Supervisor UI shows a bare number.
const ports = [...cfg.matchAll(/^ {2}(\d+\/tcp):/gm)].map((m) => m[1]);
assert.ok(ports.length >= 2, 'очакват се поне два порта');
for (const port of ports) assert.ok(cfg.includes('  ' + port + ': "'), 'порт ' + port + ' няма описание');

// The Configuration tab must show readable labels, not raw option keys.
for (const lang of ['en', 'bg']) {
  const file = path.join(root, 'translations', lang + '.yaml');
  assert.ok(fs.existsSync(file), 'липсва translations/' + lang + '.yaml');
  const text = fs.readFileSync(file, 'utf8');
  for (const key of options) assert.match(text, new RegExp('^ {2}' + key + ':$', 'm'), lang + '.yaml не покрива опцията ' + key);
  for (const port of ports) assert.match(text, new RegExp('^ {2}' + port.replace('/', '\\/') + ':', 'm'), lang + '.yaml не покрива порта ' + port);
}

// README-то на add-on-а показва „препоръчителни настройки“ преди инсталиране: те трябва
// да са реални опции с валидни стойности, иначе потребителят копира неработеща конфигурация.
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const block = (readme.match(/```yaml\n([\s\S]*?)```/) || [])[1];
assert.ok(block, 'README.md: липсва YAML блок с препоръчителни настройки');
const recommended = {};
for (const line of block.split('\n')) {
  const m = line.match(/^([a-z_]+):\s*(.*)$/);
  if (m) recommended[m[1]] = m[2].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
}
assert.ok(Object.keys(recommended).length >= 10, 'README: очакват се поне 10 препоръчани опции');
for (const key of Object.keys(recommended)) assert.ok(options.includes(key), 'README: „' + key + '“ не е add-on опция');
for (const key of ['storage_location', 'storage_mode', 'min_free_mb', 'log_level', 'public_same_origin', 'public_gateway', 'user_roles']) {
  assert.ok(key in recommended, 'README: липсва препоръка за ' + key);
}
assert.ok(['addon_config', 'media', 'share'].includes(recommended.storage_location), 'README: невалиден storage_location');
assert.ok(['local', 'ha_network'].includes(recommended.storage_mode), 'README: невалиден storage_mode');
assert.ok(['error', 'warn', 'info', 'debug', 'trace'].includes(recommended.log_level), 'README: невалиден log_level');
assert.ok(['true', 'false'].includes(recommended.public_same_origin), 'README: public_same_origin трябва да е bool');
assert.ok(['true', 'false'].includes(recommended.public_gateway), 'README: public_gateway трябва да е bool');
assert.ok(Number.isInteger(Number(recommended.min_free_mb)), 'README: min_free_mb трябва да е число');
assert.equal(typeof JSON.parse(recommended.user_roles), 'object', 'README: user_roles трябва да е JSON обект');

console.log('PASS add-on config: ' + options.length + ' опции, schema паритет, cold backup, watchdog, homeassistant_api, ingress_stream, app_config, ' + ports.length + ' порта, translations en+bg');
