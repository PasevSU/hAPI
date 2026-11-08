'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const director=require('../ai/director');
const workload=require('../ai/workload');
const sdkManager=require('../ai/sdk-manager');
test('director is chief of full project development and categories are distinct',()=>{
 const hierarchy=director.hierarchy;
 assert.equal(hierarchy.authority.role,'chief-development-orchestrator');
 assert.ok(hierarchy.categories.length>=12);
 assert.equal(new Set(hierarchy.categories.map(c=>c.id)).size,hierarchy.categories.length);
 assert.ok(hierarchy.roles.some(x=>x.id==='director'&&x.level===0));
 assert.equal(hierarchy.roles.filter(x=>x.level===1).length,3);
 assert.equal(hierarchy.roles.filter(x=>x.level===2).length,12);
 assert.ok(hierarchy.categories.every(c=>c.division && hierarchy.roles.some(r=>r.id===c.division&&r.level===1)));
 assert.ok(hierarchy.roles.filter(x=>x.level===2).every(r=>hierarchy.roles.some(p=>p.id===r.parent&&p.level===1)));
 assert.ok(hierarchy.categories.every(c=>hierarchy.roles.some(r=>r.id===c.owner)));
 assert.equal(hierarchy.authority.autonomy.publishRelease,false);
 assert.equal(hierarchy.authority.autonomy.modifyProduction,false);
});
test('the chief assigns real cases to specialists instead of leaving tasks unowned',()=>{
 const sqlite=director.classify({title:'SQLite database crash',target:'enterprise',files:['hapi_enterprise/sqlite-store.js']});
 assert.equal(sqlite.category,'storage');
 assert.equal(sqlite.owner,'storage-agent');
 assert.equal(sqlite.division,'reliability-lead');
 assert.equal(sqlite.risk,'critical');
 const release=director.classify({title:'New version release build docker tag',target:'devtools'});
 assert.equal(release.category,'release');
 assert.equal(release.owner,'release-agent');
 const locale=director.classify({title:'Missing BG/EN translations for HA settings',target:'integration'});
 assert.equal(locale.category,'localization');
 const unknown=director.classify({title:'Mystery XYZ',target:'unknown'});
 assert.equal(unknown.owner,'director');
 assert.ok(director.buildPlan({title:'Cache performance issue',target:'devtools'}).plan.length>=6);
 assert.equal(director.buildPlan({title:'Fix release',target:'enterprise'}).automation,'analysis-only');
 assert.throws(()=>director.classify({title:''}),/INVALID_TASK_TITLE/);
});
test('no AI task may jump straight to production without independent authorization',()=>{
 assert.equal(director.validateTransition('new','released').allowed,false);
 assert.equal(director.validateTransition('review-ready','approved').allowed,false);
 assert.equal(director.validateTransition('review-ready','approved',{
   role:'external-release-controller',evidence:['signed-intent','independent-ci','external-rollback']}).allowed,true);
 assert.equal(director.validateTransition('candidate-ready','variant-a-tested').allowed,true);
 assert.equal(director.validateTransition('approved','released',{
   role:'external-release-controller',evidence:['signed-intent','independent-ci','external-rollback']}).allowed,false);
});
test('chief creates categorized backlog from existing verified source protocols',()=>{
 const backlog=workload.inventory();
 assert.ok(backlog.total>=15);
 assert.equal(backlog.total,backlog.tasks.length);
 assert.ok(backlog.tasks.some(x=>x.historicalDefectId));
 assert.ok(backlog.tasks.some(x=>x.watchId));
 assert.ok(backlog.tasks.some(x=>x.cacheCandidateId));
 assert.ok(backlog.tasks.every(x=>x.owner && x.plan?.length && x.evidenceLevel));
 assert.ok(backlog.tasks.every(x=>x.automation==='analysis-only'));
});
test('SDK adapter has the director at the top and specialists only as read-only tools',async()=>{
 class Agent{
  constructor(x){Object.assign(this,x)}
  asTool(x){return {toolName:x.toolName,description:x.toolDescription}}
 }
 const sdk={Agent,run:async()=>({finalOutput:'Analyze and propose a fix only'})};
 const built=sdkManager.createManager(sdk);
 assert.equal(built.director.name,'hAPI-DEV Development Director');
 assert.equal(built.tools.length,12);
 assert.equal(built.tools.length,built.agents.length);
 const result=await sdkManager.analyzeTask({title:'Analyze portal folder regression',target:'enterprise'}, {sdk,maxTurns:2});
 assert.equal(result.status,'advisory-only');
 assert.deepEqual(result.executedActions,[]);
 assert.equal(result.releaseAuthorized,false);
 await assert.rejects(sdkManager.analyzeTask({title:'Fix test'}),/AGENTS_SDK_NOT_CONFIGURED/);
});
