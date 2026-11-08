'use strict';
/**
 * Historical baseline is an inventory, NOT evidence that a function is
 * currently running. Coverage is unknown until a live sensor, test run or
 * explicit instrumented signal is bound to that exact function.
 */
const baseline=require('../protocols/function-option-baseline.json');
const crypto=require('node:crypto');
function functionId(moduleName,fn){
  return crypto.createHash('sha256').update(moduleName+'#'+fn).digest('hex').slice(0,20);
}
function inventory(){
 const functions=[];
 for(const mod of baseline.modules||[]){
   for(const fn of mod.functions||[]){
     functions.push({id:functionId(mod.module,fn.name),module:mod.module,name:fn.name,
       domain:mod.watchDomain||'unclassified',
       historicalTestListed:fn.tested===true,
       runtimeSensor:null,coverage:'unobserved',lastObservedAt:null,
       note:'Historical static catalog only; no proven runtime signal for this function'});
   }
 }
 return {
   schemaVersion:1,baselineVersion:baseline.baselineVersion,
   source:baseline.sourceFiles,listed: functions.length,
   functionCountClaim:baseline.functionCount,
   liveInstrumented:0,unobserved:functions.length,
   missingFromCatalog:baseline.functionCount!==functions.length,
   functions
 };
}
function coverage(registry,mappings={}){
 const records=registry.functions.map(fn=>{
   const signal=mappings[fn.id];
   if(!signal||typeof signal!=='object'||!signal.lastObservedAt||
     !['instrumented','test-only'].includes(signal.coverage))
      return fn;
   return {...fn,coverage:signal.coverage,runtimeSensor:signal.sensorId||null,
     lastObservedAt:signal.lastObservedAt,note:signal.coverage==='test-only'?
       'Only test evidence, not ongoing production telemetry':
       'Direct instrumentation present; validate freshness'};
 });
 return {...registry,functions:records,
   liveInstrumented:records.filter(x=>x.coverage==='instrumented').length,
   unobserved:records.filter(x=>x.coverage==='unobserved').length,
   testOnly:records.filter(x=>x.coverage==='test-only').length};
}
module.exports={inventory,coverage,functionId};
