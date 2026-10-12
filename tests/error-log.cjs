'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {create}=require('../portal_enterprise/error-log');
(async()=>{
 // Unit: append/list ordering, level + source filters, size/count pruning
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-errlog-'));
 const log=create(dir,{maxEntries:2});
 await log.append('error','src-a','m1');await log.append('warn','src-b','m2');await log.append('info','src-a','m3');
 let events=await log.list();assert.equal(events.length,2); // pruned to maxEntries=2, newest first
 assert.equal(events[0].message,'m3');assert.equal(events[1].message,'m2');
 const big=create(path.join(dir,'full'));await big.append('error','x','e1');await big.append('info','y','e2');
 assert.equal((await big.list()).length,2);
 assert.equal((await big.list({level:'error'})).length,1);
 assert.equal((await big.list({source:'y'})).length,1);
 await big.append('error','x','e3');
 assert.equal((await big.list({level:'error',source:'x'})).length,2);

 // API: errors require auth; a failed restore is recorded centrally
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'portal-errlog-api-'));
 const port=24000+Math.floor(Math.random()*10000),token='error-log-test-admin-token-123456789';
 const child=spawn(process.execPath,[path.join(__dirname,'../portal_enterprise/server.js')],{env:{...process.env,DATA_DIR:root,PORT:String(port),ADMIN_TOKEN:token},stdio:'ignore'});
 const call=async(route,method='GET',data,headers={})=>{const x=await fetch(`http://127.0.0.1:${port}${route}`,{method,headers:{Authorization:'Bearer '+token,...headers}});return {status:x.status,data:await x.json()}};
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert(ready,'server did not start');
  assert.equal((await fetch(`http://127.0.0.1:${port}/admin/api/errors`)).status,401);
  let initial=await call('/admin/api/errors');assert.equal(initial.status,200);assert(Array.isArray(initial.data.events));
  // Corrupt backup triggers a real restore failure -> 422 and a central error entry
  fs.mkdirSync(path.join(root,'backups'),{recursive:true});
  fs.writeFileSync(path.join(root,'backups','corrupt.sqlite'),'not a sqlite database');
  const bad=await call('/admin/api/database/backups/corrupt.sqlite/restore','POST');assert.equal(bad.status,422);
  let seen=[];for(let i=0;i<60;i++){const r=await call('/admin/api/errors?source=backup-restore');seen=r.data.events;if(seen.length)break;await new Promise(r=>setTimeout(r,50))}
  assert(seen.length>=1,'restore failure was recorded centrally');
  assert.equal(seen[0].level,'error');assert.equal(seen[0].source,'backup-restore');
  // limit + level validation
  assert.equal((await call('/admin/api/errors?limit=0')).status,400);
  assert.equal((await call('/admin/api/errors?level=nope')).status,400);
  console.log('PASS error log: unit ordering/filter/prune + admin API + centralized restore failure');
 }finally{child.kill();try{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true})}catch{}}
})().catch(e=>{console.error(e);process.exitCode=1});
