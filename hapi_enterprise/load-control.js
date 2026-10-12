'use strict';
// Intelligent (adaptive) load control. Replaces the static download concurrency cap
// with a limit derived from live heap pressure and recent error rate, so the process
// sheds load before it is overwhelmed rather than after.
function create(opts={}){
 const base=opts.base||32,min=opts.min||2,heapWatermark=opts.heapWatermark||0.85,errorWindowMs=opts.errorWindowMs||60000;
 let effective=base,lastLevel='LOW',lastLevelAt=Date.now(),lastRecalc=null;
 const errorTimes=[];
 const v8=require('node:v8');
 function heapRatio(){return process.memoryUsage().heapUsed/Math.max(1,v8.getHeapStatistics().heap_size_limit)}
 function recordError(){const now=Date.now();errorTimes.push(now);while(errorTimes.length&&errorTimes[0]<now-errorWindowMs)errorTimes.shift();if(errorTimes.length>1000)errorTimes.splice(0,errorTimes.length-1000)}
 function errorRate(requests){return requests?errorTimes.length/requests:0}
 function recalc(requests){
  const h=heapRatio(),er=errorRate(requests);
  let level='LOW';
  if(h>=heapWatermark||er>=0.25)level='CRITICAL';
  else if(h>=heapWatermark*0.8||er>=0.10)level='HIGH';
  else if(h>=heapWatermark*0.6||er>=0.02)level='MEDIUM';
  const factor=level==='CRITICAL'?0.25:level==='HIGH'?0.5:level==='MEDIUM'?0.75:1;
  effective=Math.max(min,Math.floor(base*factor));
  if(level!==lastLevel)lastLevelAt=Date.now();
  lastLevel=level;
  lastRecalc={at:new Date().toISOString(),heapRatio:h,errorRate:er,level,effective,base,min};
  return lastRecalc;
 }
 function snapshot(requests){const lr=lastRecalc||recalc(requests);return {level:lastLevel,sinceLevel:lastLevelAt,effective,base,min,heapRatio:heapRatio(),recentErrors:errorTimes.length,errorWindowMs,lastRecalc:lr}}
 return {recalc,recordError,snapshot,get effective(){return effective}};
}
module.exports={create};
