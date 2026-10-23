'use strict';
// FD-0: правила за експорт — режими, именуване, пакет, безопасни пътища, capabilities.
const assert = require('node:assert/strict');
const R = require('../hapi_enterprise/export-rules.js');

// 1. Дванадесет режима, всеки с валиден формат, съдържание и право.
assert.equal(R.MODES.length, 12);
assert.equal(new Set(R.MODES.map((m) => m.id)).size, 12);
const PERMISSIONS = ['files.download', 'reports.export', 'evidence.export', 'templates.export', 'audit.export', 'backups.create', 'bulk.export'];
for (const m of R.MODES) {
  assert.ok(R.FORMATS[m.format], `${m.id}: непознат формат ${m.format}`);
  assert.ok(m.contents.length > 0, `${m.id}: празно съдържание`);
  for (const c of m.contents) assert.ok(R.CONTENTS[c], `${m.id}: непознато съдържание ${c}`);
  assert.ok(PERMISSIONS.includes(m.permission), `${m.id}: непознато право ${m.permission}`);
}

// 2. Доказателствените режими изискват проверка и не могат да я изключат.
for (const id of ['evidence', 'certificates', 'backup', 'audit', 'verified']) {
  assert.equal(R.requiresVerification(id), true, id);
  assert.equal(R.normalizeConfig({ mode: id, verifySha256: false }).verifySha256, true, `${id} не форсира SHA-256`);
}
assert.equal(R.requiresVerification('report'), false);
assert.equal(R.normalizeConfig({ mode: 'report', verifySha256: false }).verifySha256, false);

// 3. Нормализация: непознат режим → evidence; съдържанието идва от режима.
const ev = R.normalizeConfig({});
assert.equal(ev.mode, 'evidence');
assert.deepEqual(ev.contents, R.MODES_BY_ID.evidence.contents);
assert.equal(ev.format, 'zip');
assert.equal(ev.location, 'folder');
assert.equal(ev.onConflict, 'unique');

// 4. Име на пакета: предвидимо, UTC, безопасен caseId.
assert.equal(R.packageId(new Date('2026-10-20T17:48:00Z'), 'CASE001'), 'RPT-20261020-174800-CASE001');
assert.equal(R.packageId(new Date('2026-10-20T17:48:00Z'), 'дело 2026/114'), 'RPT-20261020-174800-2026114');
assert.equal(R.packageId(new Date('2026-01-02T03:04:05Z'), ''), 'RPT-20260102-030405-CASE');

// 5. Безопасни сегменти и пътища.
assert.equal(R.sanitizeSegment('a/b'), 'a_b');
assert.equal(R.sanitizeSegment('CON.pdf'), '_CON.pdf');
assert.equal(R.sanitizeSegment('..'), '');
assert.equal(R.sanitizeSegment('file. '), 'file');
assert.equal(R.isReservedName('LPT1.txt'), true);
assert.equal(R.isReservedName('legal.txt'), false);

assert.equal(R.safeRelPath('report/x.pdf').ok, true);
assert.equal(R.safeRelPath('/etc/passwd').reason, 'absolute');
assert.equal(R.safeRelPath('C:/x.pdf').reason, 'drive-letter');
assert.equal(R.safeRelPath('//server/share/x.pdf').reason, 'unc');
assert.equal(R.safeRelPath('a/../../b.pdf').reason, 'traversal');
assert.equal(R.safeRelPath('a//b.pdf').reason, 'empty-segment');
assert.equal(R.safeRelPath('CON.pdf').reason, 'reserved-name');
assert.equal(R.safeRelPath('x'.repeat(300)).reason, 'too-long');

const dup = R.safePaths(['A.pdf', 'a.pdf']);
assert.equal(dup.ok, false);
assert.equal(dup.duplicates.length, 1);
assert.equal(R.safePaths(['a.pdf', 'b.pdf']).ok, true);

