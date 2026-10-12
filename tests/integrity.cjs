'use strict';
const { stopChild } = require('./helpers.cjs');
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-integrity-'));
 const port=23000+Math.floor(Math.random()*2000),token='integration-test-secret-at-least-24-chars';
 const child=spawn(process.execPath,[path.join(__dirname,'../portal_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_TOKEN:token},stdio:'ignore'});
 const call=async(route,method='GET',data,headers={})=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method,headers:{Authorization:`Bearer ${token}`,...headers},body:data});return {status:r.status,data:await r.json()}};
 try{
 let ready=false;for(let i=0;i<100;i++){try{if((await call('/health')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,30))}assert(ready);
 const created=await call('/admin/api/portals','POST',JSON.stringify({slug:'integrity',title:'Integrity'}),{'Content-Type':'application/json'});assert.equal(created.status,201);const pid=created.data.id;
 const uploaded=await call(`/admin/api/portals/${pid}/files`,'POST','original',{'X-File-Name':'evidence.txt'});assert.equal(uploaded.status,201);const fid=uploaded.data.id;
 let check=await call(`/admin/api/portals/${pid}/integrity`);assert.equal(check.status,200);assert.equal(check.data.files[0].status,'VERIFIED');
 fs.writeFileSync(path.join(dir,'files',pid,fid),'tampered');check=await call(`/admin/api/portals/${pid}/integrity`);assert.equal(check.data.files[0].status,'MISMATCH');assert.equal(check.data.verified,false);
 fs.unlinkSync(path.join(dir,'files',pid,fid));check=await call(`/admin/api/portals/${pid}/integrity`);assert.equal(check.data.files[0].status,'MISSING');
 const r=await fetch(`http://127.0.0.1:${port}/admin/api/portals/${pid}/integrity`);assert.equal(r.status,401);
 console.log('PASS integrity: verified, tamper detection, missing file, unauthorized access');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
