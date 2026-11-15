'use strict';
// СЪВМЕСТИМОСТ С HOME ASSISTANT И С МАРКЕТПЛЕЙСА (0.69.210).
//
// Защо има тест: `hassfest` и HACS action минават зелено, но HACS action дава предупреждение
// „The integration manifest has no categories“. Категорията е това, по което новият
// маркетплейс (и HACS) подрежда интеграцията — без нея картата ѝ няма раздел. Тестът пази
// измереното правило, а не наличието на поле:
//   • `categories` е 1–3 стойности, уникални, във формат `раздел` или `раздел.подраздел`;
//   • всяка стойност е от ОФИЦИАЛНИЯ списък на Home Assistant (28 раздела, взети от
//     `homeassistant/generated/integration_categories.json` в home-assistant/core);
//   • версията в манифеста съвпада с `config.yaml` (един източник на истина);
//   • `hacs.json` не обявява по-нова долна граница от тази, която кодът реално ползва
//     (`entry.runtime_data` е 2024.6+ — виж `__init__.py`);
//   • преводите, които hassfest иска, съществуват и `en.json` покрива `strings.json`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const integration = path.join(root, 'custom_components', 'hapi_enterprise');
const manifest = JSON.parse(fs.readFileSync(path.join(integration, 'manifest.json'), 'utf8'));
const hacs = JSON.parse(fs.readFileSync(path.join(root, 'hacs.json'), 'utf8'));

// Официалните раздели на Home Assistant (измерени от core, 2026-11-15).
const OFFICIAL = new Set([
  'ai_voice', 'appliances_cleaning', 'blinds_curtains', 'buttons_remotes', 'climate',
  'computers_network', 'diy_makers', 'energy', 'finance', 'garden_plants', 'health_wellbeing',
  'helpers', 'hubs_protocols', 'lighting', 'local_services', 'media_entertainment',
  'messaging_notifications', 'news_social_media', 'other_ecosystems', 'pets', 'plugs_switches',
  'presence_location', 'productivity_information', 'security_safety', 'sensors',
  'vehicles_transport', 'water', 'weather_alerts',
]);

// ── 1. Категорията: форматът, който hassfest проверява (`manifest.py`) ──────
assert.ok(Array.isArray(manifest.categories), 'manifest.json: липсва categories (HACS дава предупреждение без него)');
assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3, 'categories: 1–3 стойности (hassfest: Length(min=1, max=3))');
assert.equal(new Set(manifest.categories).size, manifest.categories.length, 'categories: без повторения (hassfest: Unique())');
for (const value of manifest.categories) {
  assert.match(value, /^[a-z0-9_]+(\.[a-z0-9_]+)?$/, 'categories: невалиден формат „' + value + '“ (очаква се `раздел` или `раздел.подраздел`)');
  const top = value.split('.')[0];
  assert.ok(OFFICIAL.has(top), 'categories: „' + value + '“ не е от официалния списък на Home Assistant');
}
// Документното хранилище е „Productivity & information → Documents & photos“.
assert.ok(
  manifest.categories.includes('productivity_information.documents_photos'),
  'категорията трябва да е documents_photos: ' + manifest.categories.join(', '),
);

// ── 2. Версията: един източник на истина ────────────────────────────────────
const configYaml = fs.readFileSync(path.join(root, 'hapi_enterprise', 'config.yaml'), 'utf8');
const addonVersion = (configYaml.match(/^version:\s*"([^"]+)"/m) || [])[1];
assert.equal(manifest.version, addonVersion, 'manifest.json и config.yaml трябва да носят една версия');

// ── 3. Долната граница на HA: обявената не бива да е по-ниска от ползваната ─
const initPy = fs.readFileSync(path.join(integration, '__init__.py'), 'utf8');
assert.match(initPy, /entry\.runtime_data\s*=/, 'интеграцията ползва `entry.runtime_data`');
const [minMajor, minMinor] = String(hacs.homeassistant).split('.').map(Number);
assert.ok(
  minMajor > 2024 || (minMajor === 2024 && minMinor >= 6),
  'hacs.json: homeassistant трябва да е ≥ 2024.6.0, защото `entry.runtime_data` е от 2024.6; сега е ' + hacs.homeassistant,
);

// ── 4. Преводите: hassfest иска `strings.json` + `translations/en.json` ─────
const stringsPath = path.join(integration, 'strings.json');
const enPath = path.join(integration, 'translations', 'en.json');
assert.ok(fs.existsSync(stringsPath), 'липсва strings.json');
assert.ok(fs.existsSync(enPath), 'липсва translations/en.json (hassfest го изисква)');
const strings = JSON.parse(fs.readFileSync(stringsPath, 'utf8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
for (const key of Object.keys(strings)) {
  assert.ok(key in en, 'translations/en.json не покрива раздел „' + key + '“ от strings.json');
}

console.log(
  'PASS ha-marketplace: категория ' + manifest.categories.join(', ') + ' от официалния списък · версия = config.yaml · ' +
  'долна граница ' + hacs.homeassistant + ' ≥ 2024.6 · преводи en покриват strings.json',
);
