
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');const {open}=require('../portal_enterprise/sqlite-store');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'portal-backup-'));
try {
 const dbPath=path.join(root,'db.json');const store=open(dbPath);store.load();
 store.save({portals:[{id:'p',slug:'p',title:'Test',files:[]}],qrArtifacts:[]});
 const target=path.join(root,'backups','snapshot.sqlite');const result=store.backup(target);
 assert.ok(result.bytes>0);assert.throws(()=>store.backup(target),/exists/);
 store.save({portals:[],qrArtifacts:[]});store.close();
 const copy=new DatabaseSync(target,{readOnly:true});
 assert.equal(JSON.parse(copy.prepare('SELECT payload FROM metadata').get().payload).portals.length,1);
 assert.equal(copy.prepare('PRAGMA quick_check').get().quick_check,'ok');copy.close();
 console.log('PASS SQLite backup: consistent snapshot, no overwrite, independent of later changes');
}finally{fs.rmSync(root,{recursive:true,force:true})}
