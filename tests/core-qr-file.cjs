'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'core-qrfile-'));
 const token='core-qrfile-admin-secret-2026-x9',pub=18421,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub),PUBLIC_BASE_URL:'https://docs.example.test'},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b,extra={})=>{const r=await fetch(B+p,{method:m,headers:{...H,...extra},body:b===undefined?undefined:(typeof b==='string'?b:JSON.stringify(b)),redirect:'manual'});return {status:r.status,headers:r.headers,text:await r.text()}};

  let r=await call('/admin/api/portals','POST',{slug:'docs',title:'Документи'});
  assert.equal(r.status,201);const pid=JSON.parse(r.text).id;
  r=await call('/admin/api/portals/'+pid,'PATCH',{visibility:'public'});assert.equal(r.status,200);

  // Качване на файл → per-file QR.
  r=await call('/admin/api/portals/'+pid+'/files','POST','hello-official-doc',{'x-file-name':'udostoverenie.pdf'});
  assert.equal(r.status,201);const fid=JSON.parse(r.text).id;

  r=await call('/api/v1/p/docs/files/'+fid+'/qr.svg');
  assert.equal(r.status,200);
  assert.equal(r.headers.get('content-type').startsWith('image/svg+xml'),true);
  assert(r.text.startsWith('<svg'),'per-file QR must be SVG');

  // Legacy redirect: без разширение → каноничен .svg (portal + file).
  r=await call('/api/v1/p/docs/files/'+fid+'/qr');
  assert.equal(r.status,301);
  assert.equal(r.headers.get('location'),'https://docs.example.test/api/v1/p/docs/files/'+fid+'/qr.svg');
  r=await call('/api/v1/p/docs/qr');
  assert.equal(r.status,301);
  assert.equal(r.headers.get('location'),'https://docs.example.test/api/v1/p/docs/qr.svg');

  // Несъществуващ файл → 404.
  assert.equal((await call('/api/v1/p/docs/files/nope/qr.svg')).status,404);

  console.log('core-qr-file OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
