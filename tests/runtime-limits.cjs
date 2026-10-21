'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const rc=require('../hapi_enterprise/runtime-config.js');
(async()=>{
 assert.deepEqual(rc.validate({}).limits.maxJobs,null);
 for(const bad of [{maxJobs:9},{maxUploadMb:0},{maxDownloadStreams:5000},{storageCheckMinutes:-1},{publicBaseUrl:'javascript:alert(1)'},{corsOrigin:'ftp://x'},{requirePortalToken:'yes'},{nope:1}])assert.throws(()=>rc.validate({limits:bad}));
 assert.equal(rc.validate({limits:{publicBaseUrl:'https://portal.example.com/'}}).limits.publicBaseUrl,'https://portal.example.com');

 // Публичният базов адрес от средата (run.sh → public_domain) се валидира: невалиден не
 // влиза в QR кодовете, а пътят (reverse proxy) се запазва.
 const baseDir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-base-')),savedBase=process.env.PUBLIC_BASE_URL;
 try{
  process.env.PUBLIC_BASE_URL='https://pasev.asuscomm.com/';
  assert.equal(rc.create(baseDir).effective().publicBaseUrl,'https://pasev.asuscomm.com');
  process.env.PUBLIC_BASE_URL='https://pasev.asuscomm.com/hapi/';
  assert.equal(rc.create(baseDir).effective().publicBaseUrl,'https://pasev.asuscomm.com/hapi','пътят се запазва');
  process.env.PUBLIC_BASE_URL='pasev.asuscomm.com';
  assert.equal(rc.create(baseDir).effective().publicBaseUrl,'','без схема не се приема');
  process.env.PUBLIC_BASE_URL='javascript:alert(1)';
  assert.equal(rc.create(baseDir).effective().publicBaseUrl,'');
  process.env.PUBLIC_BASE_URL='';
  assert.equal(rc.create(baseDir).effective().publicBaseUrl,'');
 }finally{
  if(savedBase===undefined)delete process.env.PUBLIC_BASE_URL;else process.env.PUBLIC_BASE_URL=savedBase;
  fs.rmSync(baseDir,{recursive:true,force:true});
 }

 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-lim-'));
 const token='limits-test-admin-secret-2026-k4',pub=18322,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b,h=H)=>{const r=await fetch(B+p,{method:m,headers:h,body:b===undefined?undefined:(typeof b==='string'?b:JSON.stringify(b))});const t=await r.text();let j;try{j=JSON.parse(t)}catch{}return {status:r.status,body:j}};
  const s=await call('/admin/api/settings');
  assert.equal(s.status,200);
  assert.equal(s.body.effective.maxUploadBytes,52428800);
  assert.equal(s.body.effective.maxDownloadStreams,32);
  assert.equal(s.body.effective.maxJobs,1);
  assert.equal(s.body.effective.storageCheckIntervalMs,3600000);
  assert.equal(s.body.effective.requirePortalToken,false);
  assert.equal(s.body.settings.limits.maxUploadMb,null);
  assert.equal((await call('/admin/api/settings','PATCH',{limits:{maxJobs:99}})).status,400);

  // Upload limit applies immediately, without a restart
  assert.equal((await call('/admin/api/cabinet/upload?path=&name=a.txt','POST','x')).status<500,true);
  const p=await call('/admin/api/settings','PATCH',{limits:{maxUploadMb:1,publicBaseUrl:'https://portal.example.com/',maxJobs:2}});
  assert.equal(p.status,200);
  assert.equal(p.body.effective.maxUploadBytes,1048576);
  assert.equal(p.body.effective.publicBaseUrl,'https://portal.example.com');
  assert.equal(p.body.restartRequired,true);
  const again=await call('/admin/api/settings');
  assert.equal(again.body.settings.limits.maxUploadMb,1);
  assert.equal((await call('/admin/api/cabinet/info')).body.maxBytes,1048576);

  // Clearing a field returns to the automatic value
  const c=await call('/admin/api/settings','PATCH',{limits:{maxUploadMb:null,maxJobs:null,publicBaseUrl:''}});
  assert.equal(c.body.effective.maxUploadBytes,52428800);
  assert.equal(c.body.restartRequired,false);
  assert.equal((await fetch(B+'/admin/api/settings',{method:'PATCH',body:'{}',headers:{'content-type':'application/json'}})).status,401);
  console.log('PASS runtime-limits');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
