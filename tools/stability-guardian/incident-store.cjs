'use strict';
/**
 * Offline-first, append-only incident journal. No external packages or network calls.
 * Not a replacement for hAPI audit-chain; this is diagnostic evidence only.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_MESSAGE = 1200;
const MAX_EVENTS = 100000;
function redact(value) {
  return String(value ?? '')
    .replace(/(Authorization\s*:\s*)Bearer\s+[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[REDACTED]@')
    .slice(0, MAX_MESSAGE);
}
function fingerprint(source, code, message) {
  const normalized = redact(message).replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<uuid>')
    .replace(/\b\d+\b/g, '<n>').trim().toLowerCase();
  return crypto.createHash('sha256').update(JSON.stringify([source,code,normalized])).digest('hex').slice(0,24);
}
function validate(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw Error('event must be an object');
  const source = String(event.source || '').slice(0,80);
  const code = String(event.code || 'UNKNOWN').slice(0,80);
  const message = redact(event.message);
  const severity = String(event.severity || 'warning').toLowerCase();
  if (!source || !message || !['info','warning','error','critical'].includes(severity)) throw Error('invalid event');
  return { source, code, message, severity };
}
function createIncidentStore(file) {
  const filename = path.resolve(file);
  function append(record) {
    fs.mkdirSync(path.dirname(filename), {recursive:true, mode:0o700});
    fs.appendFileSync(filename, JSON.stringify(record)+'\n', {mode:0o600});
    return record;
  }
  function history() {
    if (!fs.existsSync(filename)) return [];
    const lines=fs.readFileSync(filename,'utf8').split('\n').filter(Boolean);
    if (lines.length>MAX_EVENTS) throw Error('incident log limit exceeded; archive before continuing');
    return lines.map((line)=>JSON.parse(line));
  }
  function ingest(event, now=new Date()) {
    const v=validate(event);
    const id=fingerprint(v.source,v.code,v.message);
    const previous=history().filter(x=>x.id===id);
    const occurrence=previous.filter(x=>x.type==='observed').length+1;
    return append({ type:'observed', id, at:now.toISOString(), ...v, occurrence });
  }
  function recordDecision(id, action, summary, actor='operator') {
    if (!/^[a-f0-9]{24}$/.test(id)) throw Error('invalid incident id');
    if (!['proposal','investigating','resolved','reopened','rejected'].includes(action)) throw Error('invalid action');
    if (!history().some(x=>x.type==='observed' && x.id===id)) throw Error('unknown incident');
    return append({type:'decision',id,at:new Date().toISOString(),action,actor:redact(actor).slice(0,80),summary:redact(summary)});
  }
  function list() {
    const map=new Map();
    for(const row of history()) {
      const current=map.get(row.id)||{id:row.id,count:0,status:'open',firstSeen:null,lastSeen:null,source:'',code:'',severity:'warning',message:'',timeline:[]};
      current.timeline.push(row);
      if(row.type==='observed'){
        current.count++; current.firstSeen ||=row.at;current.lastSeen=row.at;
        Object.assign(current,{source:row.source,code:row.code,severity:row.severity,message:row.message});
        if(current.status==='resolved') current.status='reopened';
      } else if(row.type==='decision') {
        if(row.action==='resolved') current.status='resolved';
        if(row.action==='reopened') current.status='reopened';
        if(row.action==='investigating') current.status='investigating';
      }
      map.set(row.id,current);
    }
    return [...map.values()].sort((a,b)=>b.lastSeen.localeCompare(a.lastSeen));
  }
  return {ingest,recordDecision,list,history};
}
module.exports={createIncidentStore,redact,fingerprint};
