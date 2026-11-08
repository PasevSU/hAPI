'use strict';
/**
 * Unprivileged GitHub Actions evidence reader for one fixed repository.
 * It never returns "approved to deploy"; it only reports directly observed CI facts.
 * All external data is untrusted until caller validates exact commit and trusted signer.
 */
const https=require('node:https');
const OWNER='PasevSU',REPO='hAPI';
function fetchJson(apiPath,{timeoutMs=8000}={}){
 return new Promise((resolve,reject)=>{
   const req=https.get('https://api.github.com/repos/'+OWNER+'/'+REPO+apiPath,{
     timeout:timeoutMs,headers:{'user-agent':'hAPI-Admin-DevTools/0.2',
       'accept':'application/vnd.github+json','x-github-api-version':'2022-11-28'}},res=>{
     if(res.statusCode!==200){res.resume();return reject(Error('GITHUB_ACTIONS_HTTP_'+res.statusCode));}
     let bytes=0;const chunks=[];
     res.on('data',c=>{bytes+=c.length;if(bytes>1024*1024){req.destroy(Error('GITHUB_ACTIONS_RESPONSE_TOO_LARGE'));return;}chunks.push(c);});
     res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(Error('GITHUB_ACTIONS_JSON_INVALID'));}});
   });
   req.on('timeout',()=>req.destroy(Error('GITHUB_ACTIONS_TIMEOUT')));
   req.on('error',reject);
 });
}
const validSha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const validId=id=>Number.isSafeInteger(id)&&id>0;
function normalizeRun(run,sha){
 const matches=run?.head_sha===sha&&run?.head_repository?.full_name==='PasevSU/hAPI';
 return {
  runId:run?.id??null,
  workflow:String(run?.name||'').slice(0,100),
  commitMatches:matches,
  status:run?.status||'unknown',
  conclusion:run?.conclusion||null,
  successful:matches&&run?.status==='completed'&&run?.conclusion==='success',
  // GitHub Actions results alone are NOT rollback tests or staging HAOS evidence.
  rollbackVerified:false,
  restoreDrillVerified:false
 };
}
async function inspectTwoRuns({sha,firstId,secondId,load=fetchJson}){
 if(!validSha(sha)||!validId(firstId)||!validId(secondId)||firstId===secondId)
   throw Error('INVALID_CI_RUN_INPUT');
 const [a,b]=await Promise.all([
   load('/actions/runs/'+firstId),load('/actions/runs/'+secondId)
 ]);
 const runs=[normalizeRun(a,sha),normalizeRun(b,sha)];
 return {commitSha:sha,runs,allCiSuccessful:runs.every(r=>r.successful),
  independentEnvironmentsVerified:false,
  releaseEligible:false,
  reason:runs.every(r=>r.successful)?
   'CI_SUCCEEDED_BUT_HAOS_RESTORE_AND_INDEPENDENCE_NOT_VERIFIED':
   'CI_NOT_VERIFIED'};
}
module.exports={fetchJson,normalizeRun,inspectTwoRuns};
