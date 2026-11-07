'use strict';
// МЕСТЕН hassfest: съвместимост с Home Assistant, проверена без интернет.
//
// Официалният валидатор (hassfest) върви в GitHub Actions на хранилището за интеграцията и
// казва „члeнът е валиден“ едва след като е пуснат. Дотук това значеше, че грешка в превод
// или в манифест се вижда ЧАК след публикуване — точно това се случи с 0.69.144, което
// Home Assistant отказа с `[TRANSLATIONS] the string should not contain URLs`.
//
// Тук същите правила се проверяват локално върху `custom_components/hapi_enterprise` и
// `hacs.json`, за да не излиза издание, което валидаторът ще върне:
//   • манифест: позволени ключове, типове, домейн = име на папката, версия, config_flow;
//   • преводи: `strings.json` = `translations/en.json`, без URL адреси, всички ключове
//     непразни, `entity.*` покрива ВСЕКИ `translation_key` от кода, enum-стойностите имат
//     превод, а грешките в `config.error` съвпадат с тези, които flow-ът може да върне;
//   • файлове: `__init__.py`, `manifest.json`, икона за HACS, без `__pycache__`/`.pyc`;
//   • `hacs.json`: валиден JSON, версия на Home Assistant, `content_in_root: false`;
//   • внос: само стандартна библиотека + Home Assistant (+ voluptuous/aiohttp, които HA носи).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CC = path.join(ROOT, 'custom_components', 'hapi_enterprise');
const read = (file) => fs.readFileSync(file, 'utf8');
const json = (file) => JSON.parse(read(file));

// ── 1. Манифест ─────────────────────────────────────────────────────────────
// Позволените ключове са тези, които hassfest приема за интеграция (не add-on манифест).
const ALLOWED_KEYS = new Set([
  'domain', 'name', 'version', 'after_dependencies', 'codeowners', 'config_flow', 'dependencies',
  'documentation', 'integration_type', 'iot_class', 'issue_tracker', 'loggers', 'requirements',
  'quality_scale', 'dhcp', 'ssdp', 'zeroconf', 'bluetooth', 'usb', 'mqtt', 'supported_brands',
]);
const IOT_CLASSES = new Set(['cloud_polling', 'cloud_push', 'local_polling', 'local_push', 'calculated']);
const INTEGRATION_TYPES = new Set(['device', 'entity', 'hub', 'service', 'system', 'helper']);

const manifest = json(path.join(CC, 'manifest.json'));
const unknown = Object.keys(manifest).filter((key) => !ALLOWED_KEYS.has(key));
assert.deepEqual(unknown, [], 'manifest.json съдържа ключове, които hassfest не приема: ' + unknown.join(', '));
assert.equal(manifest.domain, path.basename(CC), 'домейнът трябва да е името на папката');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'потребителска интеграция носи `version` (SemVer)');
assert.ok(IOT_CLASSES.has(manifest.iot_class), 'iot_class е от позволения списък: ' + manifest.iot_class);
assert.ok(INTEGRATION_TYPES.has(manifest.integration_type), 'integration_type е от позволения списък');
assert.match(manifest.documentation, /^https?:\/\/\S+$/, 'documentation е адрес');
assert.match(manifest.issue_tracker, /^https?:\/\/\S+$/, 'issue_tracker е адрес');
assert.ok(Array.isArray(manifest.codeowners) && manifest.codeowners.length, 'codeowners не е празно');
for (const owner of manifest.codeowners) assert.match(owner, /^@[\w-]+$/, 'codeowner е @име: ' + owner);
assert.ok(Array.isArray(manifest.requirements), 'requirements е списък (празен е позволено)');
for (const requirement of manifest.requirements) assert.match(requirement, /\w/, 'изискване не е празно');
if (manifest.config_flow) {
  assert.ok(fs.existsSync(path.join(CC, 'config_flow.py')), 'config_flow: true изисква config_flow.py');
}

// ── 2. Преводи ──────────────────────────────────────────────────────────────
const strings = json(path.join(CC, 'strings.json'));
const dictionaries = {
  en: json(path.join(CC, 'translations', 'en.json')),
  bg: json(path.join(CC, 'translations', 'bg.json')),
};
assert.deepEqual(dictionaries.en, strings, 'translations/en.json трябва да е същото като strings.json');

// 2а. Без URL адреси в текстовете — правилото на hassfest, което спря 0.69.144.
// Домакин без точка (`http://hapi_enterprise:8099`) минава; адрес с домейн — не.
const URL_WITH_DOMAIN = /https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+/i;
const stringsOf = (node, at = '') => {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    const here = at ? at + '.' + key : key;
    if (typeof value === 'string') out.push([here, value]);
    else if (value && typeof value === 'object') out.push(...stringsOf(value, here));
  }
  return out;
};
for (const [lang, dict] of Object.entries(dictionaries)) {
  const offending = stringsOf(dict).filter(([, text]) => URL_WITH_DOMAIN.test(text));
  assert.deepEqual(offending.map(([at]) => lang + ':' + at), [], 'URL в текст на превод (hassfest го забранява)');
  // 2б. Никакви празни текстове и никакви ключове, оставени като стойност.
  const empty = stringsOf(dict).filter(([, text]) => !text.trim() || text === null);
  assert.deepEqual(empty.map(([at]) => lang + ':' + at), [], 'празен текст в превод');
}

