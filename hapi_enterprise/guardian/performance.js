'use strict';
/**
 * Offline performance analyzer for hAPI's EXISTING observer.js sensors.json.
 * Never enables caches, never records route names or visitor identifiers.
 * Sampling starts when Guardian is enabled, using delta counts (not cumulative averages).
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const MAX_BYTES=1024*1024;
const PATH_MAP=[
  {id:'C-001',match:/\/tree(?:\/|$)|\/folders?(?:\/|$)/},
  {id:'C-002',match:/\/sensors(?:\/|$)|\/metrics(?:\/|$)/},
  {id:'C-003',match:/\/reports?(?:\/|$)|\/preview(?:\/|$)|\/generator(?:\/|$)/},
  {id:'C-004',match:/\.(?:css|js|svg|png|webp)(?:\?|$)/},
  {id:'C-005',match:/\/share(?:\/|$)|\/signed(?:\/|$)/},
  {id:'C-006',match:/\/visitors?(?:\/|$)|\/geo(?:\/|$)/},
  {id:'C-007',match:/\/openapi|\/api-spec/}
];
const nonNegative=x=>Number.isFinite(Number(x)) ? Math.max(0,Number(x)) : 0;
const shortHash=text=>crypto.createHash('sha256').update(String(text)).digest('hex').slice(0,16);
function loadSnapshot(dataDir){
  const file=path.join(path.resolve(dataDir),'sensors.json');
  const stat=fs.statSync(file);
  if(stat.size>4*1024*1024)throw Error('SENSORS_TOO_LARGE');
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!value || typeof value!=='object' || !value.routes || typeof value.routes!=='object' || Array.isArray(value.routes))throw Error('SENSORS_INVALID');
  return value;
}
function evaluate(previous,current,{minCalls=30,slowAverageMs=150}={}){
  if(!current || !current.routes || typeof current.routes!=='object')return [];
  const outcomes=[];
  for(const [route,now] of Object.entries(current.routes)){
    // Existing observer normalizes paths; route text is ONLY used in memory for classification.
    if(!/^(?:GET|POST|PUT|PATCH|DELETE|HEAD) \//.test(route))continue;
    const before=previous?.routes?.[route]||{};
    const currentCount=nonNegative(now.count),previousCount=nonNegative(before.count);
    const calls=currentCount-previousCount;
    if(calls<minCalls || calls<0)continue;
    const errors=nonNegative(now.errors)-nonNegative(before.errors);
    const cumulative=nonNegative(now.avgMs)*currentCount;
    const older=nonNegative(before.avgMs)*previousCount;
    const avg=Math.max(0,(cumulative-older)/calls);
    if(avg<slowAverageMs || errors/calls>0.25)continue;
    const known=PATH_MAP.find(x=>x.match.test(route));
    outcomes.push({
      type:'cache-performance-candidate',
      candidateId:known?.id||'AUTO-'+shortHash(route),
      routeFingerprint:shortHash(route),
      observations:calls,
      meanLatencyMs:Math.round(avg),
      errorRatePercent:Math.max(0,Math.round((errors/calls)*100)),
      status:'needs-profiling',
      finding:'latency is elevated; caching benefit not yet measured',
    });
  }
  return outcomes;
}
function recordFindings(dir,findings){
  if(!findings.length)return 0;
  const folder=path.resolve(dir),file=path.join(folder,'cache-findings.jsonl');
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  let bytes=0;
  try{bytes=fs.statSync(file).size}catch(e){if(e.code!=='ENOENT')throw e}
  if(bytes>=MAX_BYTES){
    // Keep only the most recent measured observations, not raw requests or document bytes.
    const lines=fs.readFileSync(file,'utf8').split('\n').filter(Boolean).slice(-500);
    fs.writeFileSync(file+'.tmp',lines.join('\n')+'\n',{mode:0o600});
    fs.renameSync(file+'.tmp',file);
  }
  for(const row of findings){
    const clean={at:new Date().toISOString(),candidateId:String(row.candidateId).slice(0,32),
      routeFingerprint:String(row.routeFingerprint).slice(0,16),
      observations:nonNegative(row.observations),meanLatencyMs:nonNegative(row.meanLatencyMs),
      errorRatePercent:nonNegative(row.errorRatePercent),status:'needs-profiling'};
    fs.appendFileSync(file,JSON.stringify(clean)+'\n',{mode:0o600});
  }
  return findings.length;
}
module.exports={loadSnapshot,evaluate,recordFindings};
