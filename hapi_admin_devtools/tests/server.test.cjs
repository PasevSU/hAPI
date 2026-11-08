'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'devtools-pgp-'));
process.env.NODE_ENV='test';
process.env.HAPI_DEVTOOLS_DATA=tmp;
process.env.HAPI_DEVTOOLS_OPTIONS=path.join(tmp,'options.json');
const identity=require('../identity');
const {createServer}=require('../server');
const SAMPLE='0123456789ABCDEF012345674FC0B2596C68DCB9';
test('no DevTools access without full OpenPGP fingerprint and detached signature',async()=>{
  const originalFetch=identity.fetchGithubPublicKey;
  const originalCertificate=identity.verifyPublicCertificate;
  const originalVerify=identity.verifyDetached;
  identity.fetchGithubPublicKey=async()=>Buffer.from('test-public');
  identity.verifyPublicCertificate=()=>true;
  identity.verifyDetached=()=>false;
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/';
  const request=async(route,method='GET',body)=>fetch(base+route,{method,
    headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  try{
    let r=await request('api/status');
    assert.equal((await r.json()).activated,false);
    r=await request('api/overview');assert.equal(r.status,423);
    r=await request('api/dynamic/findings');assert.equal(r.status,423);
    r=await request('api/work-modes');assert.equal(r.status,423);
    r=await request('api/challenge','POST',{});assert.equal(r.status,423);
    fs.writeFileSync(process.env.HAPI_DEVTOOLS_OPTIONS,JSON.stringify({
      github_username:'PasevSU',openpgp_fingerprint:'4FC0B2596C68DCB9'}));
    r=await request('api/challenge','POST',{});assert.equal(r.status,423);
    fs.writeFileSync(process.env.HAPI_DEVTOOLS_OPTIONS,JSON.stringify({
      github_username:'PasevSU',openpgp_fingerprint:SAMPLE}));
    r=await request('api/challenge','POST',{});assert.equal(r.status,200);
    const challenge=await r.json();assert.match(challenge.challenge,/nonce=[a-f0-9]{64}/);
    r=await request('api/enroll','POST',{id:challenge.id,signature:'invalid'});
    assert.equal(r.status,403);
    r=await request('api/overview');assert.equal(r.status,423);
    r=await request('api/challenge','POST',{});
    const next=await r.json();
    identity.verifyDetached=()=>true; // crypto validity independently tested in identity.test.cjs
    r=await request('api/enroll','POST',{id:next.id,signature:'mock-openpgp-signature'});
    assert.equal(r.status,200);
    r=await request('api/overview');assert.equal(r.status,200);
    const overview=await r.json();
    assert.equal(overview.identity.method,'OpenPGP');
    assert.equal(overview.applyEnabled,false);
    assert.equal(overview.automaticRepairsEnabled,false);
    r=await request('api/work-modes');assert.equal(r.status,200);
    const modes=await r.json();
    assert.equal(modes.static.id,'static');
    assert.equal(modes.dynamic.id,'dynamic');
    assert.ok(modes.improvementCategories.some(x=>x.id==='optimization'));
    r=await request('api/dynamic/status');assert.equal(r.status,200);
    const status=await r.json();
    assert.equal(status.analysisEnabled,true);
    assert.equal(status.intervalMinutes,360);
    r=await request('api/dynamic/coverage');assert.equal(r.status,200);
    const coverage=await r.json();
    assert.ok(coverage.listedFunctions>=300);
    assert.equal(coverage.liveInstrumented,0);
    r=await request('api/dynamic/findings');assert.equal(r.status,200);
    const findings=await r.json();
    assert.equal(findings.automaticFixes,false);
    assert.deepEqual(findings.analyses,[]);

    assert.ok(Object.keys(overview.modules).length>=9);
    assert.equal(fs.statSync(path.join(tmp,'enrollment.json')).mode&0o777,0o600);
  }finally{
    identity.fetchGithubPublicKey=originalFetch;
    identity.verifyPublicCertificate=originalCertificate;
    identity.verifyDetached=originalVerify;
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(tmp,{recursive:true,force:true});
  }
});
