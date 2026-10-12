'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { create } = require('../hapi_enterprise/migration-pipeline');

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  const m = create();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-mig-copy-'));

  try {
    const src = path.join(tmp, 'src');
    const dst = path.join(tmp, 'dst');
    fs.mkdirSync(path.join(src, 'sub', 'deep'), { recursive: true });
    const files = {
      'a.txt': 'alpha',
      'sub/b.txt': 'beta-beta-beta',
      'sub/deep/c.bin': Buffer.from([0, 1, 2, 3, 255, 254])
    };
    for (const [rel, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(src, rel), content);
    }

    const plan = await m.plan({ source: src, destination: dst, minFreeMb: 0 });
    assert.equal(plan.dryRun, true);
    assert.equal(plan.totalFiles, 3);
    assert.equal(plan.conflictCount, 0);
    assert.equal(plan.totalBytes, 5 + 14 + 6);

    const report = await m.run({ source: src, destination: dst, method: 'copy' });
    assert.equal(report.sourcePreserved, true);
    assert.equal(report.files, 3);
    assert.equal(report.copied, 3);
    assert.equal(report.skipped, 0);
    assert.equal(report.backup, null);

    // destination contains all files with identical content + hashes
    for (const [rel, content] of Object.entries(files)) {
      const got = fs.readFileSync(path.join(dst, rel));
      assert.deepEqual(got, Buffer.from(content));
      assert.equal(sha256(got), sha256(fs.readFileSync(path.join(src, rel))));
    }

    // source is untouched
    for (const rel of Object.keys(files)) assert.ok(fs.existsSync(path.join(src, rel)));

    // staging is gone after switch
    assert.equal(fs.existsSync(dst + '.migrate-staging'), false);

    console.log('PASS migrate-copy-verify: plan totals, copy, SHA-256 verify, sourcePreserved, clean switch');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1 });
