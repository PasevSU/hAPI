'use strict';
const fsp=require('node:fs/promises'),path=require('node:path');
const MS=86400000;
// Retention policies: age-based expiry of uploaded files and the human-readable audit
// log. Files older than fileDays are either disabled (default) or deleted; audit lines
// older than auditDays are pruned. The tamper-evident hash chain (audit-chain.jsonl)
// is intentionally NOT truncated, since truncation would break its integrity guarantee.
function create({filesRoot,auditPath,getSettings}){
 const cfg=()=>{const r=getSettings().retention||{enabled:false,fileDays:null,auditDays:null,fileAction:'disable'};return r};
 async function auditLines(){try{return (await fsp.readFile(auditPath,'utf8')).split('\n').filter(Boolean)}catch(e){if(e.code==='ENOENT')return [];throw e}}
 async function preview(portals){
  const c=cfg();const fileCut=c.fileDays?Date.now()-c.fileDays*MS:null,auditCut=c.auditDays?Date.now()-c.auditDays*MS:null;
  const files=[];if(fileCut){for(const p of portals)for(const f of p.files){const t=Date.parse(f.uploadedAt||'');if(!Number.isFinite(t))continue;if(t<fileCut&&f.accessMode!=='DISABLED')files.push({portalId:p.id,fileId:f.id,name:f.name,uploadedAt:f.uploadedAt})}}
  let auditLinesExpired=0;if(auditCut){for(const line of await auditLines()){try{if(Date.parse(JSON.parse(line).at)<auditCut)auditLinesExpired++}catch{}}}
  return {enabled:c.enabled,fileDays:c.fileDays,auditDays:c.auditDays,fileAction:c.fileAction,files,auditLinesExpired};
 }
 async function apply(portals){
  const c=cfg();const prev=await preview(portals);if(!c.enabled)return {...prev,applied:false,note:'retention disabled'};
  let deleted=0,disabled=0;
  for(const it of prev.files){const p=portals.find(x=>x.id===it.portalId);if(!p)continue;const f=p.files.find(x=>x.id===it.fileId);if(!f)continue;
   if(c.fileAction==='delete'){await fsp.rm(path.join(filesRoot,it.portalId,it.fileId),{force:true});p.files=p.files.filter(x=>x.id!==it.fileId);deleted++}
   else{f.accessMode='DISABLED';f.expired=true;disabled++}}
  let auditLinesPruned=0;if(c.auditDays){const cut=Date.now()-c.auditDays*MS;const lines=await auditLines();const keep=lines.filter(l=>{try{return Date.parse(JSON.parse(l).at)>=cut}catch{return false}});auditLinesPruned=lines.length-keep.length;if(auditLinesPruned>0)await fsp.writeFile(auditPath,keep.join('\n')+(keep.length?'\n':''),{mode:0o600})}
  return {...prev,applied:true,deleted,disabled,auditLinesPruned};
 }
 return {preview,apply};
}
module.exports={create};
