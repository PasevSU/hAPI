'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
process.env.NODE_ENV='test';
const identity=require('../identity');
const gate=require('../release-gate');
test('signed immutable release intent is tied to exact plan; altered build cannot reuse signature',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hapi-release-intent-'));
 const home=path.join(root,'gpg');fs.mkdirSync(home,{mode:0o700});
 const gpg=args=>spawnSync('gpg',['--homedir',home,'--batch','--no-tty',...args],{
   encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
 try{
   const created=gpg(['--passphrase','','--pinentry-mode','loopback','--quick-generate-key',
      'Release Test <release@invalid.example>','ed25519','sign','0']);
   assert.equal(created.status,0,created.stderr);
   const list=gpg(['--with-colons','--fingerprint','--list-keys']);
   const fpr=list.stdout.match(/^fpr(?::[^:]*){8}:([0-9A-F]{40,64}):/m)?.[1];
   assert.ok(fpr);
   const pub=gpg(['--armor','--export',fpr]);assert.equal(pub.status,0);
   const base={repository:'PasevSU/hAPI',commitSha:'a'.repeat(40),
     version:'0.69.207',previousVersion:'0.69.206',
     artifactSha256:'b'.repeat(64),targets:['aarch64','amd64']};
   const message=gate.canonicalIntent(base);
   const filename=path.join(root,'intent.txt');
   fs.writeFileSync(filename,message);
   const sign=gpg(['--armor','--output',filename+'.asc','--detach-sign','--local-user',fpr,filename]);
   assert.equal(sign.status,0,sign.stderr);
   const signature=fs.readFileSync(filename+'.asc','utf8');
   const attrs={signature,publicKey:Buffer.from(pub.stdout,'utf8'),
     expectedFingerprint:fpr,allowTestFingerprint:true};
   assert.equal(identity.verifyReleaseIntent({payload:message,...attrs}),true);
   assert.equal(identity.verifyReleaseIntent({
     payload:gate.canonicalIntent({...base,artifactSha256:'c'.repeat(64)}),...attrs}),false);
   assert.equal(identity.verifyReleaseIntent({payload:message,signature:'invalid',
     publicKey:attrs.publicKey,expectedFingerprint:fpr,allowTestFingerprint:true}),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
