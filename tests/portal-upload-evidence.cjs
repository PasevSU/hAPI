'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { create } = require('../hapi_enterprise/evidence-store');
const secret = 'upload-secret-'.padEnd(32, 'x');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-evid-up-'));
  try {
    const store = create({ dir: path.join(tmp, 'evidence'), secret });
    const data = Buffer.from('classified-evidence-appendix-001');
    const receipt = await store.store({
      caseId: 'case-2026-001', name: 'appendix-001.pdf', data,
      uploadedBy: 'prosecutor.ivanov@court.bg', classification: 'EVIDENCE', tags: ['fin', 'z']
    });
    assert.equal(receipt.algorithm, 'HMAC-SHA256');
    assert.equal(receipt.caseId, 'case-2026-001');
    assert.equal(receipt.size, data.length);
    assert.ok(/^[0-9a-f]{64}$/.test(receipt.sha256));
    assert.ok(/^[0-9a-f]{128}$/.test(receipt.sha512));
    assert.ok(/^[0-9a-f]{64}$/.test(receipt.signature));

    const files = fs.readdirSync(path.join(tmp, 'evidence', 'files'));
    assert.equal(files.length, 1);
    assert.deepEqual(fs.readFileSync(path.join(tmp, 'evidence', 'files', receipt.fileId)), data);

    const all = await store.list();
    assert.equal(all.length, 1);
    assert.equal(all[0].fileId, receipt.fileId);

    const receipt2 = await store.store({ caseId: 'case-2026-001', name: 'appendix-001.pdf', data, uploadedBy: 'clerk@court.bg' });
    assert.notEqual(receipt2.fileId, receipt.fileId);
    assert.equal((await store.list()).length, 2);

    const before = (await store.list()).length;
    await assert.rejects(store.store({ caseId: 'bad/case', name: 'x.pdf', data: Buffer.from('x'), uploadedBy: 'u@court.bg' }), /Invalid caseId/);
    assert.equal((await store.list()).length, before);

    console.log('PASS portal-upload-evidence: WORM store, receipt, dual digest, index, no overwrite, rollback');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1 });
