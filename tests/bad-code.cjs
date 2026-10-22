'use strict';
// Гейт за лош код: сегментният скенер не бива да намира необяснени critical/high
// находки, а приетите изключения трябва да имат писмена причина.
//
//   node tests/bad-code.cjs
//
// Тестът пуска scripts/bad-code-scan.cjs като отделен процес (същият код, който
// ползва човекът) и проверява три неща:
//   1. няма нито една активна находка с тежест critical или high;
//   2. всяко изключение в scripts/bad-code-allowlist.json има reason и валиден файл;
//   3. броят на приетите находки не расте — ново изключение изисква преглед.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BASE_MAX_SUPPRESSED = 250; // колко изключения са прегледани и приети към 0.69.0

const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'bad-code-scan.cjs'), '--json'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
assert.equal(run.status, 0, 'скенерът приключва без грешка: ' + (run.stderr || '').slice(0, 300));
const report = JSON.parse(run.stdout);

// 1. Нищо тежко не остава активно.
assert.ok(report.scanned >= 240, `скенерът обхожда проекта (сканирани ${report.scanned})`);
assert.equal(report.bySev.critical || 0, 0, 'няма активни critical находки: ' + JSON.stringify(report.findings.filter((f) => f.sev === 'critical').slice(0, 3)));
assert.equal(report.bySev.high || 0, 0, 'няма активни high находки: ' + JSON.stringify(report.findings.filter((f) => f.sev === 'high').slice(0, 3)));

// 2. Всяко изключение е обяснено и сочи съществуващ файл.
const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'bad-code-allowlist.json'), 'utf8'));
assert.ok(Array.isArray(allow) && allow.length > 0, 'allowlist-ът е четим');
for (const entry of allow) {
  assert.ok(entry.file, 'изключение без файл: ' + JSON.stringify(entry));
  assert.ok(entry.rule, 'изключение без правило: ' + JSON.stringify(entry));
  assert.ok(typeof entry.reason === 'string' && entry.reason.length >= 40, `изключението за ${entry.file}/${entry.rule} няма писмена причина`);
  assert.ok(fs.existsSync(path.join(ROOT, entry.file)), 'файлът от allowlist-а съществува: ' + entry.file);
}

// 3. Няма тихо разрастване на изключенията.
assert.ok(
  report.suppressed.length <= BASE_MAX_SUPPRESSED,
  `приетите находки не бива да растат: ${report.suppressed.length} > ${BASE_MAX_SUPPRESSED}. ` +
  'Ако новото изключение е основателно, вдигни границата в този тест и добави причина в allowlist-а.',
);

// Приетите находки не може да са с тежест critical — такива се поправят, не се приемат.
const criticalAllowed = report.suppressed.filter((f) => f.sev === 'critical');
assert.equal(criticalAllowed.length, 0, 'critical находка не се приема с обосновка: ' + JSON.stringify(criticalAllowed.slice(0, 3)));

const byRule = Object.entries(report.findings.reduce((acc, f) => ((acc[f.rule] = (acc[f.rule] || 0) + 1), acc), {}))
  .map(([rule, n]) => `${rule}=${n}`)
  .join(', ');
console.log(
  `PASS bad-code: ${report.scanned} файла · ${report.totalLines} реда · 0 critical/high · ` +
  `${report.suppressed.length}/${BASE_MAX_SUPPRESSED} приети с причина · остават: ${byRule || 'нищо'}`,
);
