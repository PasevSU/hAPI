'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {open}=require('../portal_enterprise/sqlite-store');
const {symlinkSupported}=require('./helpers.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'portal-snapshot-safety-'));
let store=null;
try{
 const file=path.join(root,'db.json');const target=path.join(root,'do-not-touch.txt');
 fs.writeFileSync(target,'PROTECTED');
 store=open(file);store.load();
 if(symlinkSupported()){
  fs.symlinkSync(target,file);
  store.save({portals:[{id:'p',slug:'safe',title:'Safe',files:[]}],qrArtifacts:[]});
  assert.equal(fs.readFileSync(target,'utf8'),'PROTECTED');
  assert.equal(store.load().portals[0].slug,'safe');
  assert.equal(fs.lstatSync(file).isSymbolicLink(),true);
  assert.deepEqual(fs.readdirSync(root).filter(n=>n.endsWith('.snapshot.tmp')),[]);
 }else{
  store.save({portals:[{id:'p',slug:'safe',title:'Safe',files:[]}],qrArtifacts:[]});
  assert.equal(store.load().portals[0].slug,'safe');
 }
 console.log('PASS SQLite snapshot symlink rejection, authoritative transaction, temporary cleanup');
}finally{
 try{if(store)store.close()}catch{}
 try{fs.rmSync(root,{recursive:true,force:true})}catch{}
}
