'use strict';
// Пълен пакет: пуска всеки тест във файл последователно и обобщава.
//
//   node scripts/run-tests.cjs            # всички тестове
//   node scripts/run-tests.cjs send auth  # само файловете, които съдържат тези думи
//
// Провалите се събират и се показват НАКРАЯ, за да не се губи името им, когато
// изходът е съкратен (напр. `| Select-Object -Last 2`).
const { readdirSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'tests');
const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const all = readdirSync(dir)
  .filter((f) => /\.cjs$/.test(f) && f !== 'helpers.cjs')
  .sort();
const files = filters.length ? all.filter((f) => filters.some((q) => f.includes(q))) : all;
if (!files.length) {
  console.error('няма тестове, отговарящи на: ' + filters.join(', '));
  process.exit(2);
}

const failures = [];
const start = Date.now();
// Таван за един тест. Без него висящ тест (напр. оставен сирак държи тръбите) заключва
// целия пакет безкрайно; в CI това вече се случи. 300 s е много над най-бавния тест.
const TEST_TIMEOUT_MS = 300000;
for (const f of files) {
  const t0 = Date.now();
  process.stdout.write(`\n=== ${f} ===\n`);
  const res = spawnSync(process.execPath, [path.join(dir, f)], {
    cwd: root,
    stdio: 'inherit',
    timeout: TEST_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  const ms = Date.now() - t0;
  if (res.status !== 0) {
    const timedOut = Boolean(res.error && res.error.code === 'ETIMEDOUT');
    const status = timedOut ? `timeout ${TEST_TIMEOUT_MS}ms` : res.status ?? res.signal;
    failures.push({ file: f, status, ms });
    console.log(`FAIL ${f} (exit ${status}, ${ms}ms)`);
  } else {
    console.log(`PASS ${f} (${ms}ms)`);
  }
}
const seconds = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\n${files.length - failures.length}/${files.length} passed in ${seconds}s`);
if (failures.length) {
  // Повтаряме имената накрая: така дори съкратен изход казва КОЙ тест е паднал.
  console.log('Провалени (' + failures.length + '):');
  for (const f of failures) console.log(`  · ${f.file} (exit ${f.status}, ${f.ms}ms)`);
}
process.exit(failures.length ? 1 : 0);
