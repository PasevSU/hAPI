'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'portal-sqlite-size-'));
try{
 const store=require('../hapi_enterprise/sqlite-store.js').open(path.join(root,'db.json'));
 try{
  store.load();const s=store.stats();
  assert.equal(s.engine,'sqlite');
  assert.equal(s.bytes,s.databaseBytes+s.walBytes+s.sharedMemoryBytes);
  assert.ok(s.databaseBytes>0);
  assert.ok(s.walBytes>=0);
  console.log('PASS: SQLite physical size includes WAL and shared-memory files');
 }finally{store.close()}
}finally{fs.rmSync(root,{recursive:true,force:true})}