// 2в. Entity преводите покриват ВСЕКИ `translation_key`, който кодът използва.
// hassfest сравнява кода с речниците; липсващ ключ значи обект без име в интерфейса.
const sensorSource = read(path.join(CC, 'sensor.py'));
const binarySource = read(path.join(CC, 'binary_sensor.py'));
const keysOf = (source) => [...source.matchAll(/translation_key="([a-z_0-9]+)"/g)].map((m) => m[1]);
for (const [platform, source] of [['sensor', sensorSource], ['binary_sensor', binarySource]]) {
  for (const key of keysOf(source)) {
    for (const [lang, dict] of Object.entries(dictionaries)) {
      const entry = dict.entity && dict.entity[platform] && dict.entity[platform][key];
      assert.ok(entry, `${lang}: липсва entity.${platform}.${key}`);
      assert.ok(String(entry.name || '').trim(), `${lang}: entity.${platform}.${key}.name е празно`);
      assert.equal(URL_WITH_DOMAIN.test(String(entry.name)), false, `${lang}: име с URL в entity.${platform}.${key}`);
    }
  }
}

// 2г. Enum-обектите: всяка стойност от `options=[...]` трябва да има превод на състоянието.
// Без него Home Assistant показва суровата стойност („mismatch“) вместо текст.
const enumBlocks = [...sensorSource.matchAll(/key="([a-z_0-9]+)",\s*\n\s*translation_key="([a-z_0-9]+)",\s*\n\s*device_class=SensorDeviceClass\.ENUM,\s*\n\s*options=\[([^\]]+)\]/g)];
// Самоохрана: ако описанията се пренаредят и шаблонът спре да хваща, проверката не бива
// да минава „на празно“ — броят enum-обекти се сверява с броя `device_class=SensorDeviceClass.ENUM`.
assert.equal(
  enumBlocks.length,
  (sensorSource.match(/device_class=SensorDeviceClass\.ENUM/g) || []).length,
  'проверката за enum-преводи не хваща всички enum-обекти в sensor.py',
);
for (const block of enumBlocks) {
  const [, , translationKey, options] = block;
  const states = [...options.matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);
  assert.ok(states.length >= 2, 'enum без стойности: ' + translationKey);
  for (const [lang, dict] of Object.entries(dictionaries)) {
    const entry = dict.entity.sensor[translationKey] || {};
    for (const state of states) {
      assert.ok(
        entry.state && String(entry.state[state] || '').trim(),
        `${lang}: липсва превод на състоянието „${state}“ за ${translationKey}`,
      );
    }
  }
}

// 2д. Грешките, които flow-ът може да върне, съществуват в речниците — и обратното:
// ключ в `config.error`, който никой не връща, е мъртъв текст.
const flowSource = read(path.join(CC, 'config_flow.py'));
const raised = new Set([
  ...[...flowSource.matchAll(/errors\[[^\]]+\]\s*=\s*"([a-z_0-9]+)"/g)].map((m) => m[1]),
  ...[...flowSource.matchAll(/return\s+"([a-z_0-9]+)"/g)].map((m) => m[1]),
]);
for (const key of raised) {
  assert.ok(strings.config.error[key], 'config_flow връща грешка без превод: ' + key);
}
const declared = Object.keys(strings.config.error);
const dead = declared.filter((key) => !raised.has(key));
assert.deepEqual(dead, [], 'превод за грешка, която flow-ът не връща: ' + dead.join(', '));

// ── 3. Файлове на интеграцията ──────────────────────────────────────────────
assert.ok(fs.existsSync(path.join(CC, '__init__.py')), 'липсва __init__.py');
assert.ok(fs.existsSync(path.join(CC, 'manifest.json')), 'липсва manifest.json');
// HACS изисква икона: `brand/icon.png` (ново) или `icon.png` в корена на интеграцията.
const brandIcon = [path.join(CC, 'brand', 'icon.png'), path.join(CC, 'icon.png')].find((file) => fs.existsSync(file));
assert.ok(brandIcon, 'липсва икона за HACS (brand/icon.png или icon.png)');
for (const brand of ['icon.png', 'logo.png']) {
  const file = path.join(CC, 'brand', brand);
  if (!fs.existsSync(file)) continue;
  const header = fs.readFileSync(file).subarray(0, 8);
  assert.equal(header.toString('hex'), '89504e470d0a1a0a', 'brand/' + brand + ' е истински PNG');
}
// Нищо, което не бива да пътува до потребителя.
const strays = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['__pycache__', '.pytest_cache', 'tests', 'node_modules'].includes(entry.name)) strays.push(full);
      else walk(full);
      continue;
    }
    if (/\.(pyc|pyo|log)$/.test(entry.name) || entry.name.startsWith('.')) strays.push(full);
  }
};
walk(CC);
assert.deepEqual(strays.map((file) => path.relative(ROOT, file)), [], 'излишни файлове в интеграцията');

