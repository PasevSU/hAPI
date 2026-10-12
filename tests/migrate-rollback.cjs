'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { create } = require('../hapi_enterprise/migration-pipeline');

(async () => {
  const m = create();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-mig-rollback-'));

  try {
    const src = path.join(tmp, 'src');
    const dst = path.join(tmp, 'dst');
    fs.mkdirSync(src, { recursive: true });
    fs.mkdirSync(dst, { recursive: true });
    fs.writeFileSync(path.join(src, 'new.txt'), 'NEW-CONTENT');
    fs.writeFileSync(path.join(dst, 'keep.txt'), 'ORIGINAL');

    const report = await m.run({ source: src, destination: dst });
    assert.equal(report.sourcePreserved, true);
    assert.ok(report.backup, 'expected a backup of the pre-existing destination');
    assert.equal(fs.readFileSync(path.join(dst, 'new.txt'), 'utf8'), 'NEW-CONTENT');
    assert.equal(fs.readFileSync(path.join(dst, 'keep.txt'), 'utf8'), 'ORIGINAL');

    const rollback = await m.rollback({ destination: dst });
    assert.equal(rollback.destination, dst);
    assert.equal(fs.readFileSync(path.join(dst, 'keep.txt'), 'utf8'), 'ORIGINAL');
    assert.equal(fs.existsSync(path.join(dst, 'new.txt')), false, 'rolled-back destination must not contain migrated files');

    // rollback is itself non-destructive: migrated content is preserved separately
    const preRollbackDirs = fs.readdirSync(tmp).filter(n => n.startsWith('dst.pre-rollback.'));
    assert.equal(preRollbackDirs.length, 1);
    assert.equal(fs.readFileSync(path.join(tmp, preRollbackDirs[0], 'new.txt'), 'utf8'), 'NEW-CONTENT');

    console.log('PASS migrate-rollback: switch preserves backup, rollback restores it non-destructively');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1 });
