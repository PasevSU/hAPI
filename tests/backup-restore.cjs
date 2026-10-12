'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 // API: backup list, create, restore (restore replaces metadata with the backup snapshot)
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'portal-restore-api-'));
 const port=28000+Math.floor(Math.random()*10000),token='restore-test-admin-token-1234567890';
 const child=spawn(process.execPath,[path.join(__dirname,'../portal_enterprise/server.js')],{env:{...process.env,DATA_DIR:root,PORT:String(port),ADMIN_TOKEN:token},stdio:'ignore'});
 const call=async(route,method='GET',data)=>{const x=await fetch(`http://127.0.0.1:${port}${route}`,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data});return {status:x.status,data:await x.json()}};
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert(ready,'server did not start');
  assert.equal((await call('/admin/api/database/backup','POST')).status,201);
  // seed one portal, then back it up
  const keep=await call('/admin/api/portals','POST',JSON.stringify({slug:'keep-me',title:'Keep'}));assert.equal(keep.status,201);
  const bk=await call('/admin/api/database/backup','POST');assert.equal(bk.status,201);
  const name=bk.data.backup.name;
  const list=await call('/admin/api/database/backups');assert.equal(list.status,200);assert(list.data.backups.some(b=>b.name===name));
  // add a second portal, then restore -> it disappears and the first returns
  const gone=await call('/admin/api/portals','POST',JSON.stringify({slug:'remove-me',title:'Remove'}));assert.equal(gone.status,201);
  assert.equal((await call('/admin/api/portals')).data.portals.length,2);
  const restored=await call(`/admin/api/database/backups/${name}/restore`,'POST');assert.equal(restored.status,200);assert.equal(restored.data.restored.portals,1);
  const after=await call('/admin/api/portals');assert.equal(after.data.portals.length,1);assert.equal(after.data.portals[0].slug,'keep-me');
  // restore of a missing backup -> 404
  assert.equal((await call('/admin/api/database/backups/nope.sqlite/restore','POST')).status,404);
  console.log('PASS backup restore: backup list/create + transactional restore round-trip');
 }finally{child.kill();try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
})().catch(e=>{console.error(e);process.exitCode=1});