// 6. План на пакета: съдържание по режим, уникални имена, индекс.
const plan = R.planPaths({ mode: 'evidence', files: ['protokol.pdf', 'protokol.pdf'] }, { caseId: 'CASE001', date: new Date('2026-10-20T17:48:00Z') });
const paths = plan.entries.map((e) => e.path);
assert.ok(paths.includes('report/forensic_report.pdf'));
assert.ok(paths.includes('manifest/input_manifest.json'));
assert.ok(paths.includes('manifest/result_manifest.json'));
assert.ok(paths.includes('timestamps/start.tsr'));
assert.ok(paths.includes('timestamps/stop.tsr'));
assert.ok(paths.includes('hashes/sha256sum.txt'));
assert.ok(paths.includes('audit/export_audit.json'));
assert.ok(paths.includes('originals/protokol.pdf'));
assert.ok(paths.includes('originals/protokol (2).pdf'), paths.join(','));
assert.equal(paths[paths.length - 1], 'PACKAGE_INDEX.json');
assert.equal(plan.packageId, 'RPT-20261020-174800-CASE001');
assert.equal(R.safePaths(paths).ok, true);

const manifestOnly = R.planPaths({ mode: 'manifest' }, {});
assert.deepEqual(
  manifestOnly.entries.map((e) => e.path),
  ['manifest/input_manifest.json', 'manifest/result_manifest.json', 'PACKAGE_INDEX.json'],
);

const tpl = R.planPaths({ mode: 'template', templates: ['forensic.json'] }, {});
assert.ok(tpl.entries.some((e) => e.path === 'templates/forensic.json'));
assert.ok(tpl.entries.some((e) => e.path === 'PACKAGE_INDEX.json'));

// 7. Обобщение във вида от спецификацията.
const sum = R.summary({ mode: 'evidence', location: 'folder', format: 'zip' });
assert.equal(sum.categories, 7);
assert.equal(sum.format, 'ZIP');
assert.equal(sum.sha, true);
assert.equal(sum.target, 'FOLDER');
assert.equal(sum.text, 'Избрани категории: 7 · Формат: ZIP · SHA-256: Включена · Цел: FOLDER');

// 8. Валидация на конфигурация.
assert.equal(R.validateConfig(R.normalizeConfig({ mode: 'report' })).ok, true);
assert.equal(R.validateConfig(R.normalizeConfig({ mode: 'evidence', format: 'json' })).errors.some((e) => e.code === 'format-evidence'), true);
assert.equal(R.validateConfig({ mode: 'nope' }).errors.some((e) => e.code === 'mode'), true);
assert.equal(R.validateConfig({ mode: 'report', contents: [], format: 'zip', location: 'folder', onConflict: 'unique' }).errors.some((e) => e.code === 'contents-empty'), true);
assert.equal(R.validateConfig({ ...R.normalizeConfig({ mode: 'report' }), packageId: 'bad' }).errors.some((e) => e.code === 'package-id'), true);

// 9. Capabilities: готово е САМО това, което наистина работи.
// `compression` — 0.69.51, `encrypt_package` — 0.69.52, `split_archive` — 0.69.53,
// `rate_limit` — 0.69.54. Останалите две са „планирано“.
const caps = R.capabilities();
assert.equal(caps.length, 6);
const ready = caps.filter((c) => c.implemented).map((c) => c.id);
assert.deepEqual(ready, ['compression', 'split_archive', 'rate_limit', 'encrypt_package'], 'готови са четирите реални способности');
assert.equal(caps.find((c) => c.id === 'compression').status, 'ready');
assert.ok(
  caps.filter((c) => !c.implemented).every((c) => c.status === 'planned'),
  'останалите са планирани'
);

// 10. Глобалните правила са валидни и съдържат забрана за презапис на доказателства.
assert.equal(R.validateRules(R.DEFAULT_RULES).ok, true);
assert.equal(R.DEFAULT_RULES.evidence.overwrite, 'forbidden');
assert.equal(R.DEFAULT_RULES.overwrite, false);
assert.equal(R.validateRules({ ...R.DEFAULT_RULES, evidence: {} }).ok, false);

// 11. Уникализиране.
assert.equal(R.uniqueName(['a.pdf'], 'a.pdf'), 'a (2).pdf');
assert.equal(R.uniqueName(['a.pdf', 'a (2).pdf'], 'a.pdf'), 'a (3).pdf');
assert.equal(R.uniqueName(['A.pdf'], 'a.pdf'), 'a (2).pdf');

console.log('export-rules OK');
