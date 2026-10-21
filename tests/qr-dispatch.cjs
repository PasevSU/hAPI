'use strict';
// Phase 4.4 QR/virtual-folder: branded QR landing page, QR artifact revocation,
// and notify dispatch hook (email/SMS via HA notify.*).
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const notify=require('../hapi_enterprise/notify');

(async()=>{
 // --- Pure-module: disabled dispatch + service validation ---
 {
  const n=notify.create({});
  assert.equal(n.enabled(),false,'disabled without token/endpoint');
  await assert.rejects(()=>n.send('notify.smtp',null,{message:'x'}),e=>e.status===503,'disabled throws 503');
 }
 {
  const n=notify.create({token:'t',endpoint:'http://127.0.0.1:1'});
  await assert.rejects(()=>n.send('bad',null,{message:'x'}),e=>e.status===400,'invalid service throws 400');
 }
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qr-dispatch-'));
 const token='qr-dispatch-admin-secret-2026';const pub=18422,mpub=18755;
 const base=`http://127.0.0.1:${pub}`,mockBase=`http://127.0.0.1:${mpub}`;
 // Mock HA notify service endpoint — captures the call.
 let captured=null;
 const mock=http.createServer((req,res)=>{let data='';req.on('data',c=>data+=c);req.on('end',()=>{captured={url:req.url,headers:req.headers,body:data?JSON.parse(data):null};res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}')})});
 await new Promise(r=>mock.listen(mpub,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub),SUPERVISOR_TOKEN:'svc-token',HAPI_NOTIFY_ENDPOINT:mockBase},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(base+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b,h={})=>{const body=b===undefined?undefined:typeof b==='string'?b:JSON.stringify(b);const r=await fetch(base+p,{method:m,headers:{...H,...h},body});const ct=r.headers.get('content-type')||'';return {status:r.status,ct,body:ct.includes('json')?await r.json():await r.text()}};
  let r=await call('/admin/api/portals','POST',{slug:'qr-portal',title:'QR Portal'});assert.equal(r.status,201);
  const pid=r.body.id;
  // --- Dispatch: branded portal link via notify.smtp ---
  captured=null;
  r=await call('/admin/api/notify/dispatch','POST',{portalId:pid,service:'Notify.SMTP',title:'Документи',message:'Важни документи'});
  assert.equal(r.status,200,'dispatch 200');assert.equal(r.body.sent,true);
  assert.ok(captured,'mock received call');assert.equal(captured.url,'/notify/smtp','service normalized to lowercase');
  assert.equal(captured.body.title,'Документи','title passed');assert.ok(String(captured.body.message).includes('/p/'+pid),'message carries branded landing link (portal id)');
  assert.equal(captured.headers.authorization,'Bearer svc-token','supervisor token forwarded');
  // --- Dispatch: invalid service -> 400 ---
  r=await call('/admin/api/notify/dispatch','POST',{portalId:pid,service:'bad'});assert.equal(r.status,400,'invalid service 400');
  // --- Branded QR landing page ---
  r=await call('/admin/api/qr-artifacts','POST',{qrId:'doc-001'});assert.equal(r.status,201);
  const pub=await fetch(base+'/qr/doc-001');assert.equal(pub.status,200);assert.ok((pub.headers.get('content-type')||'').includes('text/html'));
  const html=await pub.text();
  assert.ok(html.includes('PasevSU DEV'),'renders organization');assert.ok(html.includes('Официални документи'),'renders documents section');
  // --- QR artifact revocation ---
  r=await call('/admin/api/qr-artifacts/doc-001','DELETE');assert.equal(r.status,200);assert.equal(r.body.revoked,true);
  assert.equal((await fetch(base+'/qr/doc-001')).status,404,'landing 404 after revoke');
  console.log('qr-dispatch OK');
 }finally{await stopChild(child);await new Promise(r=>mock.close(r));fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
