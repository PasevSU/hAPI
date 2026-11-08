'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
process.env.NODE_ENV='test';
const id=require('../identity');
const SAMPLE='0123456789ABCDEF012345674FC0B2596C68DCB9';
test('full OpenPGP fingerprint is needed, GitHub key ID is insufficient',()=>{
  assert.equal(id.normalizeFingerprint(SAMPLE),SAMPLE);
  assert.equal(id.normalizeFingerprint('4FC0B2596C68DCB9'),null);
  assert.equal(id.normalizeFingerprint('SHA256:abc'),null);
  assert.equal(id.validateOptions({github_username:'PasevSU',openpgp_fingerprint:SAMPLE}),true);
  assert.equal(id.validateOptions({github_username:'other',openpgp_fingerprint:SAMPLE}),false);
  assert.match(id.newChallenge(SAMPLE),/^hapi-admin-devtools\/openpgp-v1\nnonce=[a-f0-9]{64}\nfp=/);
  assert.throws(()=>id.newChallenge('4FC0B2596C68DCB9'));
});
test('GnuPG validates a real detached OpenPGP signature and rejects tampering',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hapi-pgp-test-'));
  const homedir=path.join(dir,'gnupg');
  fs.mkdirSync(homedir,{mode:0o700});
  const gpg=(args)=>spawnSync('gpg',['--homedir',homedir,'--batch','--no-tty',...args],
    {encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
  try{
    const generated=gpg(['--passphrase','','--pinentry-mode','loopback','--quick-generate-key',
      'Guardian Test <guardian@invalid.example>','ed25519','sign','0']);
    assert.equal(generated.status,0,generated.stderr);
    const listed=gpg(['--with-colons','--fingerprint','--list-keys']);
    const fingerprint=listed.stdout.match(/^fpr(?::[^:]*){8}:([0-9A-F]{40,64}):/m)?.[1];
    assert.ok(fingerprint,'test OpenPGP key fingerprint must be discoverable');
    const pub=gpg(['--armor','--export',fingerprint]);
    assert.equal(pub.status,0);
    const challenge='hapi-admin-devtools/openpgp-v1\nnonce='+'a'.repeat(64)+'\nfp='+fingerprint+'\n';
    const file=path.join(dir,'challenge.txt'),sig=path.join(dir,'challenge.asc');
    fs.writeFileSync(file,challenge,'utf8');
    const signed=gpg(['--armor','--output',sig,'--detach-sign','--local-user',fingerprint,file]);
    assert.equal(signed.status,0,signed.stderr);
    const signature=fs.readFileSync(sig,'utf8'), publicKey=Buffer.from(pub.stdout,'utf8');
    assert.equal(id.verifyDetached({challenge,signature,publicKey,expectedFingerprint:fingerprint,allowTestFingerprint:true}),true);
    assert.equal(id.verifyDetached({challenge:challenge+'extra',signature,publicKey,expectedFingerprint:fingerprint,allowTestFingerprint:true}),false);
    assert.equal(id.verifyDetached({challenge,signature:'bad',publicKey,expectedFingerprint:fingerprint,allowTestFingerprint:true}),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
