'use strict';
// This is the PUBLIC SSH key provided by the project owner, not a private key.
// Its fingerprint must also appear in the public keys published by GitHub user PasevSU.
const crypto=require('node:crypto');
const https=require('node:https');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const GITHUB_USER='PasevSU';
const PUBLIC_KEY_B64='AAAAB3NzaC1yc2EAAAADAQABAAACAQCRwy1f9M865/iOI4zHAe3Lvj0gMK1wXfALpMoYYHBTrZw+OB5AtwkyW8Yo0bKXyesgi4mIJTKtMVxlCJk+RzWz/lhwDXL8BtY8Bma+Yaac46apGbHZGsRFt49eOSP0msW44jZRY+bczyRECmGFqO8t9LfnUe+R3UQprKlIMuIbVvbi2ADVIs+bLFZJqEfjFEqWnbW8u5rOWdC1nqDYkqol0sxXoofUrx0LL/G4NGEFo1Zs98lLCxgB2hyzbw5glD1rLzJk9KUOIbNvUgLJsgDHYowZyRydOvPpQhIcFyBXtHSt21z8Yr5S54YSun/N7xYDrLKe/LlkaOMB4i1CgzpeAZLUoHXTJJzLqRTF7TbVcUSjlMBRKUyK8nzTMOqw4UIbM3000/Iw8a/L3ogOER4ftEIJ4Bf+1Qtmm8OTygi/efM8PILMipQwBIDy95OsiiqrzU5wziScc9MdevI+mF4duCKvWtipE6EBQMALhuMJOQxmVMjlbZZxnsU2ssJHRic/Fqkl2g4T7VFsPXW81OpyAlLJLwbJOwLHRikBCXlMNPtCN252BAWflEdTx9rBCGhHi79ecTyj+jRIDBIG5KCVNfBXnLYIHPRCW0TIs2/gFXqtIsGgeI7kp4eLCvyWaR8s8mAW/4OHjrk8XLWmHWRzt4vCBVv8olRT30Svg2534Q==';
const EXPECTED_FINGERPRINT='SHA256:m5FRNKDKpT7F0NbzLG80uK/MH4zyuVST7GatAS14n0w';
const PUBLIC_KEY='ssh-rsa '+PUBLIC_KEY_B64;

function fingerprint(publicKey) {
  const fields=String(publicKey||'').trim().split(/\s+/);
  if(fields[0]!=='ssh-rsa'||!fields[1])return null;
  const raw=Buffer.from(fields[1],'base64');
  if(!raw.length||raw.readUInt32BE(0)!==7||raw.subarray(4,11).toString()!=='ssh-rsa')return null;
  return 'SHA256:'+crypto.createHash('sha256').update(raw).digest('base64').replace(/=+$/,'');
}
function keyMatches(line) {
  const fields=String(line||'').trim().split(/\s+/);
  return fields[0]==='ssh-rsa' && fields[1]===PUBLIC_KEY_B64;
}
function githubKeys({timeoutMs=6000}={}) {
  return new Promise((resolve,reject)=>{
    const req=https.get('https://github.com/'+GITHUB_USER+'.keys',
      {timeout:timeoutMs,headers:{'user-agent':'hAPI-Admin-DevTools/0.1','accept':'text/plain'}},
      res=>{
        if(res.statusCode!==200){res.resume();return reject(Error('GITHUB_KEYS_HTTP_'+res.statusCode))}
        let body='';
        res.setEncoding('utf8');
        res.on('data',chunk=>{body+=chunk;if(body.length>100000)req.destroy(Error('GITHUB_KEYS_TOO_LARGE'))});
        res.on('end',()=>resolve(body.split(/\r?\n/).some(keyMatches)));
      });
    req.on('timeout',()=>req.destroy(Error('GITHUB_KEYS_TIMEOUT')));
    req.on('error',reject);
  });
}
function verifySignature(challenge,signature,{binary='ssh-keygen'}={}) {
  if(typeof challenge!=='string'||!/^hapi-admin-devtools\/v1\nnonce=[a-f0-9]{64}\nfp=SHA256:[A-Za-z0-9+/]+\n$/.test(challenge))return false;
  if(typeof signature!=='string'||signature.length>16000||!/^-----BEGIN SSH SIGNATURE-----[\s\S]+-----END SSH SIGNATURE-----\s*$/.test(signature))return false;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hapi-ssh-'));
  try {
    const allowed=path.join(dir,'allowed_signers'),sig=path.join(dir,'challenge.sig');
    fs.writeFileSync(allowed,'hapi_admin '+PUBLIC_KEY+'\n',{mode:0o600});
    fs.writeFileSync(sig,signature,{mode:0o600});
    const child=spawnSync(binary,['-Y','verify','-f',allowed,'-I','hapi_admin','-n','hapi-devtools','-s',sig],
      {input:challenge,encoding:'utf8',timeout:6000,maxBuffer:8192});
    return child.status===0 && !child.error;
  } finally {fs.rmSync(dir,{recursive:true,force:true})}
}
function validateOptions(options) {
  return options && options.github_username===GITHUB_USER &&
    options.github_ssh_fingerprint===EXPECTED_FINGERPRINT &&
    fingerprint(PUBLIC_KEY)===EXPECTED_FINGERPRINT;
}
function newChallenge() {
  return 'hapi-admin-devtools/v1\nnonce='+crypto.randomBytes(32).toString('hex')+
   '\nfp='+EXPECTED_FINGERPRINT+'\n';
}
module.exports={EXPECTED_FINGERPRINT,GITHUB_USER,PUBLIC_KEY,fingerprint,keyMatches,githubKeys,verifySignature,validateOptions,newChallenge};
