'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'core-orphan-'));
 const token='core-orphan-admin-secret-2026-x9',pub=18404,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b)=>{const r=await fetch(B+p,{method:m,headers:H,body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,body:await r.json()}};
  // Create an orphan record (no group) and confirm its data persists
  let r=await call('/admin/api/v2/records','POST',{prefix:'2000',fields:{title:'Сирота'}});
  assert.equal(r.status,201);const rid=r.body.id;assert.equal(r.body.group_id,null);
  r=await call('/admin/api/v2/records/'+rid);assert.equal(r.body.group_id,null);assert.equal(r.body.fields.title,'Сирота');
  // Associate into a group: data must survive the scope re-key
  r=await call('/admin/api/v2/groups','POST',{name:'Приют'});const gid=r.body.id;
  r=await call('/admin/api/v2/records/'+rid+'/associate','POST',{groupId:gid});
  assert.equal(r.status,200);assert.equal(r.body.group_id,gid);assert.equal(r.body.fields.title,'Сирота');
  // Detach back to orphan: data still survives
  r=await call('/admin/api/v2/records/'+rid+'/detach','POST');
  assert.equal(r.status,200);assert.equal(r.body.group_id,null);assert.equal(r.body.fields.title,'Сирота');
  // Associate to an unknown group fails
  assert.equal((await call('/admin/api/v2/records/'+rid+'/associate','POST',{groupId:'nope'})).status,404);
  console.log('core-orphan OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
