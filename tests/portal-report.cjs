'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { create } = require('../hapi_enterprise/evidence-store');
const secret = 'report-secret-'.padEnd(32, 'x');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-evid-report-'));
  try {
    const store = create({ dir: path.join(tmp, 'evidence'), secret });
    const data = Buffer.from('reportable-evidence');
    const r = await store.store({ caseId: 'c1', name: 'ev.pdf', data, uploadedBy: 'prosecutor@court.bg' });
    const rec = await store.get(r.fileId);
    const chain = await store.custodyChain(r.fileId);
    const v = await store.verify(r.fileId);
    const pkg = { receipt: rec, chain, verification: v };
    assert.equal(pkg.receipt.fileId, r.fileId);
    assert.equal(pkg.chain.integrity.valid, true);
    assert.equal(pkg.verification.valid, true);
    console.log('PASS portal-report: verification package (receipt + custody chain + verification)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1 });
