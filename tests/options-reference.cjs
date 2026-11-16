'use strict';
// СПРАВОЧНИКЪТ НА ОПЦИИТЕ Е ГЕНЕРИРАН, НЕ ПИСАН (D3 от `DOCS_AND_OPTIONS_STRUCTURE.md`).
//
// Защо има тест: 44 опции се описваха на пет места (config.yaml `options:` и `schema:`, три
// превода, таблиците в `start.js`, README-то, панела). Ръчно поддържан справочник се разминава
// тихо — точно както таблицата в README-то преди `settings-defaults.cjs` (две от четирите ѝ
// таблици бяха неверни). Затова документът се строи от ЕДИНСТВЕНИЯ източник и тестът пада, ако
// някой го е редактирал на ръка.
//
// Тестът пада и в трите посоки, които имат значение:
//   1. документът е различен от изхода на генератора (ръчна редакция или забравено пускане);
//   2. опция в `config.yaml` няма ред в превода (тогава справочникът би бил непълен);
//   3. преименуване между ключ и променлива съществува, без да е записано в таблицата (мълчалив
//      дълг, който прави проверката „всяка опция има читател“ невъзможна).
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'options-reference.cjs');
const { readOptions, readSchema, readTranslations, compose, envOf, ALIASES, OUT } = require(SCRIPT);
const { lineFor } = require(path.join(ROOT, 'scripts', 'docs-class.cjs'));

// ── 1. Документът е точно изходът на генератора ──────────────────────────────
const check = spawnSync(process.execPath, [SCRIPT, '--check'], { cwd: ROOT, encoding: 'utf8' });
assert.equal(check.status, 0, 'справочникът е актуален (пусни `node scripts/options-reference.cjs`): ' + (check.stdout || '') + (check.stderr || ''));
assert.match(check.stdout, /актуален/, 'проверката казва какво е проверила');

const doc = fs.readFileSync(OUT, 'utf8');
assert.ok(doc.startsWith('# Справочник на глобалните опции'), 'документът започва със заглавието си');
assert.ok(doc.includes(lineFor('02_TO_BE_ARCHITECTURE/OPTIONS_REFERENCE.md')), 'документът носи реда за клас от нормата');

// ── 2. Броят идва от config.yaml, не от константа ────────────────────────────
const cfg = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'config.yaml'), 'utf8');
const options = readOptions(cfg);
const schema = readSchema(cfg);
assert.ok(options.length >= 40, 'опциите се броят от конфигурацията: ' + options.length);
assert.equal(schema.size, options.length, 'всяка опция има тип в `schema:` (иначе Supervisor не я показва)');

for (const { key } of options) {
  assert.ok(doc.includes('`' + key + '`'), 'опцията ' + key + ' е в справочника');
}

// ── 3. Типът се превежда на човешки, но не измисля ───────────────────────────
const { describeType } = require(SCRIPT);
assert.match(describeType('str?'), /низ.*по избор/, 'низ по избор');
assert.match(describeType('int(0,8192)?'), /цяло 0…8192/, 'границите влизат в описанието');
assert.match(describeType('list(classic|modern)'), /classic · modern/, 'стойностите на списък се изреждат');
assert.match(describeType('bool'), /задължителна/, 'без `?` опцията е задължителна');

// ── 4. Преименуванията са записани, а не скрити ──────────────────────────────
assert.equal(ALIASES.backup_folder.env, 'BACKUP_DIR', 'историческото преименуване е в таблицата');
assert.equal(envOf('backup_folder'), 'BACKUP_DIR', 'името на променливата идва от таблицата');
assert.equal(envOf('portal_skin'), 'PORTAL_SKIN', 'по подразбиране името е UPPER(ключ)');
assert.ok(Object.keys(ALIASES).length <= 6, 'изключенията са малко и всяко има причина: ' + Object.keys(ALIASES).length);
assert.ok(doc.includes('## 3. Преименувания'), 'таблицата е и в документа, не само в кода');

// ── 5. Липсващ превод е ГРЕШКА, не празно място ──────────────────────────────
const translations = readTranslations(fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'translations', 'bg.yaml'), 'utf8'));
assert.equal(translations.size, options.length, 'всяка опция има превод: ' + translations.size);
const short = new Map(translations);
short.delete(options[0].key);
assert.throws(
  () => compose({ options, schema, translations: short, version: '0.0.0' }),
  /преводът липсва/,
  'липсващ превод спира генератора, вместо да даде празна клетка',
);

console.log(
  `PASS options-reference: ${options.length} опции · ${Object.keys(ALIASES).length} преименувания · ` +
    'документът е точно изходът на генератора · липсващ превод = грешка',
);
