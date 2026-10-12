'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-taxonomy-')),port=22000+Math.floor(Math.random()*20000),token='taxonomy-test-token-with-32-characters';const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_TOKEN:token},stdio:'ignore'});const base=`http://127.0.0.1:${port}`;
async function call(route,method='GET',data){const r=await fetch(base+route,{method,headers:{Authorization:'Bearer '+token,...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data!==undefined?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()}}
try{let ready=false;for(let i=0;i<60;i++){try{const r=await fetch(base+'/health');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(ready,'server starts');
const p=(await call('/admin/api/portals','POST',{slug:'taxonomy',title:'Taxonomy'})).data;assert.ok(p.id);
const uploaded=await fetch(base+'/admin/api/portals/'+p.id+'/files',{method:'POST',headers:{Authorization:'Bearer '+token,'X-File-Name':'test.txt'},body:'example'});assert.equal(uploaded.status,201);const f=await uploaded.json();
const endpoint='/admin/api/portals/'+p.id+'/files/'+f.id+'/metadata';assert.equal((await call(endpoint,'PATCH',{topic:'Security',category:'Reports',group:'Legal',tags:['evidence','review']})).status,200);
assert.equal((await call(endpoint,'PATCH',{tags:['']})).status,400);
const page=await call('/admin/api/portals/'+p.id+'/files?category=reports&tag=evidence&group=legal&topic=security');assert.equal(page.data.total,1);assert.equal(page.data.files[0].topic,'Security');
assert.equal((await call('/admin/api/portals/'+p.id+'/files?tag=missing')).data.total,0);
const taxonomy=await call('/admin/api/portals/'+p.id+'/taxonomy');assert.deepEqual(taxonomy.data.tags,['evidence','review']);
const unauth=await fetch(base+'/admin/api/portals/'+p.id+'/taxonomy');assert.equal(unauth.status,401);
console.log('PASS taxonomy: metadata, validation, four filters, taxonomy facets, admin authorization');
}finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
