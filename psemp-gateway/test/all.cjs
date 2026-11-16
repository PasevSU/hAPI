#!/usr/bin/env node
/*
 * Every PSEMP suite, in one exit code.
 *
 * The suites in this folder are the only automated proof that the forensic layer
 * still does what PROTOCOL.md says it does. Nothing ran them, so a change to
 * `background.js` or to the gateway could ship with all of them red and nobody
 * would know. `tests/psemp-suites.cjs` — which lives in the hAPI test tree and is
 * therefore part of the matrix — calls this file.
 *
 * A suite is any `.cjs` in the folder except this one; `lib/` holds the shared
 * harness, not a suite. Each is spawned rather than required: the files call
 * process.exit(), keep module level state, and one of them reads a real
 * Thunderbird profile, so sharing a process would let one suite decide the fate
 * of the next.
 *
 *   node psemp-gateway/test/all.cjs [dir]
 *
 * The optional directory is not a convenience: a test points this at fixtures to
 * prove that a red suite is reported as red and an empty folder is not a pass.
 * An aggregator that can only ever print "ok" is the decorative gate that
 * `tests/lint-config.cjs` had to be fixed for.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const SELF = path.basename(__filename);
const dir = process.argv[2] ? path.resolve(process.argv[2]) : __dirname;

const suites = fs.readdirSync(dir).filter((f) => f.endsWith('.cjs') && f !== SELF).sort();

if (!suites.length) {
  console.log(`FAIL PSEMP suites: no .cjs suite in ${dir} — a run over nothing is not a pass`);
  process.exit(1);
}

let failed = 0;
for (const name of suites) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [path.join(dir, name)], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - started;
  const output = `${res.stdout || ''}${res.stderr || ''}`.trim();
  const ok = res.status === 0;
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  (${ms} ms)`);
  // A failing suite is useless without its own words: print its tail.
  if (!ok) {
    for (const line of output.split('\n').filter(Boolean).slice(-14)) console.log('     ' + line.slice(0, 220));
  }
}

console.log(`\nPSEMP suites: ${suites.length - failed}/${suites.length} passed`);
process.exit(failed ? 1 : 0);
