'use strict';
const { stopChild } = require('./helpers.cjs');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pe-throttle-'));
 const port=20000+Math.floor(Math.random()*20000),secret='admin-'+require('node:crypto').randomBytes(24).toString('hex');
 const child=spawn(process.execPath,[path.join(__dirname,'../portal_enterprise/server.js')],{env:{...process.env,DATA_DIR:tmp,PORT:String(port),ADMIN_TOKEN:secret},stdio:['ignore','pipe','pipe']});
 const request=(route,token)=>new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path:route,headers:token?{Authorization:'Bearer '+token}:{}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,retry:res.headers['retry-after']}))});req.on('error',reject)});
 try{
  let ready=false;for(let i=0;i<60;i++){if(child.exitCode!==null)throw Error('server exited');try{if((await request('/health')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,40))}assert.ok(ready,'server readiness');
  for(let i=0;i<12;i++)assert.equal((await request('/admin/api/portals','bad-token')).status,401);
  const blocked=await request('/admin/api/portals','bad-token');assert.equal(blocked.status,429);assert.ok(Number(blocked.retry)>0);
  assert.equal((await request('/health')).status,200,'public health must remain available');
  console.log('PASS: 12 rejected admin credentials, 429 Retry-After, public health unaffected');
 }finally{await stopChild(child);fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
