'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { create } = require('../hapi_enterprise/migration-pipeline');

async function scenario(policy) {
  const m = create();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-mig-conf-'));
  const src = path.join(base, 'src');
  const dst = path.join(base, 'dst');
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(dst, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'NEW');
  fs.writeFileSync(path.join(src, 'only-new.txt'), 'new-only');
  fs.writeFileSync(path.join(dst, 'a.txt'), 'OLD');
  fs.writeFileSync(path.join(dst, 'only-old.txt'), 'old-only');

  const plan = await m.plan({ source: src, destination: dst, conflictPolicy: policy });
  assert.equal(plan.conflictCount, 1);
  assert.deepEqual(plan.conflicts, ['a.txt']);

  await m.run({ source: src, destination: dst, conflictPolicy: policy });
  return { base, dst };
}

(async () => {
  // first: existing destination file wins, new file is dropped
  let r = await scenario('first');
  assert.equal(fs.readFileSync(path.join(r.dst, 'a.txt'), 'utf8'), 'OLD');
  assert.equal(fs.existsSync(path.join(r.dst, 'a (2).txt')), false);
  assert.equal(fs.readFileSync(path.join(r.dst, 'only-new.txt'), 'utf8'), 'new-only');
  assert.equal(fs.readFileSync(path.join(r.dst, 'only-old.txt'), 'utf8'), 'old-only');
  fs.rmSync(r.base, { recursive: true, force: true });

  // skip: same as first (existing wins)
  r = await scenario('skip');
  assert.equal(fs.readFileSync(path.join(r.dst, 'a.txt'), 'utf8'), 'OLD');
  assert.equal(fs.existsSync(path.join(r.dst, 'a (2).txt')), false);
  fs.rmSync(r.base, { recursive: true, force: true });

  // queue: existing preserved, new file renamed (no overwrite)
  r = await scenario('queue');
  assert.equal(fs.readFileSync(path.join(r.dst, 'a.txt'), 'utf8'), 'OLD');
  assert.equal(fs.readFileSync(path.join(r.dst, 'a (2).txt'), 'utf8'), 'NEW');
  fs.rmSync(r.base, { recursive: true, force: true });

  console.log('PASS migrate-conflict: first/skip keep existing, queue renames new file without overwrite');
})().catch(e => { console.error(e); process.exitCode = 1 });
