'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const id=require('../identity');

test('pinned SSH RSA key has expected owner fingerprint',()=>{
  assert.equal(id.fingerprint(id.PUBLIC_KEY),id.EXPECTED_FINGERPRINT);
  assert.equal(id.EXPECTED_FINGERPRINT,'SHA256:m5FRNKDKpT7F0NbzLG80uK/MH4zyuVST7GatAS14n0w');
  assert.equal(id.keyMatches(id.PUBLIC_KEY+' ignored-comment'),true);
  assert.equal(id.keyMatches('ssh-rsa '+Buffer.from('wrong').toString('base64')),false);
  assert.equal(id.fingerprint('nonsense'),null);
  assert.equal(id.validateOptions({github_username:'PasevSU',github_ssh_fingerprint:id.EXPECTED_FINGERPRINT}),true);
  assert.equal(id.validateOptions({github_username:'intruder',github_ssh_fingerprint:id.EXPECTED_FINGERPRINT}),false);
  assert.equal(id.validateOptions({github_username:'PasevSU',github_ssh_fingerprint:'SHA256:fake'}),false);
});
test('real OpenSSH signatures validate only with the matching public key',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hapi-ssh-proof-'));
  try{
    const priv=path.join(dir,'id_rsa');
    const gen=spawnSync('ssh-keygen',['-q','-t','rsa','-b','2048','-N','','-f',priv],{encoding:'utf8'});
    assert.equal(gen.status,0,gen.stderr);
    const challenge=id.newChallenge();
    const file=path.join(dir,'challenge.txt');
    fs.writeFileSync(file,challenge);
    const sign=spawnSync('ssh-keygen',['-Y','sign','-f',priv,'-n','hapi-devtools',file],{encoding:'utf8'});
    assert.equal(sign.status,0,sign.stderr);
    const signature=fs.readFileSync(file+'.sig','utf8');
    const publicKey=fs.readFileSync(priv+'.pub','utf8').trim();
    assert.equal(id.verifySignature(challenge,signature,{publicKey}),true);
    assert.equal(id.verifySignature(challenge+'extra',signature,{publicKey}),false);
    assert.equal(id.verifySignature(challenge,signature),false,'owner pinned key differs from generated test key');
    assert.equal(id.verifySignature(challenge,'not-a-signature',{publicKey}),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
