'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const { stopChild } = require('./helpers.cjs');
const {spawn}=require('node:child_process');
// Unit-level retention logic + HTTP endpoint smoke test.
(async()=>{
 const retention=require('../hapi_enterprise/retention.js');
 // --- Module unit test with backdated fixtures ---
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retention-'));
 try{
  const filesRoot=path.join(dir,'files'),auditPath=path.join(dir,'audit.jsonl');
  const old=new Date(Date.now()-40*86400000).toISOString(),recent=new Date().toISOString();
  const portals=[{id:'aaaaaaaaaaaaaaaaaaaaaaaa',files:[{id:'f1',name:'old.txt',uploadedAt:old,accessMode:'FREE'},{id:'f2',name:'new.txt',uploadedAt:recent,accessMode:'FREE'}]}];
  fs.mkdirSync(path.join(filesRoot,'aaaaaaaaaaaaaaaaaaaaaaaa'),{recursive:true});
  fs.writeFileSync(path.join(filesRoot,'aaaaaaaaaaaaaaaaaaaaaaaa','f1'),'x');
  fs.writeFileSync(path.join(filesRoot,'aaaaaaaaaaaaaaaaaaaaaaaa','f2'),'y');
  fs.writeFileSync(auditPath,JSON.stringify({at:old,event:'a'})+'\n'+JSON.stringify({at:recent,event:'b'})+'\n');
  const cfg={enabled:true,fileDays:30,auditDays:30,fileAction:'disable'};
  const r=retention.create({filesRoot,auditPath,getSettings:()=>({retention:cfg})});
  let pv=await r.preview(portals);
  assert.equal(pv.files.length,1);assert.equal(pv.files[0].fileId,'f1');assert.equal(pv.auditLinesExpired,1);
  let ap=await r.apply(portals);
  assert.equal(ap.disabled,1);assert.equal(ap.auditLinesPruned,1);
  assert.equal(portals[0].files.find(x=>x.id==='f1').accessMode,'DISABLED');
  assert.equal(fs.readFileSync(auditPath,'utf8').split('\n').filter(Boolean).length,1);
  // delete action
  const r2=retention.create({filesRoot,auditPath,getSettings:()=>({retention:{enabled:true,fileDays:30,auditDays:null,fileAction:'delete'}})});
  portals[0].files.push({id:'f3',name:'del.txt',uploadedAt:old,accessMode:'FREE'});
  fs.writeFileSync(path.join(filesRoot,'aaaaaaaaaaaaaaaaaaaaaaaa','f3'),'z');
  const ap2=await r2.apply(portals);
  assert.equal(ap2.deleted,1);assert.ok(!fs.existsSync(path.join(filesRoot,'aaaaaaaaaaaaaaaaaaaaaaaa','f3')));
  console.log('retention-module OK');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}

 // --- HTTP endpoint smoke test (default disabled) ---
 const dir2=fs.mkdtempSync(path.join(os.tmpdir(),'retention-http-'));
 const token='retention-admin-secret-2026-y3',pub=18419,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir2,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token};
  let r=await fetch(B+'/admin/api/retention',{headers:H});let b=await r.json();
  assert.equal(r.status,200);assert.equal(b.enabled,false,'retention disabled by default');
  r=await fetch(B+'/admin/api/retention',{method:'POST',headers:H});b=await r.json();
  assert.equal(r.status,200);assert.equal(b.applied,false,'no-op when disabled');
  console.log('retention-http OK');
 }finally{await stopChild(child);fs.rmSync(dir2,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
