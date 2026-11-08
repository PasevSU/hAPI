'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assignFinding,routeAnalysis}=require('../ai/dynamic-routing');
const all=['optimization','outcome-improvement','bug-fix','reliability','coverage','security','localization'];
test('every dynamic improvement category is routed to an existing static specialist',()=>{
 for(const category of all){
  const task=assignFinding({id:'dynamic-1234',category,signalId:'hapi.ready',
   metric:'a-measured-signal',summary:'Investigate measured '+category,
   priority:category==='bug-fix'?'high':'medium',
   evidence:{samples:10,failures:3}});
  assert.ok(task.owner.endsWith('-agent'));
  assert.ok(task.division.endsWith('-lead'));
  assert.equal(task.applyAllowed,false);
  assert.equal(task.releaseAuthorized,false);
  assert.equal(task.mode,'dynamic-to-static');
  assert.ok(task.plan.length>=6);
  assert.deepEqual(task.evidence,{samples:10,failures:3});
 }
});
test('unrecognized external categories are rejected, not assigned arbitrary privileges',()=>{
 assert.throws(()=>assignFinding({category:'unrestricted-release',id:'bad'}),/UNCLASSIFIED/);
 assert.deepEqual(routeAnalysis({findings:[]}),[]);
 assert.deepEqual(routeAnalysis({}),[]);
});
