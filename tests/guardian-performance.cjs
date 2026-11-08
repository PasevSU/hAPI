'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {loadSnapshot,evaluate,recordFindings}=require('../hapi_enterprise/guardian/performance.js');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hapi-cache-observer-'));
try{
  const old={routes:{
    'GET /admin/api/sensors':{count:10,avgMs:200,errors:0},
    'GET /api/v1/p/:slug/tree':{count:10,avgMs:220,errors:0},
    'GET /t/:token':{count:10,avgMs:300,errors:0}
  }};
  const next={routes:{
    'GET /admin/api/sensors':{count:50,avgMs:200,errors:0},
    'GET /api/v1/p/:slug/tree':{count:50,avgMs:220,errors:0},
    'GET /t/:token':{count:50,avgMs:300,errors:0}
  }};
  fs.writeFileSync(path.join(dir,'sensors.json'),JSON.stringify(next));
  assert.equal(loadSnapshot(dir).routes['GET /admin/api/sensors'].count,50);
  const findings=evaluate(old,next,{minCalls:30,slowAverageMs:150});
  assert.equal(findings.length,3);
  assert.ok(findings.some(x=>x.candidateId==='C-002'));
  assert.ok(findings.some(x=>x.candidateId==='C-001'));
  assert.ok(findings.some(x=>x.candidateId.startsWith('AUTO-')));
  assert.ok(findings.every(x=>x.status==='needs-profiling'));
  assert.equal(recordFindings(dir,findings),findings.length);
  const stored=fs.readFileSync(path.join(dir,'cache-findings.jsonl'),'utf8');
  assert.ok(!stored.includes('/t/:token'),'no route names or tokens in cache journal');
  assert.ok(!stored.includes('/api/v1'),'no paths in findings');
  assert.equal(evaluate(next,next).length,0,'no new calls => no candidate');
  assert.equal(evaluate(null,next,{minCalls:100}).length,0,'no sufficient samples');
  assert.equal(recordFindings(dir,[]),0);
  console.log('guardian cache observations: OK');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
