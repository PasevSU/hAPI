'use strict';
// ДОГОВОР ЗА `files[]` В `configuration.yaml` (план 23, §26).
//
// Какво пази този тест: списъкът с файлове е ЧАСТ от описанието, не отделен регистър. Затова
// идентичността (`id`), пътят (уникален БЕЗ значение от регистъра — на NTFS `A.pdf` и `a.pdf` са
// един файл), редът (по `path`, за да е четим diff-ът) и сверката с диска (липсващ · излишен ·
// променен) са правила, а не навици.
const assert = require('node:assert/strict');
const path = require('node:path');

const config = require(path.join(__dirname, '..', 'hapi_enterprise', 'portal-config.js'));

const SHA = (n) => String(n).repeat(64).slice(0, 64);
const fileAt = (over) => ({
  id: 'file-000001',
  path: '/a.pdf',
  size: 10,
  sha256: SHA(1),
  version: 1,
  access: 'key',
  listed: true,
  mirror: false,
  added: '2026-11-16T10:00:00Z',
  modified: '2026-11-16T10:00:00Z',
  ...over,
});

const base = (files) => ({ ...config.initial({ slug: 'dogovor' }), files });
const issuesOf = (files) => config.validate(base(files), { slug: 'dogovor' });

// ── 1. Редът е по `path`, а не по начина, по който са дошли ────────────────────
const unsorted = config.emit(base([fileAt({ id: 'file-000002', path: '/б.pdf' }), fileAt({ id: 'file-000001', path: '/а.pdf' })]));
const orderInText = unsorted.split('\n').filter((line) => line.trim().startsWith('path:'));
assert.deepEqual(
  orderInText.map((line) => line.trim()),
  ['path: /а.pdf', 'path: /б.pdf'],
  'записът подрежда по път: ' + JSON.stringify(orderInText),
);

// ── 2. Идентичност и път ──────────────────────────────────────────────────────
const problems = (files, expected) => {
  const issues = issuesOf(files);
  assert.ok(issues.length > 0, expected + ' — трябва да се откаже');
  assert.match(JSON.stringify(issues), new RegExp(expected), expected + ': ' + JSON.stringify(issues));
};
problems([fileAt({ id: 'къс' })], 'идентификатор');
problems([fileAt({ id: 'file-000001' }), fileAt({ id: 'file-000001', path: '/b.pdf' })], 'дублиран идентификатор');
problems([fileAt({ path: 'без наклонена' })], 'пътят започва');
problems([fileAt({ path: '/a/../b.pdf' })], 'пътят започва|без „..“');
problems([fileAt({ path: '/configuration.yaml' })], 'не е съдържание');
problems([fileAt({ path: '/portal.html' })], 'не е съдържание');
problems([fileAt({ path: '/.worm' })], 'не е съдържание');
problems([fileAt({ path: '/' + 'x'.repeat(200) + '/' + 'y'.repeat(200) + '/z.pdf' })], 'пътят започва');
// Дубликат по регистър: на NTFS това е ЕДИН файл, затова е отказ, а не „последният печели“.
problems([fileAt({ id: 'file-000001', path: '/A.pdf' }), fileAt({ id: 'file-000002', path: '/a.pdf' })], 'дублиран път');
problems([fileAt({ sha256: 'zz' })], 'sha256');
problems([fileAt({ size: -1 })], 'цяло число');
problems([fileAt({ access: 'public' })], 'позволени: free, key, disabled');
problems([fileAt({ version: 0 })], 'цяло число');
problems([fileAt({ content_id: 'CT-късо' })], 'CT-');
problems([fileAt({ непознато: true })], 'непознато поле');

// Чистият списък минава, включително празен и с `content_id`.
assert.deepEqual(issuesOf([]), [], 'празният списък е валиден');
assert.deepEqual(issuesOf([fileAt({ content_id: 'CT-' + 'a'.repeat(32) })]), [], 'content_id по договора е валиден');

// ── 3. Сверка с диска: липсващ · излишен · променен · нечетим ──────────────────
const data = base([
  fileAt({ id: 'file-000001', path: '/a.pdf', sha256: SHA(1) }),
  fileAt({ id: 'file-000002', path: '/b.pdf', sha256: SHA(2) }),
  fileAt({ id: 'file-000003', path: '/липсва.pdf', sha256: SHA(3) }),
]);
const clean = config.verify(data, [
  { path: '/a.pdf', sha256: SHA(1) },
  { path: '/b.pdf', sha256: SHA(2) },
  { path: '/липсва.pdf', sha256: SHA(3) },
]);
assert.equal(clean.ok, true, 'съвпадаща папка дава ok: true');
assert.deepEqual([clean.missing, clean.extra, clean.changed], [[], [], []], 'нищо не липсва и нищо не е излишно');

const messy = config.verify(data, [
  { path: '/a.pdf', sha256: SHA(1) },
  { path: '/b.pdf', sha256: SHA(9) },
  { path: '/нов.pdf', sha256: SHA(4) },
  { path: '/configuration.yaml', sha256: SHA(5) },
  { path: '/portal.html', sha256: SHA(6) },
]);
assert.equal(messy.ok, false, 'разлика = не е ok');
assert.deepEqual(messy.changed, ['/b.pdf'], 'променен файл се вижда: ' + JSON.stringify(messy.changed));
assert.deepEqual(messy.missing, ['/липсва.pdf'], 'липсващ файл се вижда: ' + JSON.stringify(messy.missing));
assert.deepEqual(messy.extra, ['/нов.pdf'], 'излишен файл се вижда, а генерираните НЕ са излишни: ' + JSON.stringify(messy.extra));

const unreadable = config.verify(data, [
  { path: '/a.pdf', unreadable: true },
  { path: '/b.pdf', sha256: SHA(2) },
  { path: '/липсва.pdf', sha256: SHA(3) },
]);
assert.deepEqual(unreadable.unreadable, ['/a.pdf'], 'нечетимият файл е отделен списък, не „променен“');
assert.equal(unreadable.changed.includes('/a.pdf'), false, 'нечетимият не се брои за променен');

// ── 4. Разлика: какво точно се мени (за 409 и за панела) ──────────────────────
const before = base([fileAt({ path: '/a.pdf', listed: true })]);
const after = base([fileAt({ path: '/a.pdf', listed: false })]);
const changes = config.diff(config.effective({ folders_default_visible: true }), config.effective({ folders_default_visible: false }));
assert.deepEqual(changes.map((c) => c.path), ['folders_default_visible'], 'разликата е по ключ, не „нещо се мени“: ' + JSON.stringify(changes));
assert.equal(changes[0].from, true, 'старата стойност е налична');
assert.equal(changes[0].to, false, 'новата стойност е налична');
assert.deepEqual(config.diff(before, after).filter((c) => c.path === 'portal.title'), [], 'несмененото не влиза в разликата');

console.log(
  'PASS portal-config-files: ред по път · уникален id и път без регистър · забранени генерирани имена · ' +
    'сверка липсващ/излишен/променен/нечетим · разлика по ключ',
);
