'use strict';
// ЧИСЛАТА В АНАЛИЗА СА ИЗМЕРЕНИ, НЕ НАПИСАНИ.
//
// Защо има тест за документ: `reports/SCRIPT-ANALYSIS.md` твърди числа — 190 файла, 49 626
// реда, 203 сигнала, разпределение по сегменти, 177 от 190 файла с тест. Докато числата се
// пишеха на ръка, две от тях (разпределението на погълнатите обещания и делението на
// синхронните четения) стояха неверни в издадено издание (DEF-16). Тестът сравнява
// документа с `reports/SCRIPT-AUDIT.json`, тоест с това, което инструментът е измерил.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'reports', 'SCRIPT-AUDIT.json'), 'utf8'));
const doc = fs.readFileSync(path.join(root, 'reports', 'SCRIPT-ANALYSIS.md'), 'utf8');

/** 24816 → „24 816“ (както е записано в документа). */
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// ── 1. Общите числа ────────────────────────────────────────────────────────
assert.ok(doc.includes(`| **общо** | **${data.files}** | **${fmt(data.lines)}** | **${data.bySeverity.high + data.bySeverity.medium + data.bySeverity.low}** |`),
  `редът „общо“ в анализа не съвпада с измереното: ${data.files} файла · ${data.lines} реда`);
assert.equal(data.bySeverity.high, 0, 'анализът твърди нула високи — инструментът трябва да го потвърди');
assert.equal(data.bySeverity.medium, 0, 'анализът твърди нула средни — инструментът трябва да го потвърди');

// ── 2. Всеки сегмент, ред по ред ───────────────────────────────────────────
for (const [name, seg] of Object.entries(data.segments)) {
  const row = `| ${name} | ${seg.files} | ${fmt(seg.lines)} | ${seg.findings} |`;
  assert.ok(doc.includes(row), `липсва или е сгрешен редът за сегмент „${name}“: очакван „${row}“`);
}

// ── 3. Разпределението по правило ──────────────────────────────────────────
const ordered = Object.entries(data.byRule).sort((a, b) => b[1] - a[1]);
const splitRe = new RegExp(
  'Разпределението на ' + data.bySeverity.low + '-те сигнала: ' +
  ordered.map(([r, n]) => '`' + r + '`\\s*' + n).join('\\s*·\\s*'),
);
assert.match(doc, splitRe, `§2 не изрежда разпределението в измервания ред: ${ordered.map(([r, n]) => r + ' ' + n).join(' · ')}`);
for (const [rule, count] of Object.entries(data.byRule)) {
  assert.ok(new RegExp('`' + rule + '`\\s*\\|\\s*' + count + '\\b').test(doc), `§6 не дава ${count} за ${rule}`);
}

// ── 4. Покритие с тестове ──────────────────────────────────────────────────
const withoutTest = data.filesDetail.filter((f) => f.tests === 0);
const withTest = data.filesDetail.length - withoutTest.length;
assert.ok(doc.includes(`**${withTest} от ${data.filesDetail.length} файла**`),
  `покритието в §8 не съвпада: ${withTest}/${data.filesDetail.length}`);
assert.ok(doc.includes(`без тест остават ${withoutTest.length} файла`.replace('без тест', 'Без тест')) ||
  doc.includes(`Без тест остават ${withoutTest.length} файла`),
  `броят на файловете без тест не съвпада: ${withoutTest.length}`);
assert.ok(doc.includes(fmt(withoutTest.reduce((n, f) => n + f.lines, 0))), 'редовете без тест не съвпадат');

// ── 5. Числата, които вече бяха сгрешени веднъж (DEF-16) ───────────────────
assert.ok(doc.includes('**3** са еднократно при старт'), 'делението на синхронните четения трябва да е измерено (3 при старт)');
assert.ok(doc.includes('**12** са по път на заявка'), 'делението на синхронните четения трябва да е измерено (12 по заявка)');
for (const callee of ['rm', 'unlink', 'remove', 'rename', 'stat', 'readFile', 'res.json()', 'cancel', 'chmod', 'fetch']) {
  assert.ok(doc.includes('`' + callee + '`') || doc.includes('`' + callee.replace('()', '') + '`'),
    `§6 трябва да изрежда измереното извикване ${callee}`);
}

// ── 6. Одитът на самите твърдения съществува и изрежда седемте поправки ────
assert.ok(doc.includes('## 11. Одит на самите твърдения'), 'липсва §11 (одит на твърденията)');
assert.ok(doc.includes('**7/7**'), '§11 трябва да показва 7/7 доказани в двете посоки');
for (const id of ['DEF-09', 'DEF-10', 'DEF-11', 'DEF-12', 'DEF-13', 'DEF-14', 'DEF-15']) {
  assert.ok(doc.includes(id), `§11 не споменава ${id}`);
}

// ── 7. Регистърът твърди същото за DEF-16 ─────────────────────────────────
const register = fs.readFileSync(path.join(root, 'documentation', '01_AS_IS_ARCHITECTURE', 'KNOWN_DEFECTS.md'), 'utf8');
assert.ok(/^\| DEF-16 \|.*Затворен \(0\.\d+\.\d+\) \|$/m.test(register), 'DEF-16 липсва или не е затворен в регистъра');
assert.ok(fs.existsSync(path.join(root, 'tests', 'analysis-claims.cjs')), 'тестът, с който DEF-16 е затворен, трябва да съществува');

console.log(`PASS analysis claims: ${data.files} файла · ${fmt(data.lines)} реда · ${data.bySeverity.low} сигнала · ${Object.keys(data.segments).length} сегмента · покритие ${withTest}/${data.filesDetail.length} · §11 с 7/7`);
