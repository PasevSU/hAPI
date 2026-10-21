'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-dir-'));
 const token='directory-test-admin-secret-2026-k4',pub=18321,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready);
  const H={authorization:'Bearer '+token,'content-type':'application/json'};
  const call=async(p,m='GET',b)=>{const r=await fetch(B+p,{method:m,headers:H,body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,body:await r.json()}};
  assert.equal((await fetch(B+'/admin/api/directory')).status,401);
  // Variables: seeded, custom, validation, system protected
  let v=await call('/admin/api/variables');assert(v.body.variables.some(x=>x.key==='phone'&&x.system));
  assert.equal((await call('/admin/api/variables','POST',{key:'Bad Key',type:'text'})).status,400);
  assert.equal((await call('/admin/api/variables','POST',{key:'vat_id',type:'text',label:'ДДС №',field:true})).status,201);
  assert.equal((await call('/admin/api/variables','POST',{key:'vat_id',type:'text'})).status,409);
  assert.equal((await call('/admin/api/variables/phone','DELETE')).status,409);
  assert.equal((await call('/admin/api/variables/phone','PATCH',{value:'abc'})).status,400);
  assert.equal((await call('/admin/api/variables/company_domain','PATCH',{value:'martinswerk.de'})).status,200);
  // Rule with unknown field is refused, template works
  assert.equal((await call('/admin/api/directory/rules','POST',{pattern:'@martinswerk.de',defaults:{nope:'x'}})).status,422);
  await call('/admin/api/variables/organization','PATCH',{value:'Martinswerk GmbH'});
  const rule=await call('/admin/api/directory/rules','POST',{pattern:'martinswerk.de',defaults:{organization:'{{organization}}',phone:'+49 2381 1234',website:'https://www.{{company_domain}}',city:'Hamm',country:'Deutschland'}});
  assert.equal(rule.status,201);assert.equal(rule.body.rule.pattern,'@martinswerk.de');
  // One entry fills everything
  const ing=await call('/admin/api/directory/ingest','POST',{emails:'max.mustermann@martinswerk.de, anna-schmidt@MARTINSWERK.de; bad@@x, info@other.org'});
  assert.deepEqual(ing.body.created.sort(),['anna-schmidt@martinswerk.de','info@other.org','max.mustermann@martinswerk.de']);
  assert.deepEqual(ing.body.invalid,['bad@@x']);assert.deepEqual(ing.body.unmatched,['info@other.org']);
  let d=(await call('/admin/api/directory')).body;
  const max=d.contacts.find(c=>c.email==='max.mustermann@martinswerk.de');
  assert.equal(max.fields.name,'Max Mustermann');assert.equal(max.fields.organization,'Martinswerk GmbH');assert.equal(max.fields.website,'https://www.martinswerk.de');assert.equal(max.fields.city,'Hamm');
  assert.equal(d.contacts.find(c=>c.email==='info@other.org').fields.name,undefined);
  assert.equal(d.conflicts.length,0);
  // Overlapping rules with different values -> conflict container, contact keeps agreed fields
  await call('/admin/api/directory/rules','POST',{pattern:'@sales.martinswerk.de',defaults:{phone:'+49 2381 9999',country:'Deutschland'}});
  const ing2=await call('/admin/api/directory/ingest','POST',{emails:['eva.meier@sales.martinswerk.de']});
  assert.equal(ing2.body.conflicts,1);
  d=(await call('/admin/api/directory')).body;assert.equal(d.conflicts.length,1);
  const cf=d.conflicts[0];assert.equal(cf.field,'phone');assert.equal(cf.candidates.length,2);
  const eva=d.contacts.find(c=>c.email==='eva.meier@sales.martinswerk.de');assert.equal(eva.fields.phone,undefined);assert.equal(eva.fields.country,'Deutschland');
  // Re-running does not duplicate the conflict; manual resolution
  await call('/admin/api/directory/ingest','POST',{emails:['eva.meier@sales.martinswerk.de']});assert.equal((await call('/admin/api/directory')).body.conflicts.length,1);
  assert.equal((await call(`/admin/api/directory/conflicts/${cf.id}/resolve`,'POST',{value:'+49 2381 9999'})).status,200);
  d=(await call('/admin/api/directory')).body;assert.equal(d.conflicts.length,0);assert.equal(d.contacts.find(c=>c.email===eva.email).fields.phone,'+49 2381 9999');
  // Manual edit that differs from a rule raises a conflict on re-ingest; editing resolves it
  await call(`/admin/api/directory/contacts/${max.id}`,'PATCH',{fields:{city:'Dortmund',vat_id:'DE123'}});
  await call('/admin/api/directory/ingest','POST',{emails:[max.email]});
  d=(await call('/admin/api/directory')).body;assert.equal(d.conflicts.filter(x=>x.field==='city').length,1);
  // New rule back-fills existing contacts
  const r2=await call('/admin/api/directory/rules','POST',{pattern:'@other.org',defaults:{organization:'Other Org'}});assert.equal(r2.body.applied,1);
  assert.equal((await call('/admin/api/directory')).body.contacts.find(c=>c.email==='info@other.org').fields.organization,'Other Org');
  // Variable in use cannot be deleted
  assert.equal((await call('/admin/api/variables/organization','DELETE')).status,409);
  assert.equal((await call(`/admin/api/directory/contacts/${max.id}`,'DELETE')).status,200);
  console.log('directory-variables OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
