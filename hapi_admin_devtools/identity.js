'use strict';
/**
 * Independent OpenPGP identity verification for hAPI Admin DevTools.
 * SSH authentication for Home Assistant/GitHub is unrelated to this challenge.
 *
 * GitHub's .gpg endpoint publishes the OpenPGP public certificate; GnuPG verifies
 * a fresh detached signature. No private keys or GitHub tokens enter the add-on.
 */
const crypto=require('node:crypto');
const https=require('node:https');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const GITHUB_USER='PasevSU';
const REGISTERED_GPG_KEY_ID='4FC0B2596C68DCB9';
const FINGERPRINT_RE=/^[0-9A-F]{40}(?:[0-9A-F]{24})?$/;
const SIGNATURE_HEADER='-----BEGIN PGP SIGNATURE-----';
function normalizeFingerprint(value){
  const v=String(value||'').replace(/\s/g,'').toUpperCase();
  return FINGERPRINT_RE.test(v)&&v.endsWith(REGISTERED_GPG_KEY_ID)?v:null;
}
function validateOptions(options){
  return !!options && options.github_username===GITHUB_USER &&
    !!normalizeFingerprint(options.openpgp_fingerprint);
}
function fetchGithubPublicKey({timeoutMs=8000}={}){
  return new Promise((resolve,reject)=>{
    const req=https.get('https://github.com/'+GITHUB_USER+'.gpg',
      {timeout:timeoutMs,headers:{'user-agent':'hAPI-Admin-DevTools/0.2','accept':'application/pgp-keys'}},res=>{
        if(res.statusCode!==200){res.resume();return reject(Error('GITHUB_GPG_HTTP_'+res.statusCode));}
        const chunks=[];let bytes=0;
        res.on('data',chunk=>{
          bytes+=chunk.length;
          if(bytes>512000){req.destroy(Error('GITHUB_GPG_TOO_LARGE'));return;}
          chunks.push(chunk);
        });
        res.on('end',()=>resolve(Buffer.concat(chunks)));
      });
    req.on('timeout',()=>req.destroy(Error('GITHUB_GPG_TIMEOUT')));
    req.on('error',reject);
  });
}
function gpg(args,{homedir,input,timeout=10000}={}){
  return spawnSync('gpg',['--homedir',homedir,'--batch','--no-tty','--no-default-keyring',...args],
    {input,encoding:'utf8',timeout,maxBuffer:1024*1024});
}
function withKeyring(publicKey,fn){
  if(!Buffer.isBuffer(publicKey)||publicKey.length<16||publicKey.length>512000)throw Error('INVALID_GPG_PUBLIC_KEY');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'hapi-gpg-'));
  fs.chmodSync(home,0o700);
  try{
    const importResult=gpg(['--import'],{homedir:home,input:publicKey});
    if(importResult.status!==0)throw Error('GPG_IMPORT_FAILED');
    return fn(home);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
}
function hasPrimaryFingerprint(home,expected){
  const result=gpg(['--with-colons','--fingerprint','--list-keys'],{homedir:home});
  if(result.status!==0)return false;
  let inPrimary=false;
  for(const line of result.stdout.split('\n')){
    const cols=line.split(':');
    if(cols[0]==='pub'){inPrimary=cols[1]!=='r' && cols[1]!=='e';continue;}
    if(cols[0]==='sub'){inPrimary=false;continue;}
    if(cols[0]==='fpr'&&inPrimary&&cols[9]===expected)return true;
  }
  return false;
}
function verifyPublicCertificate(publicKey,expectedFingerprint){
  const expected=normalizeFingerprint(expectedFingerprint);
  if(!expected)return false;
  try{return withKeyring(publicKey,home=>hasPrimaryFingerprint(home,expected));}
  catch{return false;}
}
function verifyDetached({challenge,signature,expectedFingerprint,publicKey,allowTestFingerprint=false}){
  const expected=allowTestFingerprint && process.env.NODE_ENV==='test' && /^[0-9A-F]{40}$/.test(expectedFingerprint)
    ? expectedFingerprint : normalizeFingerprint(expectedFingerprint);
  if(!expected||typeof challenge!=='string'||challenge.length>4096||!/^hapi-admin-devtools\/openpgp-v1\nnonce=[a-f0-9]{64}\nfp=[A-F0-9]{40}(?:[A-F0-9]{24})?\n$/.test(challenge) ||
      !challenge.endsWith('fp='+expected+'\n') ||
      typeof signature!=='string'||signature.length>16000||
      !signature.trim().startsWith(SIGNATURE_HEADER))return false;
  return withKeyring(publicKey,home=>{
    if(!hasPrimaryFingerprint(home,expected))return false;
    const msg=path.join(home,'challenge.txt'),sig=path.join(home,'challenge.asc');
    fs.writeFileSync(msg,challenge,{mode:0o600});
    fs.writeFileSync(sig,signature,{mode:0o600});
    const result=gpg(['--status-fd','1','--verify',sig,msg],{homedir:home});
    if(result.status!==0)return false;
    // VALIDSIG identifies both the signer and the PRIMARY key of a signing subkey.
    const valid=result.stdout.split('\n').filter(x=>x.startsWith('[GNUPG:] VALIDSIG '));
    return valid.some(line=>{
      const parts=line.trim().split(/\s+/);
      return (parts.at(-1)||'').toUpperCase()===expected ||
        parts[2]?.toUpperCase()===expected;
    });
  });
}
function verifyGitCommitSignature({payload,signature,publicKey,expectedFingerprint}){
  const expected=normalizeFingerprint(expectedFingerprint);
  if(!expected||typeof payload!=='string'||typeof signature!=='string'||
     payload.length>200000||signature.length>20000||
     !signature.trim().startsWith('-----BEGIN PGP SIGNATURE-----'))return false;
  try{
    return withKeyring(publicKey,home=>{
      if(!hasPrimaryFingerprint(home,expected))return false;
      const messageFile=path.join(home,'commit.payload'),signatureFile=path.join(home,'commit.asc');
      fs.writeFileSync(messageFile,payload,{mode:0o600});
      fs.writeFileSync(signatureFile,signature,{mode:0o600});
      const outcome=gpg(['--status-fd','1','--verify',signatureFile,messageFile],{homedir:home});
      if(outcome.status!==0)return false;
      return outcome.stdout.split('\n').filter(x=>x.startsWith('[GNUPG:] VALIDSIG ')).some(line=>{
        const parts=line.trim().split(/\s+/);
        return parts.at(-1)?.toUpperCase()===expected||parts[2]?.toUpperCase()===expected;
      });
    });
  }catch{return false;}
}
function verifyReleaseIntent({payload,signature,publicKey,expectedFingerprint}){
  const expected=normalizeFingerprint(expectedFingerprint);
  if(!expected||typeof payload!=='string'||payload.length>3000 ||
     !payload.startsWith('hapi-admin-devtools/release-intent-v1\\n') ||
     typeof signature!=='string'||signature.length>16000||
     !signature.trim().startsWith(SIGNATURE_HEADER))return false;
  try{
    return withKeyring(publicKey,home=>{
      if(!hasPrimaryFingerprint(home,expected))return false;
      const msg=path.join(home,'release-intent.txt'),sig=path.join(home,'release-intent.asc');
      fs.writeFileSync(msg,payload,{mode:0o600});
      fs.writeFileSync(sig,signature,{mode:0o600});
      const result=gpg(['--status-fd','1','--verify',sig,msg],{homedir:home});
      if(result.status!==0)return false;
      return result.stdout.split('\\n').filter(x=>x.startsWith('[GNUPG:] VALIDSIG ')).some(line=>{
        const parts=line.trim().split(/\\s+/);
        return parts.at(-1)?.toUpperCase()===expected||parts[2]?.toUpperCase()===expected;
      });
    });
  }catch{return false;}
}
function newChallenge(expectedFingerprint){
  const expected=normalizeFingerprint(expectedFingerprint);
  if(!expected)throw Error('GPG_FINGERPRINT_INVALID');
  return 'hapi-admin-devtools/openpgp-v1\nnonce='+crypto.randomBytes(32).toString('hex')+
    '\nfp='+expected+'\n';
}
module.exports={GITHUB_USER,REGISTERED_GPG_KEY_ID,normalizeFingerprint,validateOptions,
  fetchGithubPublicKey,verifyPublicCertificate,verifyDetached,verifyGitCommitSignature,verifyReleaseIntent,newChallenge,hasPrimaryFingerprint};
