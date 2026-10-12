'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-apiqr-'));
 const token='apiqr-test-admin-secret-2026-b7c3',pub=18297;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub),PUBLIC_BASE_URL:'https://example.test'},stdio:'pipe'});
 try{
  let ready=false;
  for(let i=0;i<70;i++){try{if((await fetch(`http://127.0.0.1:${pub}/health`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready,'server startup');
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const mk=await fetch(`http://127.0.0.1:${pub}/admin/api/portals`,{method:'POST',headers:H,body:JSON.stringify({slug:'demo',title:'Demo'})});
  assert.equal(mk.status,201);const pid=(await mk.json()).id;
  const d=path.join(dir,'api','demo');
  for(const f of ['api.json','openapi.json','qr.svg'])assert(fs.existsSync(path.join(d,f)),f+' missing');
  const info=JSON.parse(fs.readFileSync(path.join(d,'api.json'),'utf8'));
  assert.equal(info.apiUrl,'https://example.test/api/v1/p/demo');
  assert(fs.readFileSync(path.join(d,'qr.svg'),'utf8').startsWith('<svg'));
  const r=await fetch(`http://127.0.0.1:${pub}/api/v1/p/demo/qr.svg`,{headers:{authorization:'Bearer '+token}});
  assert([200,404].includes(r.status));
  const del=await fetch(`http://127.0.0.1:${pub}/admin/api/portals/${pid}`,{method:'DELETE',headers:H});
  assert.equal(del.status,200);
  assert(!fs.existsSync(d),'api dir not removed');
  console.log('portal-api-qr OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
