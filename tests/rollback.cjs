'use strict';
const { stopChild } = require('./helpers.cjs');
const {spawn}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-rollback-'));const token='rollback-test-admin-secret-2026-b8e2';const port=19000+Math.floor(Math.random()*3000);const server=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(port)},stdio:'pipe'});try{
const base=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<70;i++){try{const r=await fetch(base+'/health');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,80))}assert(ready,'server did not start');
const api=async(url,method='GET',payload)=>{const r=await fetch(base+url,{method,headers:{Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});return {status:r.status,data:await r.json()}};
const created=await api('/admin/api/portals','POST',{slug:'rollback',title:'Original'});assert.equal(created.status,201);const id=created.data.id;
const failed=await api('/admin/api/portals/'+id,'PATCH',{title:'Changed',visibility:'not-a-valid-visibility'});assert.equal(failed.status,400);
const after=await api('/admin/api/portals/'+id);assert.equal(after.data.title,'Original');assert.equal(after.data.visibility,'private');
const persisted=JSON.parse(fs.readFileSync(path.join(dir,'db.json'),'utf8'));assert.equal(persisted.portals[0].title,'Original');
console.log('PASS rollback: partial PATCH failure restores memory and persistent JSON');
}finally{await stopChild(server);fs.rmSync(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
