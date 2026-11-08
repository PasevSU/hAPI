'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'devtools-server-'));
process.env.NODE_ENV='test';
process.env.HAPI_DEVTOOLS_DATA=tmp;
process.env.HAPI_DEVTOOLS_OPTIONS=path.join(tmp,'options.json');
const identity=require('../identity');
const {createServer}=require('../server');
test('gated Ingress dashboard cannot expose diagnostics without SSH signature',async()=>{
  const originalGithub=identity.githubKeys,originalVerify=identity.verifySignature;
  identity.githubKeys=async()=>true;
  identity.verifySignature=()=>false;
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/';
  const req=async(route,method='GET',body)=>fetch(base+route,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  try {
    let res=await req('api/status');assert.equal((await res.json()).activated,false);
    res=await req('api/overview');assert.equal(res.status,423);
    res=await req('api/challenge','POST',{});assert.equal(res.status,423);
    fs.writeFileSync(process.env.HAPI_DEVTOOLS_OPTIONS,JSON.stringify({github_username:'PasevSU',github_ssh_fingerprint:'SHA256:invalid'}));
    res=await req('api/challenge','POST',{});assert.equal(res.status,423);
    fs.writeFileSync(process.env.HAPI_DEVTOOLS_OPTIONS,JSON.stringify({github_username:'PasevSU',github_ssh_fingerprint:identity.EXPECTED_FINGERPRINT}));
    res=await req('api/challenge','POST',{});
    assert.equal(res.status,200);
    const challenge=await res.json();
    assert.match(challenge.challenge,/nonce=[a-f0-9]{64}/);
    res=await req('api/enroll','POST',{id:challenge.id,signature:'invalid'});
    assert.equal(res.status,403);
    res=await req('api/overview');assert.equal(res.status,423);
    res=await req('api/challenge','POST',{});
    const next=await res.json();
    identity.verifySignature=()=>true; // only simulate a valid owner signature after testing real crypto above
    res=await req('api/enroll','POST',{id:next.id,signature:'mock-signed'});
    assert.equal(res.status,200);
    res=await req('api/overview');assert.equal(res.status,200);
    const overview=await res.json();
    assert.equal(overview.mode,'read-only');
    assert.equal(overview.applyEnabled,false);
    assert.ok(Object.keys(overview.modules).length>=9);
    assert.equal(fs.statSync(path.join(tmp,'enrollment.json')).mode&0o777,0o600);
  }finally {
    identity.githubKeys=originalGithub;identity.verifySignature=originalVerify;
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(tmp,{recursive:true,force:true});
  }
});
