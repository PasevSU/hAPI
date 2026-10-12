'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'core-repo-'));
  const token='core-repo-admin-secret-2026-x9';
  const registry=require('../hapi_enterprise/registry').create(null);
  const repo=require('../hapi_enterprise/sqlite-repository').create({path:path.join(dir,'core.sqlite'),dbId:'1',secret:token,registry});
  try{
    // Group create with auto-generated records (1000..5000)
    const g=await repo.createGroup({name:'Отдел A',description:'Тестова група'});
    assert(g.id&&g.name==='Отдел A');
    const groups=await repo.listGroups();
    assert.equal(groups.length,1);
    const records=await repo.listRecords(g.id);
    assert.equal(records.length,6,'auto records for 6 built-in profiles');

    // Record create/update (typed + encrypted round-trip)
    const rec=await repo.createRecord({prefix:'3000',group_id:g.id,fields:{slug:'portal-a',title:'Portal A'}});
    assert.equal(rec.fields.slug,'portal-a');
    const upd=await repo.updateRecord(rec.id,{title:'Portal A v2'});
    assert.equal(upd.fields.title,'Portal A v2');
    assert.equal((await repo.getRecord(rec.id)).fields.title,'Portal A v2');
    await assert.rejects(()=>repo.updateRecord('missing',{}),/not found/);

    // Typed field round-trip on an Employee (1001) record
    const emp=await repo.createRecord({prefix:'1001',group_id:g.id,fields:{name:'Ivan',phone:'0888123456',hired_at:'2026-01-15'}});
    assert.equal(emp.fields.name,'Ivan');
    assert.equal(emp.fields.phone,'0888123456');

    // Search
    const hits=await repo.searchRecords(null,'Portal A v2');
    assert(hits.some(r=>r.id===rec.id));

    // Variables (direct + list-for-record)
    await repo.setVariable(rec.id,'slug','portal-b',registry.fieldsFor('3000').find(f=>f.name==='slug'));
    assert.equal((await repo.getVariable('3000-1-'+g.id+'-slug')||{}).value,'portal-b');
    const fields=await repo.listVariablesForRecord(rec.id);
    assert.equal(fields.slug,'portal-b');

    // Meta
    await repo.setMeta('last-migrated','2026-01-01');
    assert.equal(await repo.getMeta('last-migrated'),'2026-01-01');

    // Associate/detach data survival
    const orphan=await repo.createRecord({prefix:'4000',group_id:null,fields:{title:'Свободен текст'}});
    const assoc=await repo.associateRecord(orphan.id,g.id);
    assert.equal(assoc.group_id,g.id);
    assert.equal(assoc.fields.title,'Свободен текст');
    const det=await repo.detachRecord(orphan.id);
    assert.equal(det.group_id,null);
    assert.equal(det.fields.title,'Свободен текст');

    // Interface validation
    assert.throws(()=>require('../hapi_enterprise/repository').create({listGroups(){}}),/missing methods/);
    await repo.close();
    console.log('core-repository OK');
  }finally{
    // node:sqlite WAL може да задържи файловете за миг на Windows — ретрай.
    for(let i=0;i<20;i++){try{fs.rmSync(dir,{recursive:true,force:true});break}catch(e){await new Promise(r=>setTimeout(r,50))}}
  }
})().catch(e=>{console.error(e);process.exit(1)});
