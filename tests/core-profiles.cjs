'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'core-profiles-'));
 const token='core-profiles-admin-secret-2026-x9',pub=18401,B=`http://127.0.0.1:${pub}`;
 const PROFILES=JSON.stringify({'6000':{label:{bg:'Активи'},fields:[{name:'asset_id',type:'string',required:true,indexed:true},{name:'value',type:'number'},{name:'secret',type:'encrypted'}]}});
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub),PROFILES},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b)=>{const r=await fetch(B+p,{method:m,headers:H,body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,body:await r.json()}};
  // Profiles: built-in 1000-5000 plus custom 6000
  let r=await call('/admin/api/v2/profiles');
  assert.equal(r.status,200);const prefixes=r.body.profiles.map(p=>p.prefix);
  for(const p of ['1000','1001','2000','3000','4000','5000','6000'])assert(prefixes.includes(p),'missing '+p);
  // Unauthenticated is refused
  assert.equal((await fetch(B+'/admin/api/v2/profiles')).status,401);
  // Typed validation on custom profile: number coerced, encrypted round-trips, invalid rejected
  r=await call('/admin/api/v2/records','POST',{prefix:'6000',fields:{asset_id:'A-1',value:'12.5',secret:'topsecret'}});
  assert.equal(r.status,201);assert.equal(r.body.fields.value,12.5);assert.equal(r.body.fields.secret,'topsecret');
  const recId=r.body.id;
  r=await call('/admin/api/v2/records/'+recId);assert.equal(r.status,200);assert.equal(r.body.fields.secret,'topsecret');
  assert.equal((await call('/admin/api/v2/records/'+recId,'PATCH',{fields:{value:'abc'}})).status,400);
  assert.equal((await call('/admin/api/v2/records','POST',{prefix:'6000',fields:{value:1}})).status,422); // required asset_id missing
  assert.equal((await call('/admin/api/v2/records','POST',{prefix:'9999',fields:{}})).status,404); // unknown profile
  console.log('core-profiles OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
