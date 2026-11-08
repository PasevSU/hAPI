'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const identity=require('../identity');
const gate=require('../github-verification');
const sha='a'.repeat(40),publicKey=Buffer.from('test-pgp');
test('GitHub Verified alone does NOT grant trusted OpenPGP author status',()=>{
  const original=identity.verifyGitCommitSignature;
  try{
    identity.verifyGitCommitSignature=()=>false;
    const signed={sha,commit:{verification:{verified:true,reason:'valid',
      payload:'tree deadbeef\n',signature:'-----BEGIN PGP SIGNATURE-----\nabc\n-----END PGP SIGNATURE-----'}}};
    assert.equal(gate.verifyResponse(signed,{expectedSha:sha,expectedFingerprint:'A'.repeat(40),publicKey}).status,'rejected');
    assert.equal(gate.verifyResponse({...signed,sha:'b'.repeat(40)},{expectedSha:sha,expectedFingerprint:'A'.repeat(40),publicKey}).reason,'SHA_MISMATCH');
    assert.equal(gate.verifyResponse({sha,commit:{verification:{verified:false,reason:'unsigned'}}},
      {expectedSha:sha,expectedFingerprint:'A'.repeat(40),publicKey}).reason,'unsigned');
    identity.verifyGitCommitSignature=()=>true;
    assert.equal(gate.verifyResponse(signed,{expectedSha:sha,expectedFingerprint:'A'.repeat(40),publicKey}).status,'verified');
  }finally{identity.verifyGitCommitSignature=original;}
});
test('commit fetch refuses unexpected SHA representations before any network',async()=>{
  await assert.rejects(gate.getCommit('../../secrets'),/INVALID_COMMIT_SHA/);
  await assert.rejects(gate.getCommit('f'.repeat(64)),/INVALID_COMMIT_SHA/);
});
