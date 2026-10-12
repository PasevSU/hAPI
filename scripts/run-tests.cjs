'use strict';
const { readdirSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'tests');
const files = readdirSync(dir)
  .filter((f) => /\.cjs$/.test(f) && f !== 'helpers.cjs')
  .sort();
let failed = 0;
const start = Date.now();
for (const f of files) {
  const t0 = Date.now();
  process.stdout.write(`\n=== ${f} ===\n`);
  const res = spawnSync(process.execPath, [path.join(dir, f)], { cwd: root, stdio: 'inherit' });
  const ms = Date.now() - t0;
  if (res.status !== 0) { failed++; console.log(`FAIL ${f} (exit ${res.status}, ${ms}ms)`); }
  else console.log(`PASS ${f} (${ms}ms)`);
}
console.log(`\n${files.length - failed}/${files.length} passed in ${((Date.now() - start) / 1000).toFixed(1)}s`);
process.exit(failed ? 1 : 0);
