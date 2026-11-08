'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {STATIC,DYNAMIC,IMPROVEMENTS,parseInterval}=require('../ai/operating-modes');
const {inventory,coverage}=require('../ai/function-coverage');
const dynamic=require('../ai/dynamic-analysis');

test('static and dynamic modes have independent owners and no production authority',()=>{
 assert.equal(STATIC.id,'static');
 assert.equal(DYNAMIC.id,'dynamic');
 assert.equal(STATIC.mayModifyProduction,false);
 assert.equal(DYNAMIC.mayModifyProduction,false);
 for(const id of ['optimization','outcome-improvement','bug-fix','reliability','coverage'])
   assert.ok(IMPROVEMENTS.some(c=>c.id===id));
 assert.equal(parseInterval(undefined),360);
 assert.equal(parseInterval('15'),15);
 assert.equal(parseInterval(10080),10080);
 for(const bad of [0,-1,14,10081,'1.5','-20','a'])assert.throws(()=>parseInterval(bad),/INVALID/);
});
test('all historical functions begin unobserved, not reported as healthy',()=>{
 const registry=inventory();
 assert.equal(registry.functionCountClaim,358);
 assert.ok(registry.listed>=300);
 assert.equal(registry.liveInstrumented,0);
 assert.equal(registry.unobserved,registry.listed);
 assert.ok(registry.functions.every(f=>f.coverage==='unobserved'&&f.runtimeSensor===null));
 const mapped=coverage(registry,{[registry.functions[0].id]:
   {coverage:'test-only',lastObservedAt:'2026-11-08T00:00:00.000Z',sensorId:'test-fixture'}});
 assert.equal(mapped.liveInstrumented,0);
 assert.equal(mapped.testOnly,1);
 assert.equal(mapped.unobserved,registry.listed-1);
});
test('dynamic analyzer persists factual samples, finds real incidents and reports uninstrumented coverage',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hapi-dynamic-test-'));
 const clock=new Date('2026-11-08T12:00:00.000Z');
 try{
   const monitor=dynamic.createDynamicAnalyzer(root,{intervalMinutes:15,now:()=>clock});
   assert.equal(monitor.status().analysisEnabled,false);
   const statuses=['ready','unreachable','ready','unreachable','ready','unreachable',
     'ready','unreachable','ready','unreachable'];
   for(const state of statuses){
     const x=monitor.sample({state,httpStatus:state==='ready'?200:0,consecutiveFailures:1,latencyMs:640});
     assert.equal(x.source,'enterprise-readiness');
     assert.equal(x.signalId,'hapi.ready');
   }
   const result=monitor.runAnalysis();
   const labels=new Set(result.findings.map(x=>x.category));
   assert.ok(labels.has('bug-fix'),'readiness failure must generate bug-fix proposal');
   assert.ok(labels.has('reliability'),'flapping must generate reliability proposal');
   assert.ok(labels.has('optimization'),'measured latency must generate optimization proposal');
   assert.ok(labels.has('coverage'),'unobserved functions must generate coverage proposal');
   assert.ok(result.findings.every(x=>x.action==='review-proposal'&&x.applyAllowed===false));
   assert.equal(monitor.readRecent().length,1);
   assert.equal(monitor.status().lastFindingCount,result.findings.length);
   assert.equal(fs.statSync(path.join(root,'samples.jsonl')).mode&0o777,0o600);
   assert.equal(fs.statSync(path.join(root,'analyses.jsonl')).mode&0o777,0o600);
   monitor.stop();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('outcome improvements require measured counts and never infer success from readiness',()=>{
 const now=new Date('2026-11-08T13:00:00.000Z');
 const at=now.toISOString();
 const weak=Array.from({length:10},()=>({at,state:'ready',latencyMs:15,successes:2,attempts:10}));
 const report=dynamic.analyze(weak,{at:now});
 assert.ok(report.findings.some(x=>x.category==='outcome-improvement'));
 const unmeasured=Array.from({length:10},()=>({at,state:'ready',latencyMs:null,successes:null,attempts:null}));
 const unknown=dynamic.analyze(unmeasured,{at:now});
 assert.ok(!unknown.findings.some(x=>x.category==='outcome-improvement'));
 assert.ok(!unknown.findings.some(x=>x.category==='optimization'));
 assert.equal(dynamic.analyze(unmeasured.slice(0,2),{at:now}).status,'insufficient-data');
});
test('malformed samples and uncontrolled paths are refused',()=>{
 assert.throws(()=>dynamic.sanitizeSample({state:'success'}),/INVALID_DYNAMIC_SAMPLE/);
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hapi-dynamic-invalid-'));
 try{assert.throws(()=>dynamic.appendBounded(tmp,'../../secrets',{x:1}),/INVALID_JOURNAL_NAME/)}
 finally{fs.rmSync(tmp,{recursive:true,force:true})}
});
