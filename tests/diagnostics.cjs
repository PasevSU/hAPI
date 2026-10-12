'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-diag-'));
 const port=23000+Math.floor(Math.random()*10000),token='diagnostic-test-admin-token-123456789';
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_TOKEN:token},stdio:'ignore'});
 try{
  let ready=false;for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert(ready,'server did not start');
  const base=`http://127.0.0.1:${port}/admin/api/diagnostics`;
  assert.equal((await fetch(base)).status,401);
  const r=await fetch(base,{headers:{Authorization:`Bearer ${token}`}});assert.equal(r.status,200);const d=await r.json();
  assert.equal(typeof d.runtime.rssBytes,'number');assert(d.runtime.rssBytes>0);assert(d.traffic.maxDownloadStreams>=1);assert.equal(d.traffic.activeDownloadStreams,0);assert.equal(d.catalog.portals,0);assert.equal(d.storage.length,3);assert(!JSON.stringify(d).includes(token));assert(!JSON.stringify(d).includes(dir));
  const page=await fetch(`http://127.0.0.1:${port}/admin`);assert((await page.text()).includes('diagnostics-refresh'));
  console.log('PASS diagnostics auth, runtime, capacity, storage, GUI, secret isolation');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
