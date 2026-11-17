'use strict';
// ДОГОВОР НА ФОРМАТА НА `configuration.yaml` (план 23, §4 и §25).
//
// Какво пази този тест: файлът е конфигурация, не програма — затова четецът е СТРОГ и
// ОТКАЗВА непознатото, вместо да го прескочи тихо (тихото прескачане на ключ е начинът една
// опция да изчезне, без някой да разбере). Обратният прочит е задължителен: `parse → emit →
// parse` трябва да даде БАЙТ-ИДЕНТИЧЕН текст, иначе всеки запис от панела прави шум в diff-а.
const assert = require('node:assert/strict');
const path = require('node:path');

const config = require(path.join(__dirname, '..', 'hapi_enterprise', 'portal-config.js'));

// ── 1. Обратен прочит: каноничен текст не се променя от emit ───────────────────
const SAMPLE = [
  'version: 1',
  'revision: 7',
  'updated_at: "2026-11-16T10:00:00Z"',
  'id: dogovor-dogovor-001',
  'slug: dogovor',
  'name: "Договор: 2026 / №7"',
  'visibility: private',
  'flag: none',
  'category: ""',
  'subject: ""',
  'notes: "бележка с # и : вътре"',
  'contact_id: c-1',
  'case_id: ""',
  'parent_id: ""',
  'readonly: false',
  'access_mode: key',
  'access_review_only: false',
  'access_download_requires_key: true',
  'temporary_default_ttl: 24h',
  'temporary_default_read_only: true',
  'temporary_password_required: false',
  'qr_style: frame',
  'qr_caption: url',
  'qr_levels_folder: true',
  'qr_levels_file: true',
  'qr_archive_on_change: false',
  'folders_default_visible: true',
  'folders_default_media: false',
  'folders_default_locked: false',
  'storage_subpath: ""',
  'storage_copy_to_folder: true',
  'ui_columns: 3',
  'ui_show_sizes: true',
  'audit_telemetry: true',
  'off: []',
  'folders:',
  '  "/Договори":',
  '    visible: false',
  '    media: true',
  '    locked: true',
  '    reason: лични данни',
  'files:',
  '  - id: file-000001',
  '    path: /Договори/a.pdf',
  '    size: 1024',
  '    sha256: "0000000000000000000000000000000000000000000000000000000000000001"',
  '    version: 1',
  '    access: key',
  '    listed: true',
  '    mirror: false',
  '    added: "2026-11-16T10:00:00Z"',
  '    modified: "2026-11-16T10:00:00Z"',
  '',
].join('\n');

const parsed = config.parse(SAMPLE);
assert.deepEqual(parsed.problems, [], 'примерът се чете без проблеми: ' + JSON.stringify(parsed.problems));
const again = config.emit(parsed.data);
assert.equal(again, SAMPLE, 'обратният прочит е байт-идентичен (иначе всеки запис прави шум в diff-а)');
assert.deepEqual(config.parse(again).data, parsed.data, 'двойният прочит дава същите стойности');

// Форматът е ПЛОСЪК (план 26): опциите са имена, не групи `portal:`/`access:`/`qr:`.
assert.equal(parsed.data.portal, undefined, 'няма група `portal:` — опциите са на едно ниво');
assert.equal(parsed.data.ui_columns, 3, 'числото е число');
assert.equal(parsed.data.readonly, false, 'bool е bool');
assert.equal(parsed.data.access_mode, 'key', 'режимът на достъп е опция, не раздел');
assert.equal(parsed.data.folders['/Договори'].locked, true, 'флагът на папката е bool');
assert.equal(parsed.data.files.length, 1, 'файлът е запис в списъка');
assert.equal(parsed.data.files[0].path, '/Договори/a.pdf', 'пътят е запазен точно');

// ── 1б. Списък от ОБЕКТИ с няколко елемента ────────────────────────────────────
// Пази точно един дефект: полетата на първия елемент затваряха списъка и вторият `- ` ставаше
// „елемент на списък без списък“ (хванато, когато порталът получи ВТОРИ файл — `files[]` е
// точно такъв списък). Затова тук се проверява не един, а два елемента, и обратен прочит.
{
  const two = SAMPLE.replace(
    '  - id: file-000001\n',
    '  - id: file-000002\n    path: /Договори/b.pdf\n    size: 20\n    sha256: "' + '2'.repeat(64) + '"\n    access: key\n    listed: false\n  - id: file-000001\n',
  );
  const read = config.parse(two);
  assert.deepEqual(read.problems, [], 'два елемента в списъка се четат: ' + JSON.stringify(read.problems));
  assert.equal(read.data.files.length, 2, 'и двата елемента са в списъка');
  assert.equal(read.data.files[0].id, 'file-000002', 'редът е този от файла (после `emit` го подрежда по път)');
  assert.equal(read.data.files[1].id, 'file-000001', 'вторият елемент не се слива с първия');
  const text = config.emit(read.data);
  assert.deepEqual(config.parse(text).problems, [], 'записаното се чете отново');
  assert.equal(config.parse(text).data.files.length, 2, 'броят не се губи при запис');
}

// ── 2. Откази вместо догадки ───────────────────────────────────────────────────
const refuses = (text, expected, why) => {
  const result = config.parse(text);
  assert.ok(result.problems.length > 0, why + ' — трябва да се откаже');
  assert.match(JSON.stringify(result.problems), expected, why + ': ' + JSON.stringify(result.problems));
};

