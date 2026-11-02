'use strict';
// Съвместимостта с Home Assistant е договор между три файла и една папка:
//   * `hapi_enterprise/config.yaml` — add-on схемата, която Supervisor валидира при старт;
//   * `custom_components/hapi_enterprise/manifest.json` — интеграцията, която hassfest и HACS четат;
//   * `hacs.json` — как HACS инсталира интеграцията;
//   * `repository.yaml` — как Supervisor разпознава хранилището на add-on-а.
// Досега всеки от тях се проверяваше частично („има 43 опции“, „има преводи“), но никой не
// проверяваше ГРАМАТИКАТА на add-on схемата и ЗАДЪЛЖИТЕЛНИТЕ ключове на hassfest — тоест
// счупена стойност в `schema:` се виждаше едва когато Supervisor откаже старт на истинска
// инсталация.
//
// Тук се кодира това, което HA изисква, и се проверява срещу файловете:
//   1. add-on: задължителни ключове, semver версия, `arch` от познатите, `startup`/`boot`/
//      `backup` от позволените, `options` ↔ `schema` в двете посоки, всяка схема по граматиката
//      на Supervisor (`str`, `bool`, `int(min,max)`, `list(a|b)`, `match(...)`, `password`,
//      `port`, `url`, `email`, `device`, `float`, с `?` за незадължително), `map` от познатите
//      ключове, `watchdog` с `[HOST]`/`[PORT:x]`;
//   2. интеграция: задължителните ключове на hassfest, `domain` = папката, `version` = add-on
//      версията, `requirements` празни (иначе HACS иска pip пакет), `iot_class` и
//      `integration_type` от позволените, `codeowners` с `@`;
//   3. `hacs.json` и `repository.yaml` — задължителните им полета;
//   4. структурата, която HACS изисква (manifest, config_flow, translations/en.json,
//      strings.json, brand/icon.png).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const addonDir = path.join(root, 'hapi_enterprise');
const integrationDir = path.join(root, 'custom_components', 'hapi_enterprise');
const read = (p) => fs.readFileSync(p, 'utf8');

// ── Минимален YAML четец за плосък `key: value` с два интервала (достатъчно за options/schema) ──
function flatSection(lines, name) {
  const out = new Map();
  let inside = false;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      inside = new RegExp(`^${name}:\\s*$`).test(line);
      continue;
    }
    if (!inside) continue;
    const m = line.match(/^ {2}([a-z0-9_]+):\s*(.*)$/);
    if (m) out.set(m[1], m[2].trim());
  }
  return out;
}

const configLines = read(path.join(addonDir, 'config.yaml')).split(/\r?\n/);
const scalar = (key) => {
  const line = configLines.find((l) => new RegExp(`^${key}:`).test(l));
  return line ? line.replace(new RegExp(`^${key}:\\s*`), '').trim().replace(/^"|"$/g, '') : undefined;
};

// ── 1. Add-on: задължителни ключове и стойности от позволените ──────────────
for (const key of ['name', 'version', 'slug', 'description', 'arch', 'startup', 'boot', 'ingress_port', 'panel_title', 'panel_icon', 'map', 'options', 'schema']) {
  assert.ok(configLines.some((l) => new RegExp(`^${key}:`).test(l)), `config.yaml има задължителния ключ ${key}`);
}
const version = scalar('version');
assert.match(version, /^\d+\.\d+\.\d+$/, 'версията е semver');
assert.equal(scalar('slug'), 'hapi_enterprise', 'slug съвпада с папката на add-on-а');
assert.match(scalar('homeassistant'), /^\d{4}\.\d+\.\d+$/, 'минималната HA версия е semver');

