'use strict';
// Retrieval from versioned, source-grounded hAPI protocols. No network and no LLM required.
const path=require('node:path');
const root=path.join(__dirname,'..','..','hapi_enterprise','guardian','protocols');
const defects=require(path.join(root,'historical-defects.json')).defects;
const releases=require(path.join(root,'release-history.json')).releases;
const watches=require(path.join(root,'watch-contracts.json')).watchers;
const IGNORE=new Set(['the','and','with','from','error','file','this','that','for','api','http','hapi','portal','или','като','при','със','за','не','на','от','преди','след','във','които','беше','вече','файл','папка']);
function tokens(value){
  const words=String(value||'').toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu)||[];
  return new Set(words.filter(x=>!IGNORE.has(x)).slice(0,200));
}
function matchCount(keys,text){
  const found=tokens(text);let score=0;
  for(const word of keys)if(found.has(word))score++;
  return score;
}
function retrieve(incident,{maxDefects=5,maxReleases=5,maxWatches=6}={}){
  const query=[incident?.source,incident?.code,incident?.message].filter(Boolean).join(' ');
  const words=tokens(query);
  const ranked=(items,describe,limit)=>
    items.map(item=>({item,score:matchCount(words,describe(item))}))
      .filter(x=>x.score>=1).sort((a,b)=>b.score-a.score)
      .slice(0,limit).map(x=>({score:x.score,...x.item}));
  const matchedDefects=ranked(defects,x=>[x.id,x.domain,x.summary,(x.modules||[]).join(' ')].join(' '),maxDefects)
    .map(x=>({id:x.id,area:x.domain,state:x.state,summary:x.summary,source:x.source,regressionHints:x.testHints,matchScore:x.score,
      warning:'HISTORICAL example, not proof of current failure'}));
  const matchedReleases=ranked(releases,x=>[x.version,x.notesPreview,(x.areas||[]).join(' ')].join(' '),maxReleases)
    .map(x=>({version:x.version,summary:x.notesPreview,source:x.source,matchScore:x.score,
      warning:'Release note, not live evidence'}));
  const matchedWatches=ranked(watches,x=>[x.domain,x.id,(x.files||[]).join(' '),(x.signals||[]).join(' ')].join(' '),maxWatches)
    .map(x=>({id:x.id,domain:x.domain,priority:x.priority,regression:x.regression,policy:x.policy,matchScore:x.score}));
  return {matchedDefects,matchedReleases,matchedWatches,
    notice:'Heuristic relevance by shared tokens; historical records are not current diagnoses. Verify against live metrics and tests.'};
}
module.exports={retrieve,tokens};
