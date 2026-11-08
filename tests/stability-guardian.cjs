'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createIncidentStore,redact}=require('../tools/stability-guardian/incident-store.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hapi-guardian-'));
try {
  const store=createIncidentStore(path.join(dir,'incident.jsonl'));
  const a=store.ingest({source:'portal',code:'TIMEOUT',severity:'error',message:'request 123 timed out token=secret123'},new Date('2026-01-01T00:00:00Z'));
  const b=store.ingest({source:'portal',code:'TIMEOUT',severity:'error',message:'request 456 timed out token=secret123'},new Date('2026-01-01T00:01:00Z'));
  assert.equal(a.id,b.id);
  assert.equal(store.list()[0].count,2);
  assert.ok(!JSON.stringify(store.history()).includes('secret123'));
  store.recordDecision(a.id,'proposal','Increase bounded timeout; add regression test');
  store.recordDecision(a.id,'resolved','Regression test passes');
  assert.equal(store.list()[0].status,'resolved');
  store.ingest({source:'portal',code:'TIMEOUT',severity:'error',message:'request 789 timed out token=secret123'});
  assert.equal(store.list()[0].status,'reopened');
  assert.equal(redact('Authorization: Bearer abcdef'), 'Authorization: [REDACTED]');
  assert.throws(()=>store.ingest({source:'x',message:'y',severity:'impossible'}),/invalid event/);
  assert.throws(()=>store.recordDecision('not-an-id','resolved','x'),/invalid incident id/);
  console.log('stability-guardian: OK');
} finally {fs.rmSync(dir,{recursive:true,force:true})}
