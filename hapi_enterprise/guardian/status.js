'use strict';
// Cross-process, read-only diagnostic snapshot for HA sensors. No user data or credentials.
const fs=require('node:fs');
const path=require('node:path');
const STATES=new Set(['healthy','unready','unreachable','malformed']);
const MAX_AGE_MS=3*60*1000;
function publicStatus({dir='/data/stability-guardian', now=Date.now(), enabled=process.env.HAPI_GUARDIAN_ENABLED==='true'}={}){
  if (!enabled) return {enabled:false,available:false,state:'disabled',checkedAt:null,failureCount:null,cacheCandidates:null,remediationMode:'disabled',successPercent:null,automaticChanges:0,rollbackCount:0};
  try{
    const file=path.resolve(dir,'status.json');
    if(fs.statSync(file).size>4096)throw Error('STATUS_SIZE');
    const raw=JSON.parse(fs.readFileSync(file,'utf8'));
    const at=Date.parse(raw.at);
    if(!raw||!STATES.has(raw.state)||!Number.isFinite(at)||now-at>MAX_AGE_MS||now<at-15000)throw Error('STATUS_STALE');
    return {enabled:true,available:true,state:raw.state,checkedAt:raw.at,
      failureCount:Number.isSafeInteger(raw.failureCount)?Math.max(0,raw.failureCount):0,
      cacheCandidates:Number.isSafeInteger(raw.cacheCandidates)?Math.max(0,raw.cacheCandidates):0,
      remediationMode:'disabled',successPercent:null,
      // No production repair: evidence calculation does not grant mutation privileges.
      automaticChanges:0,rollbackCount:0};
  }catch{return {enabled:true,available:false,state:'unknown',checkedAt:null,failureCount:null,cacheCandidates:null,
    remediationMode:'disabled',successPercent:null,automaticChanges:0,rollbackCount:0}}
}
function writeStatus(dir,event,{failureCount=0,cacheCandidates=0}={}){
 if(!STATES.has(event.state))throw Error('INVALID_GUARDIAN_STATE');
 const root=path.resolve(dir);
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const payload={at:new Date().toISOString(),state:event.state,
    failureCount:Math.max(0,Number(failureCount)||0),cacheCandidates:Math.max(0,Number(cacheCandidates)||0)};
 const tmp=path.join(root,'status.json.tmp');
 fs.writeFileSync(tmp,JSON.stringify(payload)+'\n',{mode:0o600});
 fs.renameSync(tmp,path.join(root,'status.json'));
 return payload;
}
module.exports={publicStatus,writeStatus};
