'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');const {open}=require('../portal_enterprise/sqlite-store');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-sqlite-'));const file=path.join(dir,'database','db.json');
try{
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const legacy={portals:[{id:'p1',slug:'alpha',title:'Alpha',files:[{id:'f1',name:'a.html',size:42}]}],qrArtifacts:[{qrId:'QR1'}]};fs.writeFileSync(file,JSON.stringify(legacy));
 let store=open(file);assert.deepEqual(store.load(),legacy);assert.equal(store.stats().engine,'sqlite');
 const changed=structuredClone(legacy);changed.portals[0].title='Updated';store.save(changed);store.close();
 // A stale or damaged JSON snapshot must not override the authoritative SQLite state.
 fs.writeFileSync(file,'not json');store=open(file);assert.equal(store.load().portals[0].title,'Updated');
 const broken=structuredClone(changed);broken.portals.push({id:'p2',slug:'alpha',title:'Duplicate slug',files:[]});
 assert.throws(()=>store.save(broken));assert.equal(store.load().portals.length,1);
 store.close();const sql=new DatabaseSync(file.replace('.json','.sqlite'));assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM portal_index').get().n,1);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM file_index').get().n,1);sql.close();
 console.log('PASS SQLite: legacy import, persistent restart, authoritative state, transaction rollback, indexes');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
