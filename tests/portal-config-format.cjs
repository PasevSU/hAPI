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
  'portal:',
  '  slug: dogovor',
  '  title: "Договор: 2026 / №7"',
  '  visibility: private',
  '  flag: none',
  '  category: ""',
  '  subject: ""',
  '  notes: "бележка с # и : вътре"',
  '  contact_id: c-1',
  '  case_id: ""',
  '  readonly: false',
  '  parent_id: ""',
  'access:',
  '  mode: key',
  '  review_only: false',
  '  download_requires_key: true',
  '  temporary:',
  '    default_ttl: 24h',
  '    default_read_only: true',
  '    password_required: false',
  'qr:',
  '  style: frame',
  '  caption: url',
  '  levels:',
  '    folder: true',
  '    file: true',
  '  archive_on_change: false',
  'folders:',
  '  defaults:',
  '    visible: true',
  '    media: false',
  '    locked: false',
  '  items:',
  '    "/Договори":',
  '      visible: false',
  '      media: true',
  '      locked: true',
  '      reason: лични данни',
  'storage:',
  '  subpath: ""',
  '  copy_to_folder: true',
  'ui:',
  '  columns: 3',
  '  show_sizes: true',
  'audit:',
  '  telemetry: true',
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

// Типовете стигат до кода такива, каквито са: bool не е низ, число не е низ.
assert.equal(parsed.data.ui.columns, 3, 'числото е число');
assert.equal(parsed.data.portal.readonly, false, 'bool е bool');
assert.equal(parsed.data.folders.items['/Договори'].locked, true, 'флагът на папката е bool');
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

refuses('portal:\n\tslug: x\n', /табулация/, 'табулация за отстъп');
refuses('portal:\n  slug: a\n  slug: b\n', /дублиран ключ/, 'дублиран ключ');
refuses('portal:\n  title: "незатворен\n', /незатворени кавички/, 'незатворени кавички');
refuses('portal:\n  title: a: b\n', /незатворени|специален|дублиран|ред без/, 'двоеточие без кавички');
refuses('portal:\n  notes: *alias\n', /специален знак|кавички/, 'anchor/alias не се поддържа');
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
withIssue((d) => { d.portal.slug = 'Голям Портал'; }, 'portal.slug');
withIssue((d) => { d.portal.title = ''; }, 'portal.title');
withIssue((d) => { d.portal.title = 'x'.repeat(161); }, 'portal.title');
withIssue((d) => { d.portal.visibility = 'secret'; }, 'portal.visibility');
withIssue((d) => { d.ui = { columns: 5 }; }, 'ui.columns');
withIssue((d) => { d.storage = { subpath: '../извън' }; }, 'storage.subpath');
withIssue((d) => { d.storage = { subpath: 'a/b/c/d' }; }, 'storage.subpath');
assert.ok(
  config.validate({ ...base, portal: { slug: 'dogovor', title: 'x' } }, { slug: 'drug' }).some((i) => i.path === 'portal.slug'),
  'името на папката и `portal.slug` трябва да съвпадат',
);

// ── 4. Ефективни стойности: липсващ ключ = подразбиране ────────────────────────
const eff = config.effective({ portal: { slug: 'x', title: 'X', visibility: 'public' } });
assert.equal(eff.access.mode, 'free', 'публичният портал без изричен режим е свободен');
assert.equal(config.effective({ portal: { slug: 'x', title: 'X', visibility: 'private' } }).access.mode, 'key', 'частният иска ключ');
assert.equal(eff.ui.columns, 3, 'колоните идват от подразбиранията');
assert.equal(eff.folders.defaults.visible, true, 'папките са видими по подразбиране');
const overridden = config.effective({ ui: { columns: 4 }, folders: { defaults: { visible: false } } });
assert.equal(overridden.ui.columns, 4, 'записаното печели');
assert.equal(overridden.folders.defaults.media, false, 'а непопълненото остава от подразбирането');
assert.equal(overridden.version, undefined, 'номерата на файла не изтичат в ефективните стойности');

console.log(
  'PASS portal-config-format: обратен прочит байт по байт · отказ за табулация/дублиран ключ/незатворени кавички/anchor · ' +
    config.FILE_KEYS.length + ' полета на файл · 8 проверки на стойности · подразбирания и „записаното печели“',
);
