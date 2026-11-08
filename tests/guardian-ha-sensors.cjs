'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {writeStatus,publicStatus}=require('../hapi_enterprise/guardian/status.js');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guardian-status-'));
try{
  assert.equal(publicStatus({dir,enabled:false}).state,'disabled');
  assert.equal(publicStatus({dir,enabled:true}).state,'unknown');
  const item=writeStatus(dir,{state:'healthy'},{failureCount:0,cacheCandidates:3});
  assert.match(item.at,/Z$/);
  const snapshot=publicStatus({dir,enabled:true});
  assert.equal(snapshot.available,true);
  assert.equal(snapshot.state,'healthy');
  assert.equal(snapshot.cacheCandidates,3);
  assert.equal(snapshot.successPercent,null,'never fabricate a success percentage');
  assert.equal(snapshot.automaticChanges,0);
  assert.equal(snapshot.remediationMode,'disabled');
  assert.equal(publicStatus({dir,enabled:true,now:Date.now()+600000}).state,'unknown','stale health must not be healthy');
  assert.throws(()=>writeStatus(dir,{state:'imaginary'}),/INVALID/);
  const source=fs.readFileSync(path.join(__dirname,'../hapi_enterprise/server.js'),'utf8');
  assert.match(source,/guardian\/status/,'health telemetry is exposed in authenticated sensors API');
  const ha=fs.readFileSync(path.join(__dirname,'../custom_components/hapi_enterprise/coordinator.py'),'utf8');
  assert.match(ha,/out\.update\(_normalize_guardian\(payload\.get\("guardian"\)\)\)/);
  const sensors=fs.readFileSync(path.join(__dirname,'../custom_components/hapi_enterprise/sensor.py'),'utf8');
  for(const name of ['guardian_state','guardian_failures','guardian_cache_candidates','guardian_success_percent']) assert.ok(sensors.includes('key="'+name+'"'));
  const binary=fs.readFileSync(path.join(__dirname,'../custom_components/hapi_enterprise/binary_sensor.py'),'utf8');
  assert.ok(binary.includes('key="guardian_issue"'));
  const root=path.join(__dirname,'../custom_components/hapi_enterprise');
  for(const file of ['strings.json','translations/en.json','translations/bg.json']){
    const data=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
    for(const name of ['guardian_state','guardian_failures','guardian_cache_candidates','guardian_success_percent']) assert.ok(data.entity.sensor[name]?.name);
    assert.ok(data.entity.binary_sensor.guardian_issue?.name);
  }
  console.log('guardian native HA telemetry contract: OK');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
