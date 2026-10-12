'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { create } = require('../hapi_enterprise/evidence-store');
const secret = 'verify-secret-'.padEnd(32, 'x');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-evid-verify-'));
  try {
    const store = create({ dir: path.join(tmp, 'evidence'), secret });
    const data = Buffer.from('original-evidence-bytes');
    const r = await store.store({ caseId: 'c1', name: 'ev.bin', data, uploadedBy: 'prosecutor@court.bg' });

    const ok = await store.verify(r.fileId);
    assert.equal(ok.valid, true);
    assert.equal(ok.reason, undefined);

    const tampered = await store.verify(r.fileId, Buffer.from('tampered-evidence-bytes'));
    assert.equal(tampered.valid, false);
    assert.equal(tampered.reason, 'SHA256_MISMATCH');

    const missing = await store.verify('deadbeef'.repeat(4));
    assert.equal(missing.valid, false);
    assert.equal(missing.reason, 'NOT_FOUND');

    console.log('PASS portal-verify: valid, tampered, missing');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1 });
