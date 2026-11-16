'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ОРАКУЛ: форензичният слой има гейт, който наистина може да падне.
//
// Дефектът: `psemp-gateway/` донесе 11 теста, които никой не пускаше — нито
// матрицата (тя гледа `tests/`), нито `safe-release.cjs`. Промяна в
// `background.js` или в gateway-я можеше да излезе със зелен отчет и червени
// тестове. Сега `psemp-gateway/test/all.cjs` ги пуска, а този файл е в дървото
// на тестовете, тоест в матрицата.
//
// Проверява се не само „минават“, а и че агрегаторът има зъби:
//   • всички истински серии минават и броят им съвпада с файловете на диска;
//   • червена серия се отчита като червена, с нейните думи, и проваля пуска;
//   • празна папка е ПРОВАЛ, а не „100% успех“ върху нищо.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const AGG = path.join(ROOT, 'psemp-gateway', 'test', 'all.cjs');
const SUITEDIR = path.join(ROOT, 'psemp-gateway', 'test');

const runAgg = (dir) =>
  spawnSync(process.execPath, dir ? [AGG, dir] : [AGG], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `psemp-suites-${name}-`));

// 1. Истинските серии минават — и броят в отчета е броят на файловете, не преписан.
const suites = fs.readdirSync(SUITEDIR).filter((f) => f.endsWith('.cjs') && f !== 'all.cjs');
assert.ok(suites.length >= 11, `очаквани поне 11 серии, намерени ${suites.length} — изчезнал тест е също дефект`);
const real = runAgg();
assert.equal(real.status, 0, 'сериите на psemp-gateway не минават:\n' + real.stdout + real.stderr);
assert.match(
  real.stdout,
  new RegExp(`${suites.length}/${suites.length} passed`),
  'отчетът трябва да брои точно файловете на диска (иначе серия е пропусната тихо)'
);
for (const name of suites) {
  assert.match(real.stdout, new RegExp(`ok {2,}${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    `серията ${name} не е отчетена като минала`);
}

// 2. Червена серия се вижда като червена, с изхода си, и пускът пада.
const mixed = tmp('mixed');
try {
  fs.writeFileSync(path.join(mixed, 'a-good.cjs'), "console.log('fine');\n");
  fs.writeFileSync(path.join(mixed, 'b-bad.cjs'), "console.log('the useful words');\nprocess.exit(3);\n");
  const res = runAgg(mixed);
  assert.equal(res.status, 1, 'един червен тест трябва да даде изход 1');
  assert.match(res.stdout, /ok {2,}a-good\.cjs/, 'зелената серия се отчита');
  assert.match(res.stdout, /FAIL b-bad\.cjs/, 'червената серия се отчита като FAIL');
  assert.match(res.stdout, /the useful words/, 'изходът на падналата серия се извежда, иначе причината е скрита');
  assert.match(res.stdout, /1\/2 passed/, 'броят трябва да показва 1 от 2');
} finally {
  fs.rmSync(mixed, { recursive: true, force: true });
}

// 3. Празна папка е провал. Гейт, който „минава“ без нито един тест, е декоративен.
const empty = tmp('empty');
try {
  const res = runAgg(empty);
  assert.equal(res.status, 1, 'празна папка не бива да дава изход 0');
  assert.match(res.stdout, /no \.cjs suite/);
  assert.doesNotMatch(res.stdout, /passed/);
} finally {
  fs.rmSync(empty, { recursive: true, force: true });
}

console.log(`PASS psemp-suites: ${suites.length} серии в гейта · червена серия се вижда · празна папка е провал`);
