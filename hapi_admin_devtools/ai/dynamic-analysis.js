'use strict';
/**
 * Offline, bounded telemetry and scheduled analytical findings.
 * Unknown performance / function coverage is NEVER represented as healthy.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {parseInterval}=require('./operating-modes');
const {inventory:currentCoverage}=require('./function-coverage');
const CAP=2*1024*1024, MAX_LINES=2000;
const STATES=new Set(['ready','not-ready','unreachable','unknown']);
function numberOrNull(v){
 return typeof v==='number'&&Number.isFinite(v)&&v>=0? v:null;
}
function sanitizeSample(value,now=new Date()){
 if(!value || !STATES.has(value.state))throw Error('INVALID_DYNAMIC_SAMPLE');
 const at=now.toISOString();
 return {at,source:'enterprise-readiness',signalId:'hapi.ready',
   state:value.state,httpStatus:Number.isInteger(value.httpStatus)&&value.httpStatus>=0&&value.httpStatus<=599?value.httpStatus:null,
   consecutiveFailures:numberOrNull(value.consecutiveFailures),
   latencyMs:numberOrNull(value.latencyMs),
   successes:numberOrNull(value.successes),attempts:numberOrNull(value.attempts)};
}
function appendBounded(dir,name,value){
 const root=path.resolve(dir);
 if(!/^[a-z-]+\.jsonl$/.test(name))throw Error('INVALID_JOURNAL_NAME');
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const file=path.join(root,name);
 try{
  if(fs.statSync(file).size>=CAP){
    const lines=fs.readFileSync(file,'utf8').split('\n').filter(Boolean).slice(-MAX_LINES);
    const tmp=file+'.tmp';
    fs.writeFileSync(tmp,lines.join('\n')+'\n',{mode:0o600});
    fs.renameSync(tmp,file);
  }
 }catch(error){if(error.code!=='ENOENT')throw error}
 fs.appendFileSync(file,JSON.stringify(value)+'\n',{mode:0o600});
 return file;
}
function readRecent(dir,name,limit=250){
 const file=path.join(path.resolve(dir),name);
 try{
  if(fs.statSync(file).size>CAP*2)throw Error('JOURNAL_TOO_LARGE');
  return fs.readFileSync(file,'utf8').split('\n').filter(Boolean).slice(-limit)
    .flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}});
 }catch(error){if(error.code==='ENOENT')return [];throw error}
}
function buildFinding({category,signalId,metric,evidence,priority='medium',summary}){
 const digest=crypto.createHash('sha256').update(category+signalId+metric).digest('hex').slice(0,20);
 return {id:'dynamic-'+digest,category,signalId,metric,priority,
  evidence,summary,action:'review-proposal',applyAllowed:false,
  confidence:'observed-aggregate-not-verified-root-cause'};
}
function analyze(samples,{at=new Date(),minSamples=6}={}){
 const valid=samples.filter(x=>x&&STATES.has(x.state)&&Number.isFinite(Date.parse(x.at)));
 const recent=valid.slice(-Math.max(minSamples,500));
 const findings=[];
 if(recent.length<minSamples){
   return {at:at.toISOString(),sampleCount:recent.length,findings,
    status:'insufficient-data',functionCoverage:'unknown',health:'unknown'};
 }
 const failures=recent.filter(x=>x.state==='not-ready'||x.state==='unreachable');
 const failureRate=failures.length/recent.length;
 if(failureRate>=0.2){
   findings.push(buildFinding({category:'bug-fix',signalId:'hapi.ready',metric:'failed-readiness-ratio',
     priority:'high',evidence:{samples:recent.length,failures:failures.length,ratio:failureRate},
     summary:'Repeated readiness failures; reproduce and inspect actual cause before suggesting a fix'}));
 }
 const transitions=recent.reduce((n,x,i)=>i && x.state!==recent[i-1].state?n+1:n,0);
 if(transitions>=4){
   findings.push(buildFinding({category:'reliability',signalId:'hapi.ready',metric:'state-flapping',
     evidence:{samples:recent.length,transitions},
     summary:'Readiness state is changing frequently; investigate instability and external dependencies'}));
 }
 const latencies=recent.map(x=>x.latencyMs).filter(x=>x!==null&&Number.isFinite(x));
 if(latencies.length>=minSamples){
   const sorted=[...latencies].sort((a,b)=>a-b);
   const p95=sorted[Math.ceil(sorted.length*.95)-1];
   if(p95>=500){
     findings.push(buildFinding({category:'optimization',signalId:'hapi.ready',metric:'p95-latency',
       evidence:{samples:latencies.length,p95LatencyMs:p95},
       summary:'Elevated measured readiness latency; profile before assuming caching is beneficial'}));
   }
 }
 const outcomes=recent.filter(x=>x.successes!==null&&x.attempts!==null&&x.attempts>0&&x.successes<=x.attempts);
 if(outcomes.length>=minSamples){
   const successes=outcomes.reduce((n,x)=>n+x.successes,0),attempts=outcomes.reduce((n,x)=>n+x.attempts,0);
   if(attempts>=30&&successes/attempts<.95){
     findings.push(buildFinding({category:'outcome-improvement',signalId:'hapi.ready',metric:'success-rate',
       evidence:{samples:outcomes.length,attempts,successes,successRate:successes/attempts},
       summary:'Measured success rate is below target; investigate objective outcome metrics and compare variants'}));
   }
 }
 // Each uninstrumented function remains unknown. Only generate ONE aggregate
 // coverage proposal rather than hundreds of repeated false failure incidents.
 const funcs=currentCoverage();
 if(funcs.unobserved>0){
   findings.push(buildFinding({category:'coverage',signalId:'function-catalog',metric:'unobserved-functions',
     priority:'high',evidence:{baselineVersion:funcs.baselineVersion,
      listedFunctions:funcs.listed,unobserved:funcs.unobserved,liveInstrumented:funcs.liveInstrumented},
     summary:'Function-level runtime instrumentation is absent; create a coverage and sensor integration plan'}));
 }
 return {at:at.toISOString(),status:'review-required',health:failureRate>=.2?'degraded':'observed-ready',
   functionCoverage:funcs.liveInstrumented===funcs.listed?'instrumented':'partial-or-unobserved',
   sampleCount:recent.length,findings};
}
function createDynamicAnalyzer(dir,{intervalMinutes=360,onFinding=()=>{},
 now=()=>new Date()}={}){
 const interval=parseInterval(intervalMinutes),root=path.resolve(dir);
 let lastAnalysis=null,timer=null,running=false,latest=null;
 function sample(observation){
   const item=sanitizeSample(observation,now());
   appendBounded(root,'samples.jsonl',item);
   return item;
 }
 function runAnalysis(){
   if(running)return latest;
   running=true;
   try{
     const next=analyze(readRecent(root,'samples.jsonl'),{at:now()});
     appendBounded(root,'analyses.jsonl',next);
     latest=next;lastAnalysis=Date.parse(next.at);
     if(next.findings.length)onFinding(next);
     return next;
   }finally{running=false}
 }
 function start(){
   if(timer)return;
   const previous=readRecent(root,'analyses.jsonl',1)[0];
   if(previous){lastAnalysis=Date.parse(previous.at);latest=previous}
   timer=setInterval(()=>{
     if(!lastAnalysis||now().getTime()-lastAnalysis>=interval*60000){
       try{runAnalysis()}catch(e){console.error('DYNAMIC_ANALYSIS_FAILED',e.code||e.message)}
     }
   },Math.min(interval*60000,30000));
   timer.unref?.();
 }
 function stop(){if(timer){clearInterval(timer);timer=null}}
 function status(){
   return {mode:'dynamic',intervalMinutes:interval,analysisEnabled:!!timer,
     lastAnalysisAt:latest?.at||null,lastAnalysisStatus:latest?.status||'not-analyzed',
     lastFindingCount:latest?.findings?.length??null,
     nextAnalysisAt:Number.isFinite(lastAnalysis)?new Date(lastAnalysis+interval*60000).toISOString():null};
 }
 return {sample,runAnalysis,start,stop,status,readRecent:()=>readRecent(root,'analyses.jsonl',20)};
}
module.exports={sanitizeSample,appendBounded,readRecent,analyze,createDynamicAnalyzer};
