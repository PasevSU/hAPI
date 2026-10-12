'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const edge=require('../hapi_enterprise/standalone');
(async()=>{
 // Unit: token generation and reuse across restarts.
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-edge-'));
 const t1=edge.resolveToken(dataDir);
 assert(t1.length>=24,'generated admin token must be >= 24 characters');
 assert.notEqual(t1,'CHANGE_TO_RANDOM_SECRET_AT_LEAST_24_CHARACTERS','must not be the placeholder');
 assert.equal(edge.resolveToken(dataDir),t1,'token must be persisted and reused');

 // Unit: environment resolution for the standalone child.
 const env=edge.buildEnv({dataDir,token:t1,publicPort:18001,adminPort:18002});
 assert.equal(env.DATA_DIR,dataDir);
 assert.equal(env.ADMIN_TOKEN,t1);
 assert.equal(env.PORT,'18001');
 assert.equal(env.ADMIN_PORT,'18002');
 assert.equal(env.INGRESS_MODE,'true');
 assert.equal(env.ADMIN_BIND_HOST,'127.0.0.1');
 assert.equal(env.PUBLIC_BIND_HOST,'127.0.0.1');

 // Integration: boot the full backend standalone on loopback and exercise the
 // admin GUI + whoami, confirming the same code base runs outside Home Assistant.
 const port=27000+Math.floor(Math.random()*5000),adminPort=port+1;
 const child=edge.spawnServer(edge.buildEnv({dataDir,token:t1,publicPort:port,adminPort:adminPort}),{stdio:'ignore'});
 try{
  assert(await edge.waitForHealth(port,20000),'server did not become healthy on the public listener');
  const admin=await fetch(`http://127.0.0.1:${adminPort}/admin`);
  assert.equal(admin.status,200,'/admin must serve the admin GUI');
  assert((await admin.text()).includes('hAPI Enterprise'),'admin GUI branding missing');
  const who=await fetch(`http://127.0.0.1:${adminPort}/admin/api/whoami`,{headers:{Authorization:'Bearer '+t1}});
  assert.equal(who.status,200,'whoami must resolve the admin role');
  assert.deepEqual(await who.json(),{role:'admin',ingress:true});

  // Admin API surface used by the live desktop GUI (contract for ui/live.js).
  const H={Authorization:'Bearer '+t1};
  const ok=async p=>{const r=await fetch(`http://127.0.0.1:${adminPort}${p}`,{headers:H});assert.equal(r.status,200,p+' must be 200');return r.json()};
  const P=await ok('/admin/api/portals'),J=await ok('/admin/api/jobs'),D=await ok('/admin/api/diagnostics');
  const ST=await ok('/admin/api/storage/status'),BK=await ok('/admin/api/database/backups'),ER=await ok('/admin/api/errors');
  const AU=await ok('/admin/api/audit'),SE=await ok('/admin/api/settings'),ME=await ok('/admin/api/metrics'),SN=await ok('/admin/api/sensors');
  assert(Array.isArray(P.portals)&&Array.isArray(J.jobs)&&Array.isArray(ST.locations)&&Array.isArray(BK.backups),'list endpoint shapes');
  assert(Array.isArray(ER.events)&&Array.isArray(AU.events)&&Array.isArray(SN.portals),'event/sensor shapes');
  assert(typeof D.uptimeSeconds==='number'&&SE.settings&&typeof ME.portals==='number','scalar shapes');

  // CORS for the native desktop GUI (origin null): preflight must succeed on admin.
  const pre=await fetch(`http://127.0.0.1:${adminPort}/admin/api/portals`,{method:'OPTIONS',headers:{Origin:'null','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'}});
  assert.equal(pre.status,204,'CORS preflight must be 204 on the admin listener');
  assert.equal(pre.headers.get('access-control-allow-origin'),'*','CORS allow-origin must be *');
  assert.match(pre.headers.get('access-control-allow-headers')||'',/Authorization/i,'CORS must allow Authorization');

  // The public listener must never expose the admin GUI.
  assert.equal((await fetch(`http://127.0.0.1:${port}/admin`)).status,404,'public listener must not serve /admin');
  console.log('PASS edge runtime: standalone boot, admin GUI, whoami, loopback isolation');
 }finally{child.kill();try{fs.rmSync(dataDir,{recursive:true,force:true})}catch{}}
})().catch(e=>{console.error(e);process.exitCode=1});
