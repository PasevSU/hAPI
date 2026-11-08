'use strict';
/**
 * Immutable workload registry assembled from real project protocols.
 * No prompt or externally obtained document may modify category ownership.
 */
const fs=require('node:fs');
const path=require('node:path');
const {buildPlan,fingerprintTask}=require('./director');
const PROTOCOLS=path.join(__dirname,'..','protocols');
function read(name){
  return JSON.parse(fs.readFileSync(path.join(PROTOCOLS,name+'.json'),'utf8'));
}
function inventory(){
  const defects=read('historical-defects').defects;
  const watchers=read('watch-contracts').watchers;
  const cache=read('cache-optimization').candidates;
  const backlog=[];
  for(const d of defects.filter(x=>x.state==='open')){
    const task={id:'historic-'+d.id,title:('Review unresolved '+d.id+' '+d.summary).slice(0,240),
      description:[d.domain,d.summary,...(d.modules||[])].join(' '),
      files:d.modules||[],target:'enterprise',risk:'critical'};
    backlog.push({...buildPlan(task),fingerprint:fingerprintTask(task),
      source:'KNOWN_DEFECTS.md',evidenceLevel:'historical-not-current-verification',historicalDefectId:d.id});
  }
  for(const watcher of watchers.filter(x=>x.id!=='all-source-modules')){
    const task={id:'watch-'+watcher.id,title:'Validate monitoring: '+watcher.id,
      description:watcher.domain+' '+(watcher.signals||[]).join(' '),
      files:watcher.files||[],target:'enterprise',risk:watcher.priority||'medium'};
    backlog.push({...buildPlan(task),fingerprint:fingerprintTask(task),source:'watch-contracts.json',
      evidenceLevel:'watch-plan-not-live-test',watchId:watcher.id});
  }
  for(const candidate of cache){
    const task={id:'cache-'+candidate.id,title:'Benchmark '+candidate.component,
      description:candidate.motivation||'',files:[],target:'enterprise',risk:'medium'};
    backlog.push({...buildPlan(task),fingerprint:fingerprintTask(task),source:'cache-optimization.json',
      evidenceLevel:'candidate-unmeasured',cacheCandidateId:candidate.id});
  }
  return Object.freeze({
    schemaVersion:1,
    generatedAt:new Date().toISOString(),
    sourceProtocols:['historical-defects.json','watch-contracts.json','cache-optimization.json'],
    total:backlog.length,
    categories:backlog.reduce((acc,item)=>{acc[item.category]=(acc[item.category]||0)+1;return acc},{}),
    tasks:backlog,
    notice:'Deterministic planning inventory only; no live execution, no inferred current defects or AI model call.'
  });
}
module.exports={inventory};