const listValue = (key) => {
  const start = configLines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  assert.ok(start >= 0, `config.yaml има ${key}`);
  const out = [];
  for (let i = start + 1; i < configLines.length; i += 1) {
    if (/^\S/.test(configLines[i])) break;
    const item = configLines[i].match(/^\s+-\s*(.+)$/);
    if (item) out.push(item[1].trim().replace(/^"|"$/g, ''));
    else if (!/^\s+#/.test(configLines[i]) && configLines[i].trim()) break;
  }
  return out;
};
const ARCH = new Set(['aarch64', 'amd64', 'armhf', 'armv7', 'i386']);
for (const arch of listValue('arch')) assert.ok(ARCH.has(arch), `архитектурата „${arch}“ е позната на Supervisor`);
assert.ok(['application', 'services', 'system'].includes(scalar('startup')), 'startup е от позволените');
assert.ok(['auto', 'manual'].includes(scalar('boot')), 'boot е от позволените');
assert.ok(['hot', 'cold'].includes(scalar('backup')), 'backup е hot или cold');
for (const entry of listValue('map')) {
  const name = entry.replace(/:.*$/, '');
  // `app_config` е историческото име на mount-а, който слага `/addon_configs/<slug>` на `/config`
  // (по-новото име в документацията на Supervisor е `addon_config`). Add-on-ът държи данните си
  // точно там, затова ключът се пази — смяната би преместила данните на съществуващи инсталации.
  const ALLOWED = ['addon_config', 'all_addon_configs', 'app_config', 'backup', 'config', 'homeassistant_config', 'media', 'share', 'ssl'];
  assert.ok(ALLOWED.includes(name), `map ключът „${name}“ е позволен`);
  if (name !== 'ssl' && name !== 'backup') assert.match(entry, /:rw$/, `map „${name}“ е с :rw (иначе е само за четене)`);
}
const watchdog = scalar('watchdog');
assert.ok(watchdog && watchdog.includes('[HOST]') && /\[PORT(:\d+)?\]/.test(watchdog), 'watchdog ползва [HOST] и [PORT]');

// options ↔ schema в двете посоки
const options = flatSection(configLines, 'options');
const schema = flatSection(configLines, 'schema');
assert.ok(options.size >= 40, `options има поне 40 ключа (намерени ${options.size})`);
assert.deepEqual([...options.keys()].filter((k) => !schema.has(k)), [], 'всяка опция има схема');
assert.deepEqual([...schema.keys()].filter((k) => !options.has(k)), [], 'всяка схема има опция');

// Граматиката на Supervisor за схема: type(attr)? — с `?` за незадължително.
const BASE_TYPES = new Set(['str', 'bool', 'int', 'float', 'email', 'url', 'port', 'device', 'password']);
const bad = [];
for (const [key, raw] of schema) {
  const value = raw.replace(/^"|"$/g, '');
  // Supervisor чете `type(attr)?`, а изразът на `match(...)` сам съдържа скоби — затова
  // аргументът се взима до ПОСЛЕДНАТА затваряща скоба, не до първата.
  const m = value.match(/^([a-z_]+)(?:\((.*)\))?(\?)?$/);
  if (!m) {
    bad.push(`${key}: ${value} (не се разчита)`);
    continue;
  }
  const [, type, attr, optional] = m;
  if (type === 'list') {
    if (!attr || !/^[a-z0-9_|.-]+$/.test(attr)) bad.push(`${key}: ${value} (list без стойности)`);
  } else if (type === 'match') {
    if (!attr) bad.push(`${key}: ${value} (match без израз)`);
  } else if (BASE_TYPES.has(type)) {
    if (attr && (type === 'int' || type === 'float') && !/^\d+,\d+$/.test(attr)) bad.push(`${key}: ${value} (диапазонът е min,max)`);
    if (attr && type !== 'int' && type !== 'float') bad.push(`${key}: ${value} (тип ${type} не приема аргумент)`);
  } else {
    bad.push(`${key}: ${value} (непознат тип ${type})`);
  }
  assert.ok(optional === '?' || optional === undefined, `${key}: „?“ е само накрая`);
}
assert.deepEqual(bad, [], 'всяка стойност в schema: е по граматиката на Supervisor');

// ── 2. Интеграция: задължителните ключове на hassfest ──────────────────────
const manifest = JSON.parse(read(path.join(integrationDir, 'manifest.json')));
for (const key of ['domain', 'name', 'codeowners', 'documentation', 'issue_tracker', 'version', 'iot_class', 'integration_type', 'requirements', 'dependencies', 'config_flow']) {
  assert.ok(key in manifest, `manifest.json има ${key}`);
}
assert.equal(manifest.domain, 'hapi_enterprise', 'domain съвпада с папката');
assert.equal(manifest.version, version, 'версията на интеграцията е същата като на add-on-а');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'версията на интеграцията е semver');
assert.deepEqual(manifest.requirements, [], 'няма външни pip изисквания (HACS инсталира без компилация)');
assert.ok(Array.isArray(manifest.codeowners) && manifest.codeowners.every((c) => /^@[\w-]+$/.test(c)), 'codeowners са @потребители');
assert.ok(['assumed_state', 'calculated', 'cloud_polling', 'cloud_push', 'local_polling', 'local_push'].includes(manifest.iot_class), 'iot_class е от позволените');
assert.ok(['device', 'entity', 'helper', 'hub', 'service', 'system'].includes(manifest.integration_type), 'integration_type е от позволените');
assert.equal(manifest.config_flow, true, 'интеграцията се настройва през config flow');
assert.ok(manifest.documentation.startsWith('https://'), 'documentation е адрес');
assert.ok(manifest.issue_tracker.startsWith('https://'), 'issue_tracker е адрес');
assert.ok(Array.isArray(manifest.dependencies) && manifest.dependencies.every((d) => /^[a-z_]+$/.test(d)), 'dependencies са имена на интеграции');