refuses('slug:\n\tname: x\n', /табулация/, 'табулация за отстъп');
refuses('slug: a\nslug: b\n', /дублиран ключ/, 'дублиран ключ');
refuses('name: "незатворен\n', /незатворени кавички/, 'незатворени кавички');
refuses('name: a: b\n', /незатворени|специален|дублиран|ред без/, 'двоеточие без кавички');
refuses('notes: *alias\n', /специален знак|кавички/, 'anchor/alias не се поддържа');
refuses('само текст без двоеточие\n', /ред без/, 'ред без двоеточие');
// Скалар в `files:` минава ЧЕТЕНЕТО (форматът е позволен), но не минава ПРОВЕРКАТА — затова двете
// са отделни стъпки: четецът не знае схемата, а проверката не знае редовете.
const scalarInFiles = config.parse('files:\n  - самотен\n');
assert.deepEqual(scalarInFiles.problems, [], 'четецът приема списък от скалари');
assert.ok(
  config.validate({ ...config.initial({ slug: 'x' }), files: scalarInFiles.data.files }).some((i) => i.path.startsWith('files[')),
  'проверката отказва скалар на мястото на файл',
);

// ── 3. Проверката на стойностите (validate) ────────────────────────────────────
const base = config.initial({ slug: 'dogovor', title: 'Договор' });
assert.deepEqual(config.validate(base, { slug: 'dogovor' }), [], 'началният файл минава проверката');

const withIssue = (mutate, expectedPath) => {
  const copy = JSON.parse(JSON.stringify(base));
  mutate(copy);
  const issues = config.validate(copy, { slug: 'dogovor' });
  assert.ok(issues.some((i) => i.path === expectedPath), 'очаква се проблем при „' + expectedPath + '“: ' + JSON.stringify(issues));
};

withIssue((d) => { d.version = 2; }, 'version');
withIssue((d) => { d.revision = 0; }, 'revision');
withIssue((d) => { d.updated_at = 'вчера'; }, 'updated_at');
withIssue((d) => { d.slug = 'Голям Портал'; }, 'slug');
withIssue((d) => { d.name = ''; }, 'name');
withIssue((d) => { d.name = 'x'.repeat(161); }, 'name');
withIssue((d) => { d.visibility = 'secret'; }, 'visibility');
withIssue((d) => { d.ui_columns = 5; }, 'ui_columns');
withIssue((d) => { d.storage_subpath = '../извън'; }, 'storage_subpath');
withIssue((d) => { d.storage_subpath = 'a/b/c/d'; }, 'storage_subpath');
// Всяка опция присъства ВИНАГИ: липсващ ключ е грешка, а не „подразбиране“ (план 26, §1.1).
withIssue((d) => { delete d.flag; }, 'flag');
// Идентификаторът има три части и точно три цифри.
withIssue((d) => { delete d.id; }, 'id');
withIssue((d) => { d.id = 'dogovor'; }, 'id');
withIssue((d) => { d.id = 'dogovor-ok-0001'; }, 'id');
withIssue((d) => { d.id = 'drug-ok-001'; }, 'id');
withIssue((d) => { d.id = 'dogovor--001'; }, 'id');
// `off:` приема само имена на съществуващи опции, без повторение.
withIssue((d) => { d.off = ['няма-такава']; }, 'off[0]');
withIssue((d) => { d.off = ['visibility', 'visibility']; }, 'off[1]');
assert.ok(
  config.validate({ ...base, slug: 'dogovor' }, { slug: 'drug' }).some((i) => i.path === 'slug'),
  'името на папката и `slug` трябва да съвпадат',
);

// ── 4. Ефективни стойности: липсващ ключ = подразбиране ────────────────────────
const eff = config.effective({ slug: 'x', name: 'X', visibility: 'public' });
assert.equal(eff.access_mode, 'free', 'публичният портал без изричен режим е свободен');
assert.equal(config.effective({ slug: 'x', name: 'X', visibility: 'private' }).access_mode, 'key', 'частният иска ключ');
assert.equal(eff.ui_columns, 3, 'колоните идват от подразбиранията');
assert.equal(eff.folders_default_visible, true, 'папките са видими по подразбиране');
const overridden = config.effective({ slug: 'x', name: 'X', ui_columns: 4, folders_default_visible: false });
assert.equal(overridden.ui_columns, 4, 'записаното печели');
assert.equal(overridden.folders_default_media, false, 'а непопълненото остава от подразбирането');
assert.equal(overridden.version, undefined, 'номерата на файла не изтичат в ефективните стойности');
assert.deepEqual(overridden.off, [], 'изключените опции са празен списък по подразбиране');
assert.equal(config.isOff({ off: ['visibility'] }, 'visibility'), true, '`off:` изключва опция, без да губи стойността');
assert.equal(config.isOff({ off: [] }, 'visibility'), false, 'неизключената опция се прилага');

console.log(
  'PASS portal-config-format: плосък YAML (без групи) · обратен прочит байт по байт · отказ за табулация/дублиран ключ/незатворени кавички/anchor · ' +
    config.FILE_KEYS.length + ' полета на файл · проверки на всяка опция и на `id`/`off:` · подразбирания и „записаното печели“',
);
