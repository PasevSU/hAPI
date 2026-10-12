'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'preview-'));
 const token='preview-admin-secret-2026-x9',pub=18421,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b,h={})=>{const body=b===undefined?undefined:Buffer.isBuffer(b)?b:(typeof b==='string'?b:JSON.stringify(b));const r=await fetch(B+p,{method:m,headers:{...H,...h},body});const ct=r.headers.get('content-type')||'';return {status:r.status,ct,body:ct.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())}};
  let r=await call('/admin/api/portals','POST',{slug:'prev-portal',title:'Preview'});assert.equal(r.status,201);
  const pid=r.body.id;
  const md=Buffer.from('# Отчет\n\nПърви параграф.\n\n- точка едно\n- точка две\n','utf8');
  r=await call('/admin/api/portals/'+pid+'/files','POST',md,{'x-file-name':'report.md'});assert.equal(r.status,201);
  const fid=r.body.id;
  // Admin preview -> HTML
  r=await call('/admin/api/portals/'+pid+'/files/'+fid+'/preview');
  assert.equal(r.status,200);assert.ok(r.ct.includes('text/html'),'preview is html');
  const html=r.body.toString('utf8');
  assert.ok(html.includes('Отчет'),'renders heading');assert.ok(html.includes('точка едно'),'renders list item');
  // Admin thumbnail -> SVG
  r=await call('/admin/api/portals/'+pid+'/files/'+fid+'/thumbnail.svg');
  assert.equal(r.status,200);assert.ok(r.ct.includes('image/svg+xml'),'thumbnail svg');
  assert.ok(r.body.toString('utf8').includes('<svg'),'svg body');
  // Public preview (after making public)
  r=await call('/admin/api/portals/'+pid,'PATCH',{visibility:'public'});assert.equal(r.status,200);
  const pub=await fetch(B+'/api/v1/p/prev-portal/files/'+fid+'/preview');
  assert.equal(pub.status,200);assert.ok((pub.headers.get('content-type')||'').includes('text/html'));
  const pubHtml=await pub.text();assert.ok(pubHtml.includes('Първи параграф'),'public preview content');
  // Disable preview via settings -> 503
  r=await call('/admin/api/settings','PATCH',{preview:{enabled:false}});assert.equal(r.status,200);
  r=await call('/admin/api/portals/'+pid+'/files/'+fid+'/preview');assert.equal(r.status,503);
  console.log('preview-thumbnail OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
