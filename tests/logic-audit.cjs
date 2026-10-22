'use strict';
// Гейт за логическия одит: сканерът трябва да остане пуснат и чист.
//
// Ако някой добави `if (x = y)`, `for (… <= arr.length …)`, сортиране с булев
// компаратор или `catch`, който връща `true`, този тест пада — независимо че
// `node --check` минава и приложението „работи“.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'logic-audit.cjs');
const ALLOW = path.join(ROOT, 'scripts', 'logic-audit-allowlist.json');

const raw = execFileSync(process.execPath, [SCRIPT, '--json'], { cwd: ROOT, encoding: 'utf8' });
const report = JSON.parse(raw);

// 1. Обхват: сканерът наистина е минал през кода, а не през два файла.
assert.ok(report.files >= 250, `сканирани поне 250 файла (намерени ${report.files})`);
assert.ok(report.scannedLines >= 45000, `сканирани поне 45 000 реда (намерени ${report.scannedLines})`);

// 2. Никакви необяснени critical/high — това е гейтът.
const critical = report.open.filter((f) => f.sev === 'critical');
const high = report.open.filter((f) => f.sev === 'high');
assert.deepEqual(critical, [], 'няма отворени critical находки: ' + critical.map((f) => `${f.file}:${f.line} ${f.rule}`).join(', '));
assert.deepEqual(high, [], 'няма отворени high находки: ' + high.map((f) => `${f.file}:${f.line} ${f.rule}`).join(', '));

// 3. Всяка обосновка е истинска обосновка, не „ok“.
const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
assert.ok(Array.isArray(allow) && allow.length > 0, 'списъкът с изключения не е празен');
for (const entry of allow) {
  assert.ok(entry.reason && entry.reason.length >= 40, `обосновката е поне 40 знака: ${entry.file} / ${entry.rule}`);
  assert.ok(fs.existsSync(path.join(ROOT, entry.file)), `файлът съществува: ${entry.file}`);
  assert.ok(entry.rule, `изключението е за конкретно правило, не за целия файл: ${entry.file}`);
}

// 4. Изключенията не бива да растат тихо: праг, който изисква преглед.
assert.ok(report.accepted.length <= 25, `приети с обосновка ≤ 25 (сега ${report.accepted.length}) — ръстът иска преглед`);

// 5. Всяка находка е от известно правило и носи поправка (иначе отчетът е безполезен).
const known = new Set(require(SCRIPT).RULES.map((r) => r.id));
for (const f of report.open) {
  assert.ok(known.has(f.rule), `правилото ${f.rule} е дефинирано`);
  assert.ok(f.why && f.fix, `находката ${f.file}:${f.line} обяснява защо и как се поправя`);
}

console.log(
  `PASS logic-audit: ${report.files} файла · ${report.scannedLines} реда · 0 critical/high · ` +
  `${report.accepted.length}/${report.open.length + report.accepted.length} приети с причина`,
);
