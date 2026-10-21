'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'audit-export-'));
 const token='audit-export-admin-secret-2026-z2',pub=18420,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const j=async(p,m='GET',b)=>{const r=await fetch(B+p,{method:m,headers:H,body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,ct:r.headers.get('content-type')||'',body:await r.text()}};
  let r=await j('/admin/api/portals','POST',{slug:'audit-portal',title:'Audit'});assert.equal(r.status,201);
  const pid=JSON.parse(r.body).id;
  // Generate a portal-scoped audit event via a raw file upload
  const up=await fetch(B+'/admin/api/portals/'+pid+'/files',{method:'POST',headers:{...H,'x-file-name':'a.txt'},body:'hello'});assert.equal(up.status,201);
  // JSON export (poll briefly: audit appends are fire-and-forget)
  let json;
  for(let i=0;i<50&&!json;i++){
   r=await j('/admin/api/audit/export');assert.equal(r.status,200);
   const candidate=JSON.parse(r.body);
   if(candidate.byEvent['portal.update']>=1&&candidate.byEvent['file.upload']>=1)json=candidate;
   else await new Promise(res=>setTimeout(res,50));
  }
  assert.ok(json,'audit events exported');
  assert.equal(json.order,'oldest-first');assert.ok(json.count>=2,'audit events exported');assert.ok(json.byEvent['portal.update']>=1);assert.ok(json.byEvent['file.upload']>=1);
  assert.equal(json.firstAt<=json.lastAt,true);
  // Filtered by portal
  r=await j('/admin/api/audit/export?portalId='+pid);const filtered=JSON.parse(r.body);
  assert.ok(filtered.events.every(e=>e.portalId===pid),'portal filter applied');
  // CSV export
  r=await j('/admin/api/audit/export?format=csv');assert.equal(r.status,200);
  assert.ok(r.ct.includes('text/csv'),'CSV content type');assert.ok(/^(\ufeff)?at,event,portalId,fileId,actor,ip,details/.test(r.body),'CSV header present');assert.ok(r.body.includes('file.upload'),'CSV rows present');
  console.log('audit-export OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
