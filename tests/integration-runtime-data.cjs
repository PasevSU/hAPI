'use strict';
// СЪСТОЯНИЕТО НА ВПИСВАНЕТО ЖИВЕЕ В `entry.runtime_data`, НЕ В `hass.data[DOMAIN]`.
//
// Защо: до 0.69.152 интеграцията пазеше координатора в речник на `hass.data`, индексиран по
// `entry_id`. Работи, но е наследеният модел със своите капани — при презареждане ключът
// остава, ако някой забрави да го изчисти; платформите трябваше да знаят как е устроен
// речникът; и при две вписвания животът на данните не следва живота на вписването.
// `ConfigEntry.runtime_data` (2024.6+) прави точно това, за което речникът се ползваше.
//
// Тестът пази ЕДНО правило в двете посоки: няма `hass.data[DOMAIN]` в интеграцията и има
// `entry.runtime_data` на всяко място, което преди е четело от речника. Така „миграцията“ не
// може да е наполовина — точно това би оставило сензорите без координатор след рестарт.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'custom_components', 'hapi_enterprise');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.py')).sort();
const source = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
// Проверява се КОДЪТ, не коментарите: обяснението „дотук координаторът се пазеше в
// `hass.data`“ не е нарушение — точно то документира миграцията.
const code = (name) =>
  source(name)
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');

// ── 1. Никъде не се държи състояние в `hass.data` ───────────────────────────
const offenders = files.filter((f) => /hass\.data/.test(code(f)));
assert.deepEqual(offenders, [], 'hass.data е наследеният модел — ползвай entry.runtime_data: ' + offenders.join(', '));

// ── 2. Координаторът се слага и чете през вписването ────────────────────────
const init = source('__init__.py');
assert.match(init, /entry\.runtime_data = coordinator/, 'async_setup_entry трябва да слага координатора в entry.runtime_data');
assert.match(init, /getattr\(entry, "runtime_data", None\)/, 'async_update_entry чете координатора от вписването');
// Разтоварването не бива да „чисти“ речник: runtime_data се освобождава само.
assert.match(
  init,
  /async def async_unload_entry[\s\S]{0,400}?return await hass\.config_entries\.async_unload_platforms\(entry, PLATFORMS\)/,
  'async_unload_entry само разтоварва платформите',
);

for (const platform of ['sensor.py', 'binary_sensor.py', 'diagnostics.py']) {
  assert.match(
    source(platform),
    /entry\.runtime_data/,
    platform + ' трябва да чете координатора от entry.runtime_data',
  );
}

// ── 3. Минимумът на HA го позволява ─────────────────────────────────────────
// `runtime_data` съществува от 2024.6; ако някога минимумът падне, този ред ще го хване.
const hacs = JSON.parse(fs.readFileSync(path.join(root, 'hacs.json'), 'utf8'));
const minHa = String(hacs.homeassistant || '');
assert.match(minHa, /^\d{4}\.\d+\.\d+$/, 'hacs.json трябва да обявява минимална версия на HA');
const [year, minor] = minHa.split('.').map(Number);
assert.ok(year > 2024 || (year === 2024 && minor >= 6), 'runtime_data иска HA ≥ 2024.6, а минимумът е ' + minHa);

console.log('PASS integration-runtime-data: ' + files.length + ' Python модула · състоянието е в entry.runtime_data · без hass.data · минимум HA ' + minHa);