// ── 3. hacs.json и repository.yaml ────────────────────────────────────────
const hacs = JSON.parse(read(path.join(root, 'hacs.json')));
assert.ok(hacs.name, 'hacs.json има name');
assert.match(hacs.homeassistant, /^\d{4}\.\d+\.\d+$/, 'hacs.json обявява минимална HA версия');
assert.equal(hacs.content_in_root, false, 'интеграцията е в custom_components/ (content_in_root: false)');
const repo = read(path.join(root, 'repository.yaml'));
for (const key of ['name', 'url', 'maintainer']) assert.match(repo, new RegExp(`^${key}:`, 'm'), `repository.yaml има ${key}`);
assert.ok(/^url:\s*https:\/\/github\.com\/PasevSU\/hAPI\s*$/m.test(repo), 'repository.yaml сочи хранилището');

// ── 4. Структурата, която HACS изисква ────────────────────────────────────
for (const file of ['manifest.json', '__init__.py', 'config_flow.py', 'const.py', 'strings.json', 'coordinator.py', path.join('translations', 'en.json'), path.join('brand', 'icon.png')]) {
  assert.ok(fs.existsSync(path.join(integrationDir, file)), `интеграцията има ${file}`);
}
const strings = JSON.parse(read(path.join(integrationDir, 'strings.json')));
const en = JSON.parse(read(path.join(integrationDir, 'translations', 'en.json')));
assert.deepEqual(Object.keys(strings).sort(), Object.keys(en).sort(), 'strings.json и translations/en.json имат еднакви секции');
const ALLOWED_SECTIONS = new Set(['config', 'options', 'selector', 'entity', 'services', 'exceptions', 'issues', 'device_automation', 'system_health', 'common']);
assert.deepEqual(Object.keys(strings).filter((k) => !ALLOWED_SECTIONS.has(k)), [], 'секциите са от позволените на hassfest');

console.log(
  `ha-compat: add-on ${version} · ${options.size} опции · схема по граматиката · интеграция ${manifest.domain} (${manifest.integration_type}, ${manifest.iot_class}) · HACS + repository.yaml — наред`,
);
