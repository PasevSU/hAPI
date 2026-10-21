'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'versioning-'));
 const token='versioning-admin-secret-2026',pub=18422,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b,h={})=>{const body=b===undefined?undefined:Buffer.isBuffer(b)?b:(typeof b==='string'?b:JSON.stringify(b));const r=await fetch(B+p,{method:m,headers:{...H,...h},body});const ct=r.headers.get('content-type')||'';return {status:r.status,ct,body:ct.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())}};
  let r=await call('/admin/api/portals','POST',{slug:'ver-portal',title:'Versions'});assert.equal(r.status,201);
  const pid=r.body.id;
  const v1=Buffer.from('version one content','utf8');
  r=await call('/admin/api/portals/'+pid+'/files','POST',v1,{'x-file-name':'doc.txt'});assert.equal(r.status,201);
  const fid=r.body.id;assert.equal(r.body.version,1);
  // Upload version 2
  const v2=Buffer.from('version TWO content — changed','utf8');
  r=await call('/admin/api/portals/'+pid+'/files/'+fid+'/versions','POST',v2,{'x-version-note':'second revision'});assert.equal(r.status,201);
  assert.equal(r.body.version,2);assert.equal(r.body.file.sha256,require('node:crypto').createHash('sha256').update(v2).digest('hex'));
  // List versions
  r=await call('/admin/api/portals/'+pid+'/files/'+fid+'/versions');assert.equal(r.status,200);
  assert.equal(r.body.total,2);assert.equal(r.body.versions.length,1);assert.equal(r.body.versions[0].version,1);
  assert.equal(r.body.current.version,2);
  // Download archived v1
  r=await call('/admin/api/portals/'+pid+'/files/'+fid+'/versions/1/download');assert.equal(r.status,200);
  assert.ok(r.body.equals(v1),'downloads original v1');
  // Restore v1 -> becomes current v3, content == v1
  r=await call('/admin/api/portals/'+pid+'/files/'+fid+'/versions/1/restore','POST',{});assert.equal(r.status,200);
  assert.equal(r.body.version,3);assert.equal(r.body.file.sha256,require('node:crypto').createHash('sha256').update(v1).digest('hex'));
  r=await call('/admin/api/portals/'+pid+'/files/'+fid+'/versions');assert.equal(r.body.total,3);assert.equal(r.body.current.version,3);
  // Integrity still verifies current content
  r=await call('/admin/api/portals/'+pid+'/integrity');assert.equal(r.status,200);assert.equal(r.body.verified,true);
  console.log('versioning OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
