'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const rc=require('../hapi_enterprise/runtime-config.js');
(async()=>{
 assert.deepEqual(rc.validate({}).data,{conflictPolicy:'queue',strictTaxonomy:false,defaultCategory:'',defaultGroup:'',maxTags:30});
 for(const bad of [{conflictPolicy:'x'},{strictTaxonomy:'yes'},{maxTags:0},{maxTags:101},{nope:1},{defaultCategory:'a'.repeat(121)}])assert.throws(()=>rc.validate({data:bad}));

 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-dat-'));
 const token='data-test-admin-secret-2026-k5',pub=18323,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b,h=H)=>{const r=await fetch(B+p,{method:m,headers:h,body:b===undefined?undefined:(typeof b==='string'?b:JSON.stringify(b))});const t=await r.text();let j;try{j=JSON.parse(t)}catch{}return {status:r.status,body:j}};
  assert.equal((await call('/admin/api/settings')).body.settings.data.conflictPolicy,'queue');
  assert.equal((await call('/admin/api/settings','PATCH',{data:{maxTags:500}})).status,400);

  assert.equal((await call('/admin/api/taxonomy','POST',{kind:'category',name:'Docs'})).status,201);
  const save=await call('/admin/api/settings','PATCH',{data:{conflictPolicy:'queue',strictTaxonomy:true,defaultCategory:'Docs',defaultGroup:'',maxTags:2}});
  assert.equal(save.status,200);assert.equal(save.body.settings.data.maxTags,2);

  const portal=await call('/admin/api/portals','POST',{title:'Data test',slug:'data-test'});
  assert.equal(portal.status,201);
  const pid=portal.body.id;
  const up=await fetch(B+`/admin/api/portals/${pid}/files`,{method:'POST',headers:{authorization:'Bearer '+token,'x-file-name':'a.txt','content-type':'application/octet-stream'},body:'hello'});
  assert.equal(up.status,201);const f=await up.json();assert.equal(f.category,'Docs');
  const meta=(b)=>call(`/admin/api/portals/${pid}/files/${f.id}/metadata`,'PATCH',b);
  assert.equal((await meta({category:'Unknown'})).status,400);
  assert.equal((await meta({category:'Docs'})).status,200);
  assert.equal((await meta({tags:['a','b','c']})).status,400);
  assert.equal((await meta({tags:['a','b']})).status,200);

  await call('/admin/api/settings','PATCH',{data:{strictTaxonomy:false,maxTags:30}});
  assert.equal((await meta({category:'Whatever'})).status,200);

  const pol=async(p,email)=>{await call('/admin/api/settings','PATCH',{data:{conflictPolicy:p}});const r=await call('/admin/api/directory/ingest','POST',{emails:[email]});assert.equal(r.status,200);return r.body};
  await call('/admin/api/directory/rules','POST',{pattern:'acme.test',defaults:{phone:'+49 111 1111'}});
  await call('/admin/api/directory/rules','POST',{pattern:'@sales.acme.test',defaults:{phone:'+49 222 2222'}});
  assert((await pol('queue','a@sales.acme.test')).conflicts>=1);
  const d=async()=>(await call('/admin/api/directory')).body;
  assert((await d()).conflicts.length>=1);
  assert.equal((await pol('first','b@sales.acme.test')).conflicts,0);
  assert.equal((await d()).contacts.find(c=>c.email==='b@sales.acme.test').fields.phone,'+49 111 1111');
  assert.equal((await pol('skip','c@sales.acme.test')).conflicts,0);
  assert.equal((await d()).contacts.find(c=>c.email==='c@sales.acme.test').fields.phone,undefined);
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
 console.log('data-settings OK');
})().catch(e=>{console.error(e);process.exit(1)});
