#!/usr/bin/env node
'use strict';
const path=require('node:path');
const fs=require('node:fs');
const {createIncidentStore}=require('./incident-store.cjs');
const store=createIncidentStore(process.env.HAPI_GUARDIAN_JOURNAL || path.join(process.cwd(),'reports','stability-incidents.jsonl'));
const [action,arg,...rest]=process.argv.slice(2);
async function main() {
  if(action==='ingest') {
    if(!arg) throw Error('usage: ingest <event.json>');
    const event=JSON.parse(fs.readFileSync(arg,'utf8'));
    process.stdout.write(JSON.stringify(store.ingest(event))+'\n');
  } else if(action==='list') {
    process.stdout.write(JSON.stringify(store.list().map(({timeline,...x})=>x),null,2)+'\n');
  } else if(action==='decision') {
    if(!arg || !rest[0] || !rest[1]) throw Error('usage: decision <id> <proposal|investigating|resolved|reopened|rejected> <summary>');
    process.stdout.write(JSON.stringify(store.recordDecision(arg,rest[0],rest.slice(1).join(' ')))+'\n');
  } else if(action==='analyze') {
    const incident=store.list().find(x=>x.id===arg);
    if(!incident) throw Error('unknown incident');
    const {analyzeIncident}=await import('./ai-analyzer.mjs');
    const advice=await analyzeIncident(incident);
    store.recordDecision(arg,'proposal',advice,'OpenAI Agents SDK');
    process.stdout.write(advice+'\n');
  } else {
    throw Error('usage: node tools/stability-guardian/cli.cjs <ingest|list|decision|analyze> ...');
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
