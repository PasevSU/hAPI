'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { create } = require('../hapi_enterprise/evidence-store');
const secret = 'custody-secret-'.padEnd(32, 'x');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-evid-chain-'));
  try {
    const store = create({ dir: path.join(tmp, 'evidence'), secret });
    const r = await store.store({ caseId: 'c1', name: 'doc.pdf', data: Buffer.from('doc'), uploadedBy: 'prosecutor@court.bg' });
    await store.verify(r.fileId);
    await store.verify(r.fileId, Buffer.from('forged'));

    const ch = await store.custodyChain(r.fileId);
    assert.equal(ch.integrity.valid, true);
    assert.equal(ch.events.length, 3);
    assert.equal(ch.events[0].event, 'evidence.upload');
    assert.equal(ch.events[1].event, 'evidence.verify');
    assert.equal(ch.events[2].details.valid, false);

    const chainFile = path.join(tmp, 'evidence', 'audit-chain.jsonl');
    fs.appendFileSync(chainFile, 'garbage\n');
    const ch2 = await store.custodyChain(r.fileId);
    assert.equal(ch2.integrity.valid, false);

    console.log('PASS portal-chain-of-custody: upload+verify events, per-file filter, tamper detection');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1 });
