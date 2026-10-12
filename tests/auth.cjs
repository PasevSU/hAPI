'use strict';
const { stopChild } = require('./helpers.cjs');
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-auth-')),port=20000+Math.floor(Math.random()*3000),token='auth-test-admin-token-1234567890123456';let child;
const req=async(route,method='GET',data,headers={})=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method,headers,...(data===undefined?{}:{body:data})});let v;try{v=await r.json()}catch{v=null}return {status:r.status,value:v}};
const json=(r,m,d)=>req(r,m,JSON.stringify(d),{'Content-Type':'application/json'});
const admin=(r,m,d)=>req(r,m,d===undefined?undefined:JSON.stringify(d),{Authorization:'Bearer '+token,'Content-Type':'application/json'});
const boot=async()=>{child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_TOKEN:token},stdio:'ignore'});for(let i=0;i<80;i++){try{if((await req('/health')).status===200)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error('Startup failed')};
try{
await boot();
// user management requires admin auth
assert.equal((await req('/admin/api/users')).status,401);
// create user; duplicate rejected; weak password rejected
assert.equal((await admin('/admin/api/users','POST',{username:'alice',password:'alice-pass-123',scopes:['read','download']})).status,201);
assert.equal((await admin('/admin/api/users','POST',{username:'alice',password:'another-pass-123'})).status,409);
assert.equal((await admin('/admin/api/users','POST',{username:'bob',password:'short'})).status,400);
// list exposes no password material
const list=await admin('/admin/api/users','GET');assert.equal(list.status,200);const u=list.value.users.find(x=>x.username==='alice');assert(u);assert.equal(u.scopes.includes('read'),true);assert.equal('passwordHash' in u,false);assert.equal(JSON.stringify(list.value).includes('alice-pass-123'),false);
// login success issues a pu_ session token with scopes
const login=await json('/api/v1/auth/login','POST',{username:'alice',password:'alice-pass-123'});assert.equal(login.status,200);assert(login.value.token.startsWith('pu_'));assert.deepEqual(login.value.scopes.sort(),['download','read']);
// wrong password rejected
assert.equal((await json('/api/v1/auth/login','POST',{username:'alice',password:'wrong-password'})).status,401);
// me returns identity
const me=await req('/api/v1/auth/me','GET',undefined,{Authorization:'Bearer '+login.value.token});assert.equal(me.status,200);assert.equal(me.value.username,'alice');
// logout invalidates the session
assert.equal((await req('/api/v1/auth/logout','POST',undefined,{Authorization:'Bearer '+login.value.token})).status,200);
assert.equal((await req('/api/v1/auth/me','GET',undefined,{Authorization:'Bearer '+login.value.token})).status,401);
// PATCH password + active toggle
assert.equal((await admin('/admin/api/users/alice','PATCH',{password:'alice-new-pass-456'})).status,200);
assert.equal((await json('/api/v1/auth/login','POST',{username:'alice',password:'alice-pass-123'})).status,401);
const login2=await json('/api/v1/auth/login','POST',{username:'alice',password:'alice-new-pass-456'});assert.equal(login2.status,200);
assert.equal((await admin('/admin/api/users/alice','PATCH',{active:false})).status,200);
assert.equal((await json('/api/v1/auth/login','POST',{username:'alice',password:'alice-new-pass-456'})).status,401); // inactive lockout
// DELETE removes user; second delete 404
assert.equal((await admin('/admin/api/users/alice','DELETE')).status,200);
assert.equal((await admin('/admin/api/users/alice','DELETE')).status,404);
// rate limiting: reset window via a successful login, then 10 failures trigger 429
assert.equal((await admin('/admin/api/users','POST',{username:'carol',password:'carol-pass-123'})).status,201);
const carolLogin=await json('/api/v1/auth/login','POST',{username:'carol',password:'carol-pass-123'});assert.equal(carolLogin.status,200);
for(let i=0;i<10;i++){assert.equal((await json('/api/v1/auth/login','POST',{username:'carol',password:'wrong-pass-000'})).status,401)}
assert.equal((await json('/api/v1/auth/login','POST',{username:'carol',password:'wrong-pass-000'})).status,429);
console.log('PASS auth: hashing, login/logout/me, scopes, inactive lockout, user CRUD, rate limiting');
}finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
