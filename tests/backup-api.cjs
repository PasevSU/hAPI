'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-backup-api-'));
 const port=25000+Math.floor(Math.random()*10000),token='backup-api-admin-token-123456789';
 const child=spawn(process.execPath,[path.join(__dirname,'../portal_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_TOKEN:token},stdio:'ignore'});
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert(ready,'server did not start');
  const url=`http://127.0.0.1:${port}/admin/api/database/backup`;
  assert.equal((await fetch(url,{method:'POST'})).status,401);
  assert.equal((await fetch(url)).status,401);
  const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`}});assert.equal(r.status,201);const {backup}=await r.json();
  assert.match(backup.name,/^metadata-[\w-]+\.sqlite$/);assert.match(backup.sha256,/^[a-f0-9]{64}$/);
  const file=path.join(dir,'backups',backup.name);assert(fs.existsSync(file));assert.equal(backup.bytes,fs.statSync(file).size);
  assert.equal(backup.sha256,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  const db=new DatabaseSync(file,{readOnly:true});assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');db.close();
  const page=await (await fetch(`http://127.0.0.1:${port}/admin`)).text();assert(page.includes('database-backup'));
  assert(!JSON.stringify(backup).includes(dir));assert(!JSON.stringify(backup).includes(token));
  console.log('PASS authenticated SQLite backup API, integrity, hash, GUI and path isolation');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
