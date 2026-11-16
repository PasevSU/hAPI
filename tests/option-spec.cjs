'use strict';
// ДЕСКРИПТОРЪТ НА ОПЦИИТЕ И `config.yaml` СА ЕДНО (O1 от `DOCS_AND_OPTIONS_STRUCTURE.md`).
//
// Защо има тест: 44 опции се описват в `config.yaml` (два блока — `options:` и `schema:`), в три
// превода, в четири стила `option → env` в `start.js`, в README-то и в панела. Никой гейт не
// проверяваше дали петте места казват едно и също, а преименуванията (`backup_folder → BACKUP_DIR`)
// се знаеха само от кода. Затова „всяка опция има читател“ беше непроверимо.
//
// Тук дескрипторът (`hapi_enterprise/option-spec.js`) се сверява с ЕДИНСТВЕНИЯ източник:
//   ключове — точно същите, без излишни и без липсващи;
//   тип — точно типът от `schema:` (иначе Supervisor рисува друго поле);
//   подразбиране — точно стойността от `options:`;
//   env — `UPPER(ключ)`, освен изрично преименуваните (всяко с причина).
//
// Тестът пада и при ДВЕ преименувания с едно и също име на променлива (иначе две опции пишат в
// един env и едната мълчаливо губи).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { OPTIONS, RENAMED, byKey, envOf } = require(path.join(ROOT, 'hapi_enterprise', 'option-spec.js'));
const { readOptions, readSchema } = require(path.join(ROOT, 'scripts', 'options-reference.cjs'));

const cfg = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'config.yaml'), 'utf8');
const declared = readOptions(cfg);
const schema = readSchema(cfg);

// ── 1. Същите ключове, в същия ред ──────────────────────────────────────────
const specKeys = OPTIONS.map((o) => o.key);
const cfgKeys = declared.map((o) => o.key);
assert.deepEqual(specKeys, cfgKeys, 'дескрипторът изрежда ТОЧНО опциите от config.yaml (и в същия ред)');
assert.ok(specKeys.length >= 40, 'опциите се броят от конфигурацията: ' + specKeys.length);

// ── 2. Тип и подразбиране — без разминаване ─────────────────────────────────
for (const entry of OPTIONS) {
  const type = schema.get(entry.key);
  assert.ok(type, entry.key + ': има тип в `schema:`');
  assert.equal(entry.type, type, entry.key + ': типът в дескриптора е същият като в `schema:`');
  const cfgValue = declared.find((o) => o.key === entry.key).value;
  // YAML пише низовете в кавички и екранира вътрешните (`"{\"a\":\"b\"}"`), а дескрипторът е
  // JavaScript — затова се сравнява СТОЙНОСТТА: кавичките падат, екранирането се разгръща.
  const normalised = String(cfgValue)
    .replace(/^(["'])(.*)\1$/, '$2')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
  assert.equal(
    String(entry.def),
    normalised,
    entry.key + ': подразбирането в дескриптора е същото като в `options:`',
  );
}

// ── 3. Име на променливата: правило или изрично изключение ──────────────────
const seen = new Map();
for (const entry of OPTIONS) {
  const expected = RENAMED[entry.key] ? entry.env : entry.key.toUpperCase();
  assert.equal(entry.env, expected, entry.key + ': env е UPPER(ключ) или изрично преименувано');
  assert.equal(envOf(entry.key), entry.env, entry.key + ': envOf дава същото име');
  assert.ok(!seen.has(entry.env), `${entry.key}: env ${entry.env} вече се ползва от ${seen.get(entry.env)}`);
  seen.set(entry.env, entry.key);
}

// ── 4. Преименуванията съществуват и имат причина ───────────────────────────
for (const [key, why] of Object.entries(RENAMED)) {
  assert.ok(byKey(key), `преименуването ${key} сочи съществуваща опция`);
  assert.ok(typeof why === 'string' && why.length > 10, `${key}: причината е изречение, не „да“`);
}

// ── 5. Липсваща опция не се измисля ────────────────────────────────────────
assert.equal(byKey('няма_такава_опция'), null, 'непознат ключ дава null, а не измислен запис');
assert.equal(envOf('няма_такава_опция'), 'НЯМА_ТАКАВА_ОПЦИЯ'.toUpperCase(), 'envOf пада към UPPER(ключ)');

console.log(
  `PASS option-spec: ${OPTIONS.length} опции · ключове, типове и подразбирания съвпадат с config.yaml · ` +
    `${Object.keys(RENAMED).length} преименувания с причина · уникални имена на променливи`,
);
