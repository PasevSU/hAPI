'use strict';
// Safe, read-only monitor owned by Admin DevTools. No hAPI credentials, no mutations.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {DEFINITIONS}=require('./definitions');
const MAX_LOG=DEFINITIONS.limits.monitorJournalBytes;
const STATES=new Set(['ready','not-ready','unreachable']);
function probe({host=DEFINITIONS.transport.enterpriseHostname,port=DEFINITIONS.transport.enterprisePort,timeoutMs=DEFINITIONS.limits.hapiProbeTimeoutMs}={}){
  const start=process.hrtime.bigint();
  const latencyMs=()=>Math.round(Number(process.hrtime.bigint()-start)/1000000);
  return new Promise(resolve=>{
    const req=http.get({host,port,path:DEFINITIONS.enterprise.healthPath,timeout:timeoutMs,agent:false},res=>{
      res.resume();
      res.on('end',()=>resolve({state:res.statusCode===200?'ready':'not-ready',httpStatus:res.statusCode||0,latencyMs:latencyMs()}));
    });
    req.on('timeout',()=>req.destroy());
    req.on('error',()=>resolve({state:'unreachable',httpStatus:0,latencyMs:latencyMs()}));
  });
}
function createMonitor(dir,{intervalMs=DEFINITIONS.limits.monitorIntervalMs,onProbe=probe,onSample=()=>{}}={}){
  const root=path.resolve(dir),file=path.join(root,'monitor.jsonl');
  let timer=null,stopped=false,previous=null,consecutiveFailures=0,last=null;
  function record(result){
    if(!STATES.has(result.state))return;
    const entry={at:new Date().toISOString(),state:result.state,httpStatus:result.httpStatus,
      consecutiveFailures};
    try{
      fs.mkdirSync(root,{recursive:true,mode:0o700});
      if(fs.existsSync(file)&&fs.statSync(file).size>=MAX_LOG){
        const old=fs.readFileSync(file,'utf8').split('\n').filter(Boolean).slice(-2000);
        fs.writeFileSync(file+'.tmp',old.join('\n')+'\n',{mode:0o600});
        fs.renameSync(file+'.tmp',file);
      }
      fs.appendFileSync(file,JSON.stringify(entry)+'\n',{mode:0o600});
    }catch(error){console.error('DEVTOOLS_MONITOR_LOG:',error.code||'IO_ERROR')}
  }
  async function tick(){
    if(stopped)return;
    const result=await onProbe();
    if(stopped)return;
    consecutiveFailures=result.state==='ready'?0:consecutiveFailures+1;
    last={...result,at:new Date().toISOString(),consecutiveFailures};
    try{onSample(last)}catch(e){console.error('DEVTOOLS_DYNAMIC_SAMPLE_FAILED:',e.code||e.message)}
    if(result.state!==previous||consecutiveFailures%20===1)record(result);
    previous=result.state;
  }
  function start(){
    if(timer)return;
    stopped=false;void tick();
    timer=setInterval(()=>{if(!stopped)void tick()},intervalMs);
    timer.unref?.();
  }
  function stop(){stopped=true;if(timer){clearInterval(timer);timer=null}}
  function snapshot(){return last||{state:'unknown',at:null,consecutiveFailures:null,httpStatus:null}}
  return {start,stop,snapshot,tick};
}
module.exports={probe,createMonitor};
