'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {create}=require('../portal_enterprise/job-manager');
(async()=>{
 // Unit: FIFO, concurrency, cancel queued/running, queue bound
 const m=create({concurrency:1,maxQueued:2});
 let release;const gate=new Promise(r=>release=r);
 const a=m.submit('t',async ctx=>{ctx.setTotal(2);ctx.advance();await gate;return 'a'});
 const b=m.submit('t',async()=>'b');const c=m.submit('t',async()=>'c');
 assert.throws(()=>m.submit('t',async()=>'d'),e=>e.status===503);
 assert.equal(m.get(a.id).status,'running');assert.equal(m.get(b.id).status,'queued');
 assert.equal(m.cancel(b.id).status,'cancelled');
 release();await new Promise(r=>setTimeout(r,30));
 assert.equal(m.get(a.id).status,'succeeded');assert.equal(m.get(a.id).progress.done,1);
 assert.equal(m.get(b.id).status,'cancelled');assert.equal(m.get(c.id).result,'c');
 const f=m.submit('t',async()=>{throw new Error('secret detail')});await new Promise(r=>setTimeout(r,20));
 assert.equal(m.get(f.id).status,'failed');assert(!JSON.stringify(m.get(f.id)).includes('secret'));
 const r=m.submit('t',ctx=>new Promise(res=>ctx.signal.addEventListener('abort',()=>res('x'))));
 await new Promise(r=>setTimeout(r,10));m.cancel(r.id);await new Promise(r=>setTimeout(r,10));
 assert.equal(m.get(r.id).status,'cancelled');

 // API
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-jobs-'));
 const port=23000+Math.floor(Math.random()*10000),token='job-manager-test-admin-token-123456789';
 const child=spawn(process.execPath,[path.join(__dirname,'../portal_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_TOKEN:token},stdio:'ignore'});
 const call=async(route,method='GET',data,headers={})=>{const x=await fetch(`http://127.0.0.1:${port}${route}`,{method,headers:{Authorization:`Bearer ${token}`,...headers},body:data});return {status:x.status,data:await x.json()}};
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert(ready,'server did not start');
  assert.equal((await fetch(`http://127.0.0.1:${port}/admin/api/jobs`)).status,401);
  const p=await call('/admin/api/portals','POST',JSON.stringify({slug:'jobs',title:'Jobs'}),{'Content-Type':'application/json'});
  const pid=p.data.id;
  assert.equal((await call(`/admin/api/portals/${pid}/files`,'POST','content',{'X-File-Name':'a.txt'})).status,201);
  const j=await call(`/admin/api/portals/${pid}/integrity-jobs`,'POST');assert.equal(j.status,202);
  let s;for(let i=0;i<100;i++){s=await call(`/admin/api/jobs/${j.data.id}`);if(s.data.status==='succeeded')break;await new Promise(r=>setTimeout(r,30))}
  assert.equal(s.data.status,'succeeded');assert.equal(s.data.result.verified,true);assert.equal(s.data.progress.done,1);
  const list=await call('/admin/api/jobs');assert.equal(list.status,200);assert.equal(list.data.jobs.length,1);
  assert.equal((await call('/admin/api/jobs/00000000-0000-0000-0000-000000000000')).status,404);
  assert.equal((await call(`/admin/api/jobs/${j.data.id}/cancel`,'POST')).status,200);
  console.log('PASS job manager: queue, progress, cancel, error redaction, admin API');
 }finally{child.kill();try{fs.rmSync(dir,{recursive:true,force:true})}catch{}}
})().catch(e=>{console.error(e);process.exitCode=1});
