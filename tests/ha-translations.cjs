'use strict';
// 0.69.99 — Преводите трябва да са ПАРИТЕТНИ с `strings.json`.
//
// Home Assistant взима текста по ключ: `config.error.<key>`, `entity.sensor.<key>.name`,
// `config.step.<key>.title`. Липсва ли ключ в `translations/<lang>.json`, интерфейсът показва
// ПРАЗНО място — без грешка, без предупреждение. Точно така се появи и „празно съобщение“ при
// грешка в config flow-а, преди да има тест.
//
// Затова тук се сравняват ПЪЛНИТЕ пътища на ключовете в трите файла, в двете посоки:
//   • ключ в strings.json, липсващ в превод → празен текст за този език;
//   • ключ в превод, липсващ в strings.json → мъртъв превод, който никой не вика.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INTEGRATION = path.join(__dirname, '..', 'custom_components', 'hapi_enterprise');

/** Всички пътища на листата в един JSON обект: `a.b.c` → стойност. */
function flat(value, prefix = '', out = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flat(child, prefix ? prefix + '.' + key : key, out);
    }
    return out;
  }
  out[prefix] = value;
  return out;
}

function load(file) {
  return flat(JSON.parse(fs.readFileSync(path.join(INTEGRATION, file), 'utf8')));
}

function missing(from, into, label) {
  const absent = Object.keys(from).filter((key) => !(key in into));
  assert.deepEqual(absent, [], label + ' липсват ключове: ' + absent.join(', '));
}

(async () => {
  const strings = load('strings.json');
  assert.ok(Object.keys(strings).length > 50, 'strings.json не е празен: ' + Object.keys(strings).length + ' ключа');

  for (const lang of ['en', 'bg']) {
    const file = 'translations/' + lang + '.json';
    const translated = load(file);
    missing(strings, translated, file + ':');
    missing(translated, strings, file + ' (мъртви ключове):');
  }

  // Текстовете не бива да са празни: `""` изглежда като липсващ ключ в интерфейса.
  for (const [key, value] of Object.entries(strings)) {
    if (key.endsWith('.title') || key.endsWith('.name') || key.includes('.error.') || key.includes('.abort.')) {
      assert.ok(String(value).trim().length > 0, 'празен текст за ' + key);
    }
  }

  // Ключовете, които flow-ът връща, съществуват в преводите — иначе HA показва празно.
  const configFlow = fs.readFileSync(path.join(INTEGRATION, 'config_flow.py'), 'utf8');
  const returned = [...configFlow.matchAll(/return\s+"(invalid_[a-z_]+|[a-z_]+)"\s*$/gm)].map((m) => m[1]);
  const known = new Set(Object.keys(strings).filter((key) => key.startsWith('config.error.')).map((key) => key.split('.').pop()));
  for (const key of new Set(returned)) {
    assert.ok(known.has(key), 'config_flow връща „' + key + '“, но няма такъв ключ в преводите');
  }

  // Заглавието на изданието се извежда от workflow-а — иначе всяко издание се казва „v0.69.99“
  // и човек трябва да го преименува на ръка.
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(workflow, /id: release_name/, 'workflow-ът изчислява име на изданието');
  assert.match(workflow, /name: \$\{\{ steps\.release_name\.outputs\.value \}\}/, 'и го подава към release-а');

  console.log('PASS ha-translations: ' + Object.keys(strings).length + ' ключа · en и bg съвпадат с strings.json в двете посоки · няма празни текстове · ключовете от config_flow съществуват · workflow-ът дава име на изданието');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