// ── 4. hacs.json ────────────────────────────────────────────────────────────
const hacs = json(path.join(ROOT, 'hacs.json'));
assert.ok(String(hacs.name || '').trim(), 'hacs.json: липсва name');
assert.match(String(hacs.homeassistant || ''), /^\d{4}\.\d+(\.\d+)?$/, 'hacs.json: homeassistant е версия');
assert.equal(hacs.content_in_root, false, 'hacs.json: интеграцията е в custom_components/, не в корена');
assert.ok(Array.isArray(hacs.country) && hacs.country.length, 'hacs.json: посочена е държава');
// Минималната версия на HA трябва да покрива това, което кодът ползва.
const minimum = hacs.homeassistant.split('.').map(Number);
const atLeast = (year, month) => minimum[0] > year || (minimum[0] === year && minimum[1] >= month);
assert.ok(atLeast(2024, 4), 'кодът ползва `ConfigFlowResult` (HA 2024.4+) — минимумът трябва да е поне 2024.4');
assert.ok(atLeast(2023, 7), 'кодът ползва `entry.async_on_unload` и `async_forward_entry_setups` (HA 2023.7+)');

// ── 5. Внос: само стандартна библиотека и Home Assistant ────────────────────
// Интеграцията не бива да тегли пакети, които не са в `requirements` — иначе HA я зарежда
// и пада с ImportError при първото стартиране.
const ALLOWED_THIRD_PARTY = new Set(['homeassistant', 'voluptuous', 'aiohttp']);
const STDLIB = new Set([
  '__future__', 'asyncio', 'base64', 'collections', 'contextlib', 'dataclasses', 'datetime', 'hashlib',
  'json', 'logging', 'os', 'pathlib', 're', 'secrets', 'time', 'typing', 'urllib', 'uuid', 'ssl',
]);
const imported = [];
for (const name of fs.readdirSync(CC).filter((file) => file.endsWith('.py'))) {
  const source = read(path.join(CC, name));
  for (const match of source.matchAll(/^\s*(?:from|import)\s+([a-zA-Z_][\w.]*)/gm)) {
    const root = match[1].split('.')[0];
    if (root === '' || root.startsWith('_')) continue;
    imported.push([name, root]);
  }
}
const foreign = imported.filter(([, root]) => {
  if (root === 'homeassistant' || ALLOWED_THIRD_PARTY.has(root) || STDLIB.has(root)) return false;
  // Локалните модули на интеграцията (`from .const import …`) не влизат тук — те започват с точка.
  return !fs.existsSync(path.join(CC, root + '.py')) && !fs.existsSync(path.join(CC, root));
});
assert.deepEqual(
  [...new Set(foreign.map(([file, root]) => file + ' → ' + root))],
  [],
  'внос на пакет, който не е в requirements (HA ще падне с ImportError)',
);

// ── 5б. Компонент на HA, който кодът ползва, е обявен в манифеста ───────────
// Официалният hassfest връща `[DEPENDENCIES] Using component X but it's not in
// 'dependencies' or 'after_dependencies'`. Точно това се случи с `hassio` в 0.69.192: кодът
// внасяше `homeassistant.components.hassio`, а манифестът обявяваше празен
// `after_dependencies` — и HACS валидаторът върна изданието след публикуване.
const declaredComponents = new Set([...(manifest.dependencies || []), ...(manifest.after_dependencies || [])]);
const usedComponents = new Map();
for (const name of fs.readdirSync(CC).filter((file) => file.endsWith('.py'))) {
  const source = read(path.join(CC, name));
  for (const match of source.matchAll(/homeassistant\.components\.([a-z_][\w]*)/g)) {
    if (!usedComponents.has(match[1])) usedComponents.set(match[1], []);
    usedComponents.get(match[1]).push(name);
  }
}
const undeclared = [...usedComponents]
  .filter(([component]) => component !== 'http' && !declaredComponents.has(component))
  // Платформените файлове на самата интеграция (`sensor.py` → `homeassistant.components.sensor`)
  // не се обявяват като зависимост — те са собствени платформи, не чужд компонент.
  .filter(([component]) => !fs.existsSync(path.join(CC, component + '.py')))
  .map(([component, files]) => component + ' (' + [...new Set(files)].join(', ') + ')');
assert.deepEqual(
  undeclared,
  [],
  'компонент на HA се ползва, но липсва в dependencies/after_dependencies на манифеста',
);

console.log(
  'PASS hassfest-local: манифест с ' + Object.keys(manifest).length + ' ключа (всички позволени) · ' +
  usedComponents.size + ' ползвани HA компонента, всички обявени · ' +
  stringsOf(dictionaries.en).length + ' низа × 2 езика без URL и без празни · ' +
  keysOf(sensorSource).length + ' сензора + ' + keysOf(binarySource).length + ' binary с преводи · ' +
  raised.size + ' грешки на flow-а съвпадат с речника · икона ' + path.basename(brandIcon) + ' · ' +
  'hacs.json ≥ ' + hacs.homeassistant + ' · ' + new Set(imported.map(([, root]) => root)).size + ' вноса, всички позволени',
);
