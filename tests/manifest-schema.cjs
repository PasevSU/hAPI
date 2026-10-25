'use strict';
// `config/schemas/manifest.schema.json` — файлът, който план 18 §7 искаше, но го нямаше.
//
// Схемата съществуваше само като `schema()` в `report-manifest.js`, тоест договорът беше
// достъпен само отвътре за процеса. Тестът пази три неща:
//   • файлът е байт-байт изходът на `schema()` — ръчна редакция се губи, не се разминава;
//   • списъците в файла са СЪЩИТЕ константи, които `validate()` ползва — иначе файлът би
//     обещавал стойности, които кодът отхвърля (или обратното);
//   • `template()` (изходната точка на всеки профил) минава схемата, а манифест с формат
//     извън списъка се отхвърля и от двете — тоест двете не се разминават.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'config', 'schemas', 'manifest.schema.json');
const script = path.join(root, 'scripts', 'manifest-schema.cjs');
const pgp = require(path.join(root, 'hapi_enterprise', 'report-manifest.js'));

const cases = [];
const ok = (label) => cases.push(label);

// ── 1. Файлът съществува и е точно изходът на schema() ──────────────────────
assert.ok(fs.existsSync(file), 'config/schemas/manifest.schema.json съществува');
const disk = fs.readFileSync(file, 'utf8');
const expected = JSON.stringify(pgp.schema(), null, 2) + '\n';
assert.equal(disk, expected, 'файлът е точно изходът на schema(), без ръчни промени');
ok('файлът е байт-байт изходът на `schema()`');

// ── 2. Валиден JSON и `--check` минава върху истинския файл ─────────────────
const schema = JSON.parse(disk);
assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', 'деклариран е draft 2020-12');
assert.equal(schema.type, 'object', 'коренът е обект');
execFileSync(process.execPath, [script, '--check'], { cwd: root, stdio: 'pipe' });
ok('важи JSON и `--check` минава');

// ── 3. Списъците във файла са същите константи като в кода ──────────────────
assert.equal(schema.properties.schemaVersion.const, pgp.SCHEMA_VERSION, 'schemaVersion е константата');
assert.deepEqual(schema.properties.page.properties.format.enum, pgp.PAGE_FORMATS, 'форматите са PAGE_FORMATS');
assert.deepEqual(schema.properties.page.properties.orientation.enum, pgp.ORIENTATIONS, 'ориентациите са ORIENTATIONS');
assert.deepEqual(
  schema.properties.blocks.items.properties.type.enum,
  [...pgp.ELEMENT_TYPES, ...pgp.SYSTEM_TYPES],
  'типовете блокове са ELEMENT_TYPES + SYSTEM_TYPES',
);
assert.equal(schema.properties.blocks.maxItems, 200, 'таванът на блоковете съвпада с MAX_BLOCKS');
ok('списъците във файла са константите на кода, не копие');

// ── 4. Минимален чек на структурата: required + enum, без библиотека ────────
// Съзнателно НЕ се тегли валидатор: тук се проверява, че файлът описва това, което
// `validate()` вече пази, а не че трета библиотека разбира JSON Schema.
function problems(value, node, at) {
  const out = [];
  const type = node && node.type;
  if (type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [at + ': не е обект'];
    for (const key of node.required || []) {
      if (!(key in value)) out.push(at + ': липсва ' + key);
    }
    for (const [key, child] of Object.entries(node.properties || {})) {
      if (key in value) out.push(...problems(value[key], child, at + '.' + key));
    }
    return out;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return [at + ': не е масив'];
    if (node.minItems !== undefined && value.length < node.minItems) out.push(at + ': под minItems');
    if (node.maxItems !== undefined && value.length > node.maxItems) out.push(at + ': над maxItems');
    if (node.items) value.forEach((v, i) => out.push(...problems(v, node.items, at + '[' + i + ']')));
    return out;
  }
  if (type === 'string' && typeof value !== 'string') return [at + ': не е низ'];
  if (type === 'boolean' && typeof value !== 'boolean') return [at + ': не е boolean'];
  if (type === 'number' && typeof value !== 'number') return [at + ': не е число'];
  if (type === 'number') {
    if (node.minimum !== undefined && value < node.minimum) out.push(at + ': под minimum');
    if (node.maximum !== undefined && value > node.maximum) out.push(at + ': над maximum');
  }
  if (node.enum && !node.enum.includes(value)) return [at + ': „' + value + '“ не е в enum'];
  if (node.const !== undefined && value !== node.const) return [at + ': различно от const'];
  if (typeof value === 'string' && node.pattern && !new RegExp(node.pattern).test(value)) {
    out.push(at + ': не пасва на pattern');
  }
  return out;
}

const fresh = pgp.template('default');
assert.deepEqual(problems(fresh, schema, 'manifest'), [], 'template() минава схемата без забележки');
assert.equal(pgp.validate(fresh).ok, true, 'и validate() също го приема');
ok('template(): схемата и `validate()` приемат едно и също');

// ── 5. Разминаване се хваща в ДВЕТЕ посоки ──────────────────────────────────
const badFormat = pgp.template('default');
badFormat.page.format = 'B5';
assert.notDeepEqual(problems(badFormat, schema, 'manifest'), [], 'схемата отхвърля формат извън enum');
assert.equal(pgp.validate(pgp.normalize(badFormat)).ok, false, 'validate() също го отхвърля');
ok('формат извън списъка пада и по схемата, и по validate()');

const badType = pgp.template('default');
badType.blocks.push({ id: 'x', type: 'iframe' });
assert.notDeepEqual(problems(badType, schema, 'manifest'), [], 'схемата отхвърля непознат тип блок');
assert.equal(pgp.validate(pgp.normalize(badType)).ok, false, 'validate() също го отхвърля');
ok('непознат тип блок пада и по схемата, и по validate()');

// ── 6. `--check` хваща остарял файл, `--out` пише другаде ───────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-manifest-schema-'));
const elsewhere = path.join(tmp, 'copy.json');
execFileSync(process.execPath, [script, '--out=' + elsewhere], { cwd: root, stdio: 'pipe' });
assert.equal(fs.readFileSync(elsewhere, 'utf8'), disk, '--out пише същия байт-байт файл');
fs.writeFileSync(elsewhere, '{}\n', 'utf8');
let failed = false;
try {
  execFileSync(process.execPath, [script, '--check', '--out=' + elsewhere], { cwd: root, stdio: 'pipe' });
} catch {
  failed = true;
}
assert.equal(failed, true, '--check връща код 1 при разминаване');
fs.rmSync(tmp, { recursive: true, force: true });
ok('`--check` хваща остарял файл, `--out` пише същия байт-байт');

console.log('PASS manifest-schema: ' + cases.length + ' проверки — ' + cases.join('; '));
