'use strict';
// ИДЕНТИФИКАТОРИ И ПЛОСЪК ВИД НА `configuration.yaml` (план 26, §1).
//
// Какво пази този тест: всяко нещо в портала има идентификатор `{{portal}}-{{portal_name}}-001` —
// ключът на портала, името в машинен вид и пореден номер с ТРИ цифри. Номерът само расте и не се
// преизползва (изтрит обект оставя празнина). Опциите са ПЛОСКИ имена, всяка присъства винаги, а
// `off:` изключва опция, без да губи стойността ѝ. Старият групиран файл се разбира и се превежда.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const config = require(path.join(__dirname, '..', 'hapi_enterprise', 'portal-config.js'));

// ── 1. Трите части и машинното име ────────────────────────────────────────────
assert.equal(config.machineName('Семейство Па Бе Пе'), 'semeystvo-pa-be-pe', 'кирилицата става латиница с тирета');
assert.equal(config.isGrouped({ portal: { slug: 'x' } }), true, 'старият формат се разпознава по групата `portal:`');
assert.equal(config.isGrouped({ slug: 'x' }), false, 'плоският формат не е групиран');
assert.equal(config.makeId('test001', 'Test 001', 1), 'test001-test-001-001', 'ключ · машинно име · три цифри');
assert.equal(config.makeId('test001', 'Семейство Па Бе Пе', 1), 'test001-semeystvo-pa-be-pe-001', 'кирилицата се транслитерира');
assert.equal(config.makeId('dogovori', '  Лични   документи  ', 7), 'dogovori-lichni-dokumenti-007', 'интервалите стават едно тире');
assert.equal(config.makeId('x1', '???', 1), 'x1-portal-001', 'име без латиница не оставя празна част');
assert.equal(config.makeId('x1', 'Договор', 1000), 'x1-dogovor-999', 'номерът е до 999 — четвърта цифра не се пише');
assert.match(config.makeId('x1', 'Договор', 1), /-\d{3}$/, 'винаги точно три цифри');

// Номерът гледа ИЗДАДЕНИТЕ, не броя: изтритият -003 не освобождава реда си.
assert.equal(config.nextNumber(['test001-a-001', 'test001-b-004', 'test001-c-002']), 5, 'следващият е най-големият + 1');
assert.equal(config.nextNumber([]), 1, 'празен регистър започва от 1');
assert.equal(config.nextNumber(['лош', 'test001-a-xyz']), 1, 'невалидните не броят');

// ── 2. Началният файл носи идентификатора и ПЛОСКИТЕ опции ────────────────────
const initial = config.initial({ slug: 'test001', title: 'Test 001' });
assert.equal(initial.id, 'test001-test-001-001', 'началният файл има идентификатор');
assert.equal(initial.portal, undefined, 'няма група `portal:`');
assert.equal(initial.access, undefined, 'няма група `access:`');
assert.equal(initial.qr, undefined, 'няма група `qr:`');
assert.deepEqual(initial.off, [], '`off:` е празен списък, не липсващ ключ');
assert.deepEqual(config.validate(initial, { slug: 'test001' }), [], 'началният файл минава проверката');

// Всяка опция е на едно ниво и присъства — иначе файлът не казва какво се прилага.
for (const key of config.OPTION_KEYS) {
  assert.ok(Object.prototype.hasOwnProperty.call(initial, key), 'опцията „' + key + '“ присъства винаги');
}
const missing = JSON.parse(JSON.stringify(initial));
delete missing.ui_columns;
assert.ok(
  config.validate(missing, { slug: 'test001' }).some((i) => i.path === 'ui_columns'),
  'липсваща опция е грешка, не „подразбиране“',
);

// ── 3. `off:` изключва, без да губи стойността ────────────────────────────────
const off = { ...initial, qr_style: 'plain', off: ['qr_style'] };
assert.deepEqual(config.validate(off, { slug: 'test001' }), [], 'изключена опция е валидна');
assert.equal(config.isOff(off, 'qr_style'), true, 'опцията е изключена');
assert.equal(off.qr_style, 'plain', 'стойността остава за връщане');
assert.equal(config.effective(off).qr_style, 'plain', 'ефективната стойност не се губи — изключването е отделен флаг');

// ── 4. Стар групиран файл се разбира и записва ПЛОСКО ────────────────────────
const LEGACY = [
  'version: 1',
  'revision: 4',
  'updated_at: "2026-11-16T10:00:00Z"',
  'portal:',
  '  slug: dogovor',
  '  title: Договор',
  '  visibility: public',
  'access:',
  '  mode: free',
  'qr:',
  '  style: plain',
  'folders:',
  '  defaults:',
  '    visible: false',
  '  items:',
  '    "/Договори":',
  '      locked: true',
  '      reason: лични данни',
  'files: []',
  '',
].join('\n');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-config-ids-'));
const legacyFile = path.join(dir, 'dogovor', 'configuration.yaml');
fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
fs.writeFileSync(legacyFile, LEGACY, 'utf8');
try {
  const read = config.read(legacyFile, { slug: 'dogovor' });
  assert.equal(read.legacy, true, 'старият файл е разпознат като групиран');
  assert.deepEqual(read.problems, [], 'старият файл се превежда без проблеми: ' + JSON.stringify(read.problems));
  assert.equal(read.data.name, 'Договор', '`portal.title` става `name`');
  assert.equal(read.data.access_mode, 'free', '`access.mode` става `access_mode`');
  assert.equal(read.data.folders_default_visible, false, 'подразбирането на папките е плоска опция');
  assert.deepEqual(read.data.folders, { '/Договори': { locked: true, reason: 'лични данни' } }, 'флаговете по път остават данни');
  assert.equal(read.data.id, 'dogovor-dogovor-001', 'на стария портал се издава идентификатор');

  const written = config.write(legacyFile, { notes: 'след превода' }, { slug: 'dogovor' });
  assert.equal(written.revision, 5, 'ревизията продължава от диска');
  const text = fs.readFileSync(legacyFile, 'utf8');
  assert.equal(/^portal:/m.test(text), false, 'записаният файл е ПЛОСЪК');
  assert.match(text, /^notes: след превода$/m, 'промяната е записана');
  assert.match(text, /^access_mode: free$/m, 'преведената опция е запазена');
  assert.match(text, /^folders_default_visible: false$/m, 'подразбирането е запазено');
  assert.match(text, /^id: dogovor-dogovor-001$/m, 'идентификаторът не се издава наново');
  assert.deepEqual(config.read(legacyFile, { slug: 'dogovor' }).problems, [], 'плоският файл се чете обратно');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(
  'PASS portal-config-ids: {{portal}}-{{portal_name}}-001 с три цифри · кирилица → латиница · номерът не се преизползва · ' +
    'плоски опции без групи · `off:` изключва без загуба · стар групиран файл се превежда и записва плоско',
);
