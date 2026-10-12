'use strict';
// Phase 4.2 isolated coverage: retention policies (module) + audit list/export (HTTP).
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const retention=require('../hapi_enterprise/retention');

// --- Pure-module: retention preview/apply (disable, delete, audit prune) ---
(async()=>{
{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ret-'));
 const filesRoot=path.join(dir,'files'),auditPath=path.join(dir,'audit.jsonl');
 fs.mkdirSync(path.join(filesRoot,'p1'),{recursive:true});
 const filePath=path.join(filesRoot,'p1','f1');fs.writeFileSync(filePath,'data');
 const old=Date.now()-2*86400000;
 const portals=[{id:'p1',files:[{id:'f1',name:'old.txt',uploadedAt:new Date(old).toISOString(),accessMode:'FREE'}]}];
 // disable path
 const r1=retention.create({filesRoot,auditPath,getSettings:()=>({retention:{enabled:true,fileDays:1,auditDays:null,fileAction:'disable'}})});
 let pv=await r1.preview(portals);assert.equal(pv.files.length,1,'preview sees expired file');
 let ap=await r1.apply(portals);assert.equal(ap.disabled,1,'file disabled');assert.equal(portals[0].files[0].accessMode,'DISABLED');assert.ok(fs.existsSync(filePath),'disable keeps bytes');
 // delete path
 portals[0].files[0].accessMode='FREE';
 const r2=retention.create({filesRoot,auditPath,getSettings:()=>({retention:{enabled:true,fileDays:1,auditDays:null,fileAction:'delete'}})});
 ap=await r2.apply(portals);assert.equal(ap.deleted,1,'file deleted');assert.ok(!fs.existsSync(filePath),'delete removes bytes');
 // audit prune path
 fs.writeFileSync(auditPath,JSON.stringify({at:new Date(Date.now()-2*86400000).toISOString(),event:'x'})+'\n'+JSON.stringify({at:new Date().toISOString(),event:'y'})+'\n');
 const r3=retention.create({filesRoot,auditPath,getSettings:()=>({retention:{enabled:true,fileDays:null,auditDays:1,fileAction:'disable'}})});
 ap=await r3.apply([]);assert.equal(ap.auditLinesPruned,1,'audit pruned');
 assert.equal(fs.readFileSync(auditPath,'utf8').split('\n').filter(Boolean).length,1,'one audit line kept');
 fs.rmSync(dir,{recursive:true,force:true});
}
})();

(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ret-audit-'));
 const token='retention-audit-admin-secret-2026';const pub=18423,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b,h={})=>{const body=b===undefined?undefined:Buffer.isBuffer(b)?b:JSON.stringify(b);const r=await fetch(B+p,{method:m,headers:{...H,...h},body});const ct=r.headers.get('content-type')||'';return {status:r.status,ct,body:ct.includes('json')?await r.json():await r.text()}};
  let r=await call('/admin/api/portals','POST',{slug:'ra-portal',title:'RA'});assert.equal(r.status,201);
  const pid=r.body.id;
  r=await call('/admin/api/portals/'+pid+'/files','POST',Buffer.from('doc','utf8'),{'x-file-name':'doc.txt'});assert.equal(r.status,201);
  // audit list
  r=await call('/admin/api/audit','GET');assert.equal(r.status,200);assert.ok(Array.isArray(r.body.events),'events array');assert.ok(Number.isInteger(r.body.count),'count');
  // audit export json
  r=await call('/admin/api/audit/export?format=json','GET');assert.equal(r.status,200);assert.ok(Array.isArray(r.body.events));assert.ok(r.body.byEvent&&typeof r.body.byEvent==='object','byEvent');
  // audit export csv
  r=await call('/admin/api/audit/export?format=csv','GET');assert.equal(r.status,200);assert.ok(r.ct.includes('text/csv'),'csv content-type');assert.ok(r.body.startsWith('at,event,portalId,fileId,actor,ip,details'),'csv header');
  // audit export invalid format
  r=await call('/admin/api/audit/export?format=xml','GET');assert.equal(r.status,400,'invalid format 400');
  // retention preview (disabled by default)
  r=await call('/admin/api/retention','GET');assert.equal(r.status,200);assert.equal(r.body.enabled,false);
  // retention apply while disabled
  r=await call('/admin/api/retention','POST');assert.equal(r.status,200);assert.equal(r.body.applied,false);
  // enable retention, then apply (recent file unaffected)
  r=await call('/admin/api/settings','PATCH',{retention:{enabled:true,fileDays:365,auditDays:null,fileAction:'disable'}});assert.equal(r.status,200);
  r=await call('/admin/api/retention','POST');assert.equal(r.status,200);assert.equal(r.body.applied,true);assert.equal((r.body.deleted||0)+(r.body.disabled||0),0,'recent file untouched');
  console.log('retention-audit OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
