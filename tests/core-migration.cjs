'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'core-migrate-'));
 const token='core-migrate-admin-secret-2026-x9',pub=18405,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b)=>{const r=await fetch(B+p,{method:m,headers:H,body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,body:await r.json()}};
  // Seed legacy data: a portal, a directory contact, a cabinet file
  assert.equal((await call('/admin/api/portals','POST',{slug:'test-portal',title:'Тест Портал',description:'описание'})).status,201);
  assert.equal((await call('/admin/api/directory/ingest','POST',{emails:'mig@example.com'})).status,200);
  assert.equal((await call('/admin/api/cabinet/create','POST',{path:'',name:'doc.txt',type:'txt'})).status,201);
  // Analyze reports the three sources
  let r=await call('/admin/api/v2/migrate');assert.equal(r.status,200);
  assert.equal(r.body.contacts,1);assert.equal(r.body.portals,1);assert.equal(r.body.cabinetFiles,1);
  // Dry-run must not write
  r=await call('/admin/api/v2/migrate','POST',{dryRun:true});assert.equal(r.status,200);assert.equal(r.body.dryRun,true);
  assert.equal((await call('/admin/api/v2/groups')).body.groups.length,0);
  // Real migration creates the three groups with no duplicates
  r=await call('/admin/api/v2/migrate','POST',{});assert.equal(r.status,200);assert.equal(r.body.dryRun,false);
  assert.equal(r.body.contacts.created,1);assert.equal(r.body.portals.created,1);assert.equal(r.body.cabinet.created,1);
  let groups=(await call('/admin/api/v2/groups')).body.groups.map(g=>g.name);
  assert(groups.includes('Указател (мигриран)'));assert(groups.includes('Тест Портал'));assert(groups.includes('Картотека (мигриран)'));
  // Re-run is idempotent
  r=await call('/admin/api/v2/migrate','POST',{});assert.equal(r.status,200);
  assert.equal(r.body.contacts.skipped,true);assert.equal(r.body.portals.skipped,true);assert.equal(r.body.cabinet.skipped,true);
  assert.equal((await call('/admin/api/v2/groups')).body.groups.length,3);
  console.log('core-migration OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
