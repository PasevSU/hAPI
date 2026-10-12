'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-backup-sched-'));
 const port=25000+Math.floor(Math.random()*10000),token='backup-sched-admin-token-123456789';
 const child=spawn(process.execPath,[path.join(__dirname,'../portal_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_TOKEN:token},stdio:'ignore'});
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert(ready,'server did not start');
  const base=`http://127.0.0.1:${port}/admin/api/database/backup-schedule`;
  const auth={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  assert.equal((await fetch(base)).status,401);
  let r=await fetch(base,{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,200);
  let j=await r.json();assert.equal(j.schedule.enabled,false);assert.equal(j.schedule.intervalMinutes,1440);assert.equal(j.nextRunAt,null);
  r=await fetch(base,{method:'PUT',headers:auth,body:JSON.stringify({enabled:true,intervalMinutes:1,maxBackups:3})});assert.equal(r.status,200);
  j=await r.json();assert.equal(j.schedule.enabled,true);assert.equal(j.schedule.intervalMinutes,1);assert.equal(j.schedule.maxBackups,3);
  assert(j.nextRunAt&&Date.parse(j.nextRunAt)>Date.now()&&Date.parse(j.nextRunAt)<=Date.now()+60000);
  const onDisk=JSON.parse(fs.readFileSync(path.join(dir,'config','settings.json'),'utf8'));
  assert.deepEqual(onDisk.backupSchedule,{enabled:true,intervalMinutes:1,maxBackups:3});
  r=await fetch(base,{method:'PUT',headers:auth,body:JSON.stringify({enabled:true,intervalMinutes:0,maxBackups:3})});assert.equal(r.status,500);
  r=await fetch(base,{method:'PUT',headers:auth,body:JSON.stringify({enabled:false})});assert.equal(r.status,200);
  j=await r.json();assert.equal(j.schedule.enabled,false);assert.equal(j.schedule.intervalMinutes,1);assert.equal(j.nextRunAt,null);
  console.log('PASS backup scheduler config API, validation, persistence, auth');
 }finally{child.kill();await new Promise(r=>{child.once('exit',r);setTimeout(r,2000)});fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
