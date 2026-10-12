'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { create } = require('../hapi_enterprise/migration-pipeline');

(async () => {
  const m = create();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-mig-resume-'));

  try {
    const src = path.join(tmp, 'src');
    const dst = path.join(tmp, 'dst');
    fs.mkdirSync(src, { recursive: true });
    const TOTAL = 12;
    const rels = [];
    for (let i = 0; i < TOTAL; i++) rels.push('f' + String(i).padStart(2, '0') + '.txt');
    for (const rel of rels) fs.writeFileSync(path.join(src, rel), 'content-' + rel + '-' + 'x'.repeat(1024));

    // First run: abort after 5 files have been fully staged and verified.
    const controller = new AbortController();
    let advanced = 0;
    const ctx = {
      signal: controller.signal,
      setTotal: () => {},
      advance: () => { advanced++; if (advanced === 5) controller.abort(); },
      throwIfPaused: () => {}
    };
    let aborted = false;
    try { await m.run({ source: src, destination: dst, ctx }); } catch (e) { aborted = e.code === 'ABORTED'; }
    assert.equal(aborted, true, 'expected the first run to be aborted');
    assert.equal(advanced, 5);
    assert.ok(fs.existsSync(dst + '.migrate-staging'), 'staging must persist after interruption');

    // Second run resumes and completes without duplicates.
    const report = await m.run({ source: src, destination: dst });
    assert.equal(report.sourcePreserved, true);
    assert.equal(report.skipped, 5);
    assert.equal(report.copied, TOTAL - 5);
    assert.equal(report.files, TOTAL);

    const destFiles = fs.readdirSync(dst).filter(n => n.endsWith('.txt')).sort();
    assert.deepEqual(destFiles, rels.sort());
    for (const rel of rels) assert.equal(fs.readFileSync(path.join(dst, rel), 'utf8'), fs.readFileSync(path.join(src, rel), 'utf8'));

    console.log('PASS migrate-resume: interrupted run resumes from staging without duplicates');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1 });
