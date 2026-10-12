'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'file-encrypt-'));
 const token='file-encrypt-admin-secret-2026-x9',pub=18418,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b,h={})=>{const body=b===undefined?undefined:Buffer.isBuffer(b)?b:(typeof b==='string'?b:JSON.stringify(b));const r=await fetch(B+p,{method:m,headers:{...H,...h},body});const ct=r.headers.get('content-type')||'';return {status:r.status,body:ct.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())}};
  let r=await call('/admin/api/portals','POST',{slug:'enc-portal',title:'Encrypted'});
  assert.equal(r.status,201);const pid=r.body.id;
  const plain=Buffer.from('Строго поверителен документ — Q1 отчет\n'),plainHex=require('node:crypto').createHash('sha256').update(plain).digest('hex');
  // Upload with encryption requested
  r=await call('/admin/api/portals/'+pid+'/files','POST',plain,{'x-file-name':'q1.txt','x-file-encrypt':'1'});
  assert.equal(r.status,201);const f=r.body;
  assert.equal(f.encrypted,true,'file reported as encrypted');assert.equal(f.size,plain.length);assert.equal(f.sha256,plainHex);
  // Bytes on disk must be ciphertext, not the plaintext
  const diskPath=path.join(dir,'files',pid,f.id);const disk=fs.readFileSync(diskPath);
  assert.equal(disk.subarray(0,6).toString('ascii'),'hapiE1','magic header present');
  assert.ok(!disk.includes(Buffer.from('Q1 отчет')),'plaintext must not appear on disk');
  // Integrity verification must still pass (decrypt-then-hash)
  r=await call('/admin/api/portals/'+pid+'/integrity');
  assert.equal(r.status,200);assert.equal(r.body.verified,true);assert.equal(r.body.summary.VERIFIED,1);
  // Make public and confirm download returns the original plaintext
  r=await call('/admin/api/portals/'+pid,'PATCH',{visibility:'public'});assert.equal(r.status,200);
  const dl=await fetch(B+'/api/v1/p/enc-portal/files/'+f.id+'/download');
  assert.equal(dl.status,200);const dlBuf=Buffer.from(await dl.arrayBuffer());
  assert.ok(dlBuf.equals(plain),'download decodes to original plaintext');
  console.log('file-encryption OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
