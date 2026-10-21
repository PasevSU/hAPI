'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {create,CAPABILITIES}=require('../hapi_enterprise/rbac');
(async()=>{
 // Unit: role resolution + capability matrix
 const admin='rbac-admin-token-0123456789ABCDEF',operator='rbac-operator-token-0123456789AB',viewer='rbac-viewer-token-0123456789ABC';
 const rbac=create({adminToken:admin,operatorToken:operator,viewerToken:viewer});
 const req=t=>({headers:{authorization:'Bearer '+t}});
 assert.equal(rbac.resolve(req(admin)),'admin');assert.equal(rbac.resolve(req(operator)),'operator');
 assert.equal(rbac.resolve(req(viewer)),'viewer');assert.equal(rbac.resolve(req('x')),null);
 assert.equal(rbac.allowed('viewer','portals','GET'),true);assert.equal(rbac.allowed('viewer','portals','POST'),false);
 assert.equal(rbac.allowed('operator','portals','POST'),true);
 assert.equal(rbac.allowed('operator','settings','PATCH'),false);
 assert.equal(rbac.allowed('admin','anything','POST'),true);
 assert.equal(rbac.allowed(null,'portals','GET'),false);
 assert.equal(rbac.allowed('viewer','*','GET'),false); // untagged routes are admin-only
 assert(CAPABILITIES.settings.admin===true);
 // Делата (cases) се управляват като контактите: operator пише, viewer чете.
 assert.equal(rbac.allowed('operator','cases','POST'),true);
 assert.equal(rbac.allowed('viewer','cases','GET'),true);
 assert.equal(rbac.allowed('viewer','cases','POST'),false);
 assert.equal(rbac.allowed('operator','directory','POST'),true);

 // API: role enforcement across endpoints
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'portal-rbac-api-'));
 const port=27000+Math.floor(Math.random()*10000);
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:root,PORT:String(port),ADMIN_TOKEN:admin,OPERATOR_TOKEN:operator,VIEWER_TOKEN:viewer},stdio:'ignore'});
 const call=async(route,token,method='GET',data)=>{const x=await fetch(`http://127.0.0.1:${port}${route}`,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data});return {status:x.status,data:await x.json()}};
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert(ready,'server did not start');
  // admin creates a portal
  const p=await call('/admin/api/portals',admin,'POST',JSON.stringify({slug:'rbac',title:'RBAC'}));assert.equal(p.status,201);
  // viewer: read allowed, write denied
  assert.equal((await call('/admin/api/portals',viewer)).status,200);
  assert.equal((await call('/admin/api/portals',viewer,'POST',JSON.stringify({slug:'v',title:'v'}))).status,403);
  assert.equal((await call('/admin/api/diagnostics',viewer)).status,200);
  assert.equal((await call('/admin/api/storage/check',viewer,'POST')).status,403);
  // operator: portals + jobs write allowed, settings denied
  assert.equal((await call('/admin/api/portals',operator,'POST',JSON.stringify({slug:'op',title:'op'}))).status,201);
  assert.equal((await call('/admin/api/jobs',operator)).status,200);
  assert.equal((await call('/admin/api/settings',operator,'PATCH',JSON.stringify({}))).status,403);
  // unknown token rejected
  assert.equal((await call('/admin/api/portals','x'.repeat(32))).status,401);
  console.log('PASS rbac: role resolution, capability matrix, admin/operator/viewer enforcement');
 }finally{child.kill();try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
})().catch(e=>{console.error(e);process.exitCode=1});
