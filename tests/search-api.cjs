'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'search-api-'));
 const token='search-api-admin-secret-2026-x7',pub=18417,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b)=>{const r=await fetch(B+p,{method:m,headers:H,body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,body:await r.json()}};
  // Group auto-generates records for every profile (1000..5000)
  let r=await call('/admin/api/v2/groups','POST',{name:'Отдел Търсене'});
  assert.equal(r.status,201);const gid=r.body.id;
  r=await call('/admin/api/v2/groups/'+gid);assert.equal(r.status,200);
  const rec1000=r.body.records.find(x=>x.prefix==='1000');assert(rec1000);
  const rec2000=r.body.records.find(x=>x.prefix==='2000');assert(rec2000);
  // Index fields on two profiles
  assert.equal((await call('/admin/api/v2/records/'+rec1000.id,'PATCH',{fields:{name:'Иван Петров'}})).status,200);
  assert.equal((await call('/admin/api/v2/records/'+rec2000.id,'PATCH',{fields:{title:'Договор-42'}})).status,200);
  // Substring search hits the indexed value_text column (case-insensitive)
  r=await call('/admin/api/v2/search?q='+encodeURIComponent('Петров'));
  assert.equal(r.status,200);assert.equal(r.body.results.length,1);assert.equal(r.body.results[0].id,rec1000.id);
  // Prefix filter restricts to a profile
  r=await call('/admin/api/v2/search?prefix=2000&q='+encodeURIComponent('договор'));
  assert.equal(r.status,200);assert.equal(r.body.results.length,1);assert.equal(r.body.results[0].id,rec2000.id);
  r=await call('/admin/api/v2/search?prefix=1000&q='+encodeURIComponent('договор'));
  assert.equal(r.status,200);assert.equal(r.body.results.length,0);
  // No query returns empty list, not an error
  r=await call('/admin/api/v2/search');assert.equal(r.status,200);assert.deepEqual(r.body.results,[]);
  r=await call('/admin/api/v2/search?q='+encodeURIComponent('несъществуващо'));
  assert.equal(r.status,200);assert.equal(r.body.results.length,0);
  console.log('search-api OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
