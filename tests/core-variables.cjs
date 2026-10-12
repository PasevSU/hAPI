'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'core-vars-'));
 const token='core-vars-admin-secret-2026-x9',pub=18403,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b)=>{const r=await fetch(B+p,{method:m,headers:H,body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,body:await r.json()}};
  let r=await call('/admin/api/v2/groups','POST',{name:'Г'});
  assert.equal(r.status,201);const gid=r.body.id;
  r=await call('/admin/api/v2/groups/'+gid);const rec1000=r.body.records.find(x=>x.prefix==='1000');
  const rec2000=r.body.records.find(x=>x.prefix==='2000');
  // Typed field round-trip: email lowercased, list -> array
  r=await call('/admin/api/v2/records/'+rec1000.id,'PATCH',{fields:{name:'Иван Петров',email:'IVAN@Example.COM',phone:'+359 888 123 456',website:'https://example.com'}});
  assert.equal(r.status,200);assert.equal(r.body.fields.email,'ivan@example.com');
  r=await call('/admin/api/v2/records/'+rec2000.id,'PATCH',{fields:{title:'Документ',tags:'a,b,c'}});
  assert.equal(r.status,200);assert.deepEqual(r.body.fields.tags,['a','b','c']);
  // Invalid email rejected; unknown field rejected
  assert.equal((await call('/admin/api/v2/records/'+rec1000.id,'PATCH',{fields:{email:'not-an-email'}})).status,400);
  assert.equal((await call('/admin/api/v2/records/'+rec1000.id,'PATCH',{fields:{bogus:'x'}})).status,422);
  // Search finds the record by non-encrypted text
  r=await call('/admin/api/v2/search?q=ivan');assert.equal(r.status,200);
  assert(r.body.results.some(x=>x.id===rec1000.id));
  r=await call('/admin/api/v2/search?q=zzzznope');assert.equal(r.body.results.length,0);
  // Filtered list by prefix
  r=await call('/admin/api/v2/records?prefix=1000');assert(r.body.records.every(x=>x.prefix==='1000'));
  // Delete record
  assert.equal((await call('/admin/api/v2/records/'+rec2000.id,'DELETE')).status,200);
  assert.equal((await call('/admin/api/v2/records/'+rec2000.id)).status,404);
  console.log('core-variables OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
