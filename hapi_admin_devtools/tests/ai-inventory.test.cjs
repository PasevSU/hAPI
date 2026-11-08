'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {inspectChangedPaths,buildReport}=require('../ai/inventory-cli');
test('changed source files are assigned to chief or specialist without mutating repositories',()=>{
 const changed=[
  'hapi_enterprise/sqlite-store.js',
  'hapi_enterprise/portal-policy.js',
  'hapi_admin_devtools/ai/director.js',
  '.github/workflows/admin-devtools-release.yml',
  'custom_components/hapi_enterprise/sensor.py',
 ];
 const report=buildReport(changed);
 assert.equal(report.authority,'hAPI-DEV AI Development Director');
 assert.equal(report.changedModuleCount,changed.length);
 assert.ok(report.changedModules.some(x=>x.category==='storage'&&x.owner==='storage-agent'));
 assert.ok(report.changedModules.some(x=>x.category==='portals'&&x.owner==='portal-agent'));
 assert.ok(report.changedModules.every(x=>x.automation==='analysis-only'));
 assert.equal(report.permissions.writeRepository,false);
 assert.equal(report.permissions.release,false);
 assert.ok(report.historicalTasks>0);
});
test('unsafe changed-file entries are not converted into arbitrary filesystem writes',()=>{
 const x=inspectChangedPaths(['../secrets','/root/.ssh/id_rsa','hapi_enterprise/sqlite-store.js','x\0y']);
 assert.equal(x.length,1);
 assert.deepEqual(x[0].files,['hapi_enterprise/sqlite-store.js']);
 assert.throws(()=>inspectChangedPaths(Array.from({length:5001},()=> 'x')),/CHANGED_FILE_LIMIT/);
});
