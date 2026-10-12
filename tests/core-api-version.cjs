'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'core-apiver-'));
 const token='core-apiver-admin-secret-2026-x9',pub=18411,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};

  // v2 е текущ: маркиран с X-API-Version, без Deprecation.
  let r=await fetch(B+'/admin/api/v2/profiles',{headers:H});
  assert.equal(r.status,200);
  assert.equal(r.headers.get('x-api-version'),'v2');
  assert.equal(r.headers.get('deprecation'),null);

  // Legacy admin v1 продължава да работи, но е deprecated.
  r=await fetch(B+'/admin/api/settings',{headers:H});
  assert.equal(r.status,200);
  assert.equal(r.headers.get('x-api-version'),'v1');
  assert.equal(r.headers.get('deprecation'),'true');
  assert.equal(r.headers.get('sunset'),'2027-12-31');

  // Публичен API v1 също е legacy (иска свободно, без requirePortalToken).
  r=await fetch(B+'/api/v1/portals');
  assert.equal(r.status,200);
  assert.equal(r.headers.get('x-api-version'),'v1');
  assert.equal(r.headers.get('deprecation'),'true');

  // Не-API маршрути не получават версионни заглавки.
  r=await fetch(B+'/health');
  assert.equal(r.headers.get('x-api-version'),null);
  assert.equal(r.headers.get('deprecation'),null);

  console.log('core-api-version OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
