'use strict';
// Read-only GitHub commit verification gate. Does not authorize repository writes.
const https=require('node:https');
const identity=require('./identity');
const {DEFINITIONS,readAddonVersion}=require('./definitions');
const REPO=DEFINITIONS.github.owner+'/'+DEFINITIONS.github.repo;
function getCommit(sha,{timeoutMs=DEFINITIONS.limits.githubCommitTimeoutMs}={}){
  if(typeof sha!=='string'||!/^[0-9a-f]{40}$/.test(sha))return Promise.reject(Error('INVALID_COMMIT_SHA'));
  return new Promise((resolve,reject)=>{
    const req=https.get(DEFINITIONS.github.apiUrl+'/repos/'+REPO+'/commits/'+sha,{
      timeout:timeoutMs,headers:{'user-agent':'hAPI-Admin-DevTools/'+readAddonVersion(),'accept':'application/vnd.github+json',
        'x-github-api-version':DEFINITIONS.github.apiVersion}},res=>{
      if(res.statusCode!==200){res.resume();return reject(Error('GITHUB_COMMIT_HTTP_'+res.statusCode));}
      const chunks=[];let bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>DEFINITIONS.limits.githubCommitBytes{req.destroy(Error('GITHUB_COMMIT_TOO_LARGE'));return;}chunks.push(chunk);});
      res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(Error('GITHUB_COMMIT_INVALID_JSON'));}});
    });
    req.on('timeout',()=>req.destroy(Error('GITHUB_COMMIT_TIMEOUT')));
    req.on('error',reject);
  });
}
function verifyResponse(commit,{expectedSha,expectedFingerprint,publicKey}){
  if(!commit || commit.sha!==expectedSha) return {status:'rejected',reason:'SHA_MISMATCH'};
  const v=commit.commit?.verification;
  if(!v?.verified||!v.signature||!v.payload) return {status:'rejected',reason:v?.reason||'NOT_VERIFIED_BY_GITHUB'};
  if(!identity.verifyGitCommitSignature({payload:v.payload,signature:v.signature,expectedFingerprint,publicKey}))
    return {status:'rejected',reason:'NOT_SIGNED_BY_TRUSTED_OPENPGP_FINGERPRINT'};
  return {status:'verified',reason:'GITHUB_VERIFIED_AND_TRUSTED_OPENPGP_SIGNATURE',sha:expectedSha};
}
async function auditCommit(sha,expectedFingerprint){
  const publicKey=await identity.fetchGithubPublicKey();
  const commit=await getCommit(sha);
  return verifyResponse(commit,{expectedSha:sha,expectedFingerprint,publicKey});
}
module.exports={REPO,getCommit,verifyResponse,auditCommit};
