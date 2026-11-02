'use strict';
// Схемите в `config/schemas/` са ПУБЛИКУВАН договор: по тях се строи валидатор отвън. Затова
// те трябва да описват това, което кодът наистина произвежда — иначе договорът лъже, а никой не
// разбира, защото нищо не го сверява. На 0.69.87 измереното беше точно такова разминаване:
// `package_manifest.schema.json` искаше `schema_version: "1.0"`, `package_id` от вида `RPT-…`,
// поле `entries` и забраняваше всичко извън себе си, а `packager.js` пише `schema_version:
// "1.1"`, 24-знаков `package_id`, поле `files` и още пет полета — тоест реалният индекс не
// минаваше собствения си договор по НИТО ЕДНО задължително поле.
//
// Затова тук се проверява ВРЪЗКАТА, не текстът:
//   1. истински пакет от `packager.js` → `PACKAGE_INDEX.json` минава `package_manifest.schema.json`;
//   2. истинска трансферна операция от `export-manager.createJob()` минава
//      `transfer_state.schema.json`;
//   3. третата схема (`manifest.schema.json`) се ползва от `report-manifest.js` в движение, тоест
//      се проверява там, където се строи манифестът.
//
// Валидаторът е малък и нарочно ограничен до това, което схемите ползват (type, const, enum,
// required, properties, additionalProperties, items, minItems, minProperties, minimum, maximum,
// minLength, maxLength, pattern, not). Външна библиотека не се тегли: тестовете вървят без dev
// зависимости.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const packager = require('../hapi_enterprise/packager.js');
const ooxml = require('../hapi_enterprise/ooxml.js');
const exportManager = require('../hapi_enterprise/export-manager.js');

const root = path.join(__dirname, '..');
const loadSchema = (name) => JSON.parse(fs.readFileSync(path.join(root, 'config', 'schemas', name), 'utf8'));

const TYPES = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === 'string',
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
};

/** Проверява стойност срещу схема; връща списък от оплаквания (празен = съвпада). */
function validate(value, schema, where = '$') {
  const problems = [];
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => TYPES[t] && TYPES[t](value))) problems.push(`${where}: очакван тип ${types.join('|')}`);
  }
  if ('const' in schema && value !== schema.const) problems.push(`${where}: очаквана стойност ${JSON.stringify(schema.const)}, получена ${JSON.stringify(value)}`);
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${where}: ${JSON.stringify(value)} не е от ${schema.enum.join('|')}`);
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) problems.push(`${where}: „${value}“ не отговаря на ${schema.pattern}`);
  if (TYPES.string(value)) {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) problems.push(`${where}: по-къс от ${schema.minLength}`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) problems.push(`${where}: по-дълъг от ${schema.maxLength}`);
  }
  if (TYPES.number(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) problems.push(`${where}: под минимума ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) problems.push(`${where}: над максимума ${schema.maximum}`);
  }
  if (schema.not && schema.not.pattern && typeof value === 'string' && new RegExp(schema.not.pattern).test(value)) {
    problems.push(`${where}: не бива да отговаря на ${schema.not.pattern}`);
  }
  if (TYPES.array(value) && schema.items) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) problems.push(`${where}: по-малко от ${schema.minItems} елемента`);
    value.forEach((item, i) => problems.push(...validate(item, schema.items, `${where}[${i}]`)));
  }
  if (TYPES.object(value)) {
    if (typeof schema.minProperties === 'number' && Object.keys(value).length < schema.minProperties) problems.push(`${where}: по-малко от ${schema.minProperties} полета`);
    for (const key of schema.required || []) if (!(key in value)) problems.push(`${where}: липсва задължително поле „${key}“`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties && schema.properties[key]) problems.push(...validate(item, schema.properties[key], `${where}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${where}: полето „${key}“ не е в схемата`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        problems.push(...validate(item, schema.additionalProperties, `${where}.${key}`));
      }
    }
  }
  return problems;
}

(async () => {
  // ── 1. Истинският индекс минава своята схема ─────────────────────────────
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-schema-reality-'));
  const p = packager.create({ root: tmp });
  const meta = await p.build({
    portal: { id: 'p1', slug: 'case-2026-114', title: 'Дело 2026-114', category: 'Правни дела', subject: 'посещение', flag: 'important', storage_root: '/share/case' },
    files: [{ name: 'протокол.pdf', data: Buffer.from('PDF-1') }],
    // Отказан файл: полето `excluded` се появява само тогава и трябва да е описано.
    excluded: [{ name: 'чернова.docx', size: 10, reason: 'FREE' }],
  });
  const zip = ooxml.unzip(fs.readFileSync(path.join(p.dir, `${meta.id}.zip`)));
  const index = JSON.parse(zip.get('PACKAGE_INDEX.json')().toString('utf8'));
  const packageProblems = validate(index, loadSchema('package_manifest.schema.json'), 'PACKAGE_INDEX');
  assert.deepEqual(packageProblems, [], 'PACKAGE_INDEX.json трябва да минава собствената си схема');

  // ── 2. Истинската трансферна операция минава своята схема ────────────────
  const job = exportManager.createJob({ mode: 'verified' }, { operationId: 'OP-PROBE-0001', now: Date.now() });
  const transferProblems = validate(job, loadSchema('transfer_state.schema.json'), 'transfer_state');
  assert.deepEqual(transferProblems, [], 'състоянието на трансфера трябва да минава собствената си схема');

  // ── 3. Схемите не са измислени: изброените стойности се срещат в кода ────
  const transfer = loadSchema('transfer_state.schema.json');
  assert.deepEqual(
    [...transfer.properties.state.enum].sort(),
    [...exportManager.STATES].sort(),
    'enum-ът на състоянията съвпада със `STATES` в export-manager.js',
  );
  const rules = require('../hapi_enterprise/export-rules.js');
  assert.deepEqual(
    [...transfer.properties.on_conflict.enum].sort(),
    Object.keys(rules.ON_CONFLICT).sort(),
    'enum-ът на политиките при конфликт съвпада с `ON_CONFLICT` в export-rules.js',
  );
  const packagerSource = fs.readFileSync(path.join(root, 'hapi_enterprise', 'packager.js'), 'utf8');
  assert.ok(packagerSource.includes(`schema_version: '${loadSchema('package_manifest.schema.json').properties.schema_version.const}'`), 'schema_version в схемата съвпада с този, който пакетаторът пише');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(
    `schema-reality: PACKAGE_INDEX (${Object.keys(index).length} полета, ${index.files.length} файла) · transfer_state (${transfer.required.length} задължителни, ${transfer.properties.state.enum.length} състояния) — наред`,
  );
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
