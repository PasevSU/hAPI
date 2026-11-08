'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ci=require('../github-actions-evidence');
const sha='a'.repeat(40);
function run(id,name,commit=sha){
 return {id,name,head_sha:commit,head_repository:{full_name:'PasevSU/hAPI'},status:'completed',conclusion:'success'};
}
test('real CI result parser never upgrades success into rollback or release approval',async()=>{
 const result=await ci.inspectTwoRuns({sha,firstId:10,secondId:20,
   load:async p=>p.endsWith('/10')?run(10,'CI'):run(20,'CodeQL')});
 assert.equal(result.allCiSuccessful,true);
 assert.equal(result.releaseEligible,false);
 assert.equal(result.independentEnvironmentsVerified,false);
 assert.equal(result.runs[0].rollbackVerified,false);
 assert.equal(result.runs[1].restoreDrillVerified,false);
 assert.match(result.reason,/NOT_VERIFIED/);
});
test('wrong repository, SHA or run result is not accepted',async()=>{
 const mismatch=await ci.inspectTwoRuns({sha,firstId:10,secondId:20,
   load:async p=>p.endsWith('/10')?run(10,'CI','b'.repeat(40)):run(20,'CodeQL')});
 assert.equal(mismatch.allCiSuccessful,false);
 const other={...run(30,'CI'),head_repository:{full_name:'third-party/repo'}};
 assert.equal(ci.normalizeRun(other,sha).successful,false);
 const failed={...run(30,'CI'),conclusion:'failure'};
 assert.equal(ci.normalizeRun(failed,sha).successful,false);
 await assert.rejects(ci.inspectTwoRuns({sha,firstId:10,secondId:10}),/INVALID_CI_RUN_INPUT/);
 await assert.rejects(ci.inspectTwoRuns({sha:'not-a-sha',firstId:10,secondId:20}),/INVALID_CI_RUN_INPUT/);
});
