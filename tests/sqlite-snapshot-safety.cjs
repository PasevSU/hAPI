'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const { needsSymlinks, link } = require('./helpers.cjs');
if (needsSymlinks('sqlite-snapshot-safety', 'снимката на базата не презаписва файл през symlink')) return;
const {open}=require('../hapi_enterprise/sqlite-store');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'portal-snapshot-safety-'));
let store=null;
try{
 // Целта е ПАПКА, а не файл: връзка към файл на Windows без права за symlink е „скъсана“
 // (existsSync лъже, четенето дава ENOENT) и проверката минава по грешен път. Папка-връзка
 // стига до същото място в кода — `lstatSync(jsonPath).isSymbolicLink()` — и оставя
 // проверимо, че през връзката не е записан нито един байт.
 const file=path.join(root,'db.json');const target=path.join(root,'do-not-touch');
 fs.mkdirSync(target);fs.writeFileSync(path.join(target,'PROTECTED'),'PROTECTED');
 store=open(file);store.load();
 link(target,file);
 store.save({portals:[{id:'p',slug:'safe',title:'Safe',files:[]}],qrArtifacts:[]});
 assert.equal(fs.readFileSync(path.join(target,'PROTECTED'),'utf8'),'PROTECTED');
 assert.deepEqual(fs.readdirSync(target),['PROTECTED']);
 assert.equal(store.load().portals[0].slug,'safe');
 assert.equal(fs.lstatSync(file).isSymbolicLink(),true);
 assert.deepEqual(fs.readdirSync(root).filter(n=>n.endsWith('.snapshot.tmp')),[]);
 console.log('PASS SQLite snapshot symlink rejection, authoritative transaction, temporary cleanup');
}finally{
 try{if(store)store.close()}catch{}
 try{fs.rmSync(root,{recursive:true,force:true})}catch{}
}
