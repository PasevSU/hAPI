'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-sensors-')),port=31000+Math.floor(Math.random()*10000),admin='sensor-test-admin-token-123456789';
let child;const base=`http://127.0.0.1:${port}`;
const request=async(url,method='GET',body,headers={})=>{const r=await fetch(base+url,{method,headers,body});let v;try{v=await r.json()}catch{v=null}return {status:r.status,value:v}};
const adminHeaders={Authorization:'Bearer '+admin,'Content-Type':'application/json'};
const boot=async()=>{child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_TOKEN:admin},stdio:'ignore'});for(let i=0;i<100;i++){try{if((await request('/health')).status===200)return}catch{}await new Promise(r=>setTimeout(r,30))}throw Error('not ready')};
try{
await boot();assert.equal((await request('/admin/api/sensors')).status,401);
const created=await request('/admin/api/portals','POST',JSON.stringify({title:'Sensors',slug:'sensors'}),adminHeaders);assert.equal(created.status,201);const pid=created.value.id;
await request('/admin/api/users','POST',JSON.stringify({username:'monitor',password:'monitor-pass-123',scopes:['read','download']}),adminHeaders);
const key=await request('/api/v1/auth/login','POST',JSON.stringify({username:'monitor',password:'monitor-pass-123'}),{'Content-Type':'application/json'});assert.equal(key.status,200);const portalAuth={Authorization:'Bearer '+key.value.token};
assert.equal((await request('/api/v1/p/sensors','GET',undefined,portalAuth)).status,200);
const file=await request(`/admin/api/portals/${pid}/files`,'POST','data',{Authorization:'Bearer '+admin,'X-File-Name':'test.txt'});assert.equal(file.status,201);
assert.equal((await request(`/api/v1/p/sensors/files/${file.value.id}/download`,'GET',undefined,portalAuth)).status,200);
assert.equal((await request(`/api/v1/p/sensors/files/${file.value.id}/rating`,'POST',JSON.stringify({stars:5}),{...portalAuth,'Content-Type':'application/json'})).status,201);
const r=await request('/admin/api/sensors','GET',undefined,adminHeaders);assert.equal(r.status,200);assert.equal(r.value.files,1);assert.equal(r.value.fileBytes,4);assert.equal(r.value.visits,1);assert.equal(r.value.downloads,1);assert.equal(r.value.ratings[file.value.id].average,5);assert.equal(r.value.ipMode,'hashed');assert(!JSON.stringify(r.value).includes('127.0.0.1'));
child.kill();await new Promise(resolve=>child.once('exit',resolve));await boot();const restored=await request('/admin/api/sensors','GET',undefined,adminHeaders);assert.equal(restored.value.downloads,1);assert.equal(restored.value.visits,1);
console.log('PASS sensors: authorization, sizes, visits, downloads, ratings, privacy, restart persistence');
}finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
