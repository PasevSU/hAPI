'use strict';
const { stopChild } = require('./helpers.cjs');
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-audit-'));
 const port=23000+Math.floor(Math.random()*1000),token='test-secret-admin-token-long-enough';
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_TOKEN:token},stdio:'ignore'});
 const call=async(p,method='GET',data,auth=true)=>{const r=await fetch(`http://127.0.0.1:${port}${p}`,{method,headers:{...(auth?{Authorization:`Bearer ${token}`}:{}) ,'Content-Type':'application/json'},body:data});return {status:r.status,data:await r.json()}};
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await call('/health')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,30))}assert(ready);
  assert.equal((await call('/admin/api/audit','GET',undefined,false)).status,401);
  assert.equal((await call('/admin/api/audit?limit=501')).status,400);
  const created=await call('/admin/api/portals','POST',JSON.stringify({slug:'audit-demo',title:'Audit Demo'}));assert.equal(created.status,201);
  let found=false;for(let i=0;i<30;i++){const r=await call(`/admin/api/audit?portalId=${created.data.id}&limit=10`);assert.equal(r.status,200);assert.equal(r.data.integrity,'UNVERIFIED');if(r.data.events.some(e=>e.portalId===created.data.id)){found=true;break}await new Promise(r=>setTimeout(r,20))}assert(found);
  assert.equal((await call('/admin/api/audit?portalId=../../etc')).status,400);
  console.log('PASS audit: authorization, input limits, portal filter, event retrieval, explicit integrity warning');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
