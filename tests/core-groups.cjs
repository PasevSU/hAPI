'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'core-groups-'));
 const token='core-groups-admin-secret-2026-x9',pub=18402,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b)=>{const r=await fetch(B+p,{method:m,headers:H,body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,body:await r.json()}};
  // Create group -> auto-generates one record per profile (6)
  let r=await call('/admin/api/v2/groups','POST',{name:'Отдел А'});
  assert.equal(r.status,201);assert(/^[a-f0-9]{16}$/.test(r.body.id));
  const gid=r.body.id;
  assert.equal((await call('/admin/api/v2/groups','POST',{name:''})).status,400);
  // List shows recordCount=6
  r=await call('/admin/api/v2/groups');assert.equal(r.status,200);assert.equal(r.body.groups.length,1);assert.equal(r.body.groups[0].recordCount,6);
  // Group detail exposes the 6 auto records
  r=await call('/admin/api/v2/groups/'+gid);assert.equal(r.status,200);assert.equal(r.body.records.length,6);
  const rec1000=r.body.records.find(x=>x.prefix==='1000');assert(rec1000);
  // Rename group and confirm variables survive (key uses stable group id, not name)
  r=await call('/admin/api/v2/groups/'+gid,'PATCH',{name:'Отдел Б'});assert.equal(r.status,200);assert.equal(r.body.name,'Отдел Б');
  await call('/admin/api/v2/records/'+rec1000.id,'PATCH',{fields:{name:'Иван'}});
  r=await call('/admin/api/v2/groups/'+gid,'PATCH',{name:'Отдел В'});assert.equal(r.status,200);
  r=await call('/admin/api/v2/records/'+rec1000.id);assert.equal(r.status,200);assert.equal(r.body.fields.name,'Иван');
  // Deleting the group cascades its records
  r=await call('/admin/api/v2/groups/'+gid,'DELETE');assert.equal(r.status,200);
  assert.equal((await call('/admin/api/v2/groups')).body.groups.length,0);
  assert.equal((await call('/admin/api/v2/records/'+rec1000.id)).status,404);
  console.log('core-groups OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
