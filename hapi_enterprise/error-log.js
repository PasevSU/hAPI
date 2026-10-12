'use strict';
// Centralized, bounded structured error log. Entries are appended as JSONL with
// size/count pruning so a runaway error path cannot exhaust the storage volume.
const fsp=require('node:fs/promises');
const path=require('node:path');
const LEVELS=['error','warn','info'];
function create(root,{maxEntries=2000,maxBytes=4*1024*1024}={}){
 const filename=path.join(root,'error-log.jsonl');
 let queue=Promise.resolve();
 const prune=lines=>lines.slice(-maxEntries);
 function append(level,source,message,details={}){
  if(!LEVELS.includes(level))level='error';
  const entry={at:new Date().toISOString(),level,source:String(source||'system'),message:String(message||''),details};
  const task=queue.then(async()=>{
   await fsp.mkdir(path.dirname(filename),{recursive:true});
   await fsp.appendFile(filename,JSON.stringify(entry)+'\n',{mode:0o600});
   const lines=(await fsp.readFile(filename,'utf8')).split('\n').filter(Boolean);
   if(lines.length>maxEntries||Buffer.byteLength(lines.join('\n'),'utf8')>maxBytes)await fsp.writeFile(filename,prune(lines).join('\n')+'\n',{mode:0o600});
  }).catch(()=>{});
  queue=task;return task;
 }
 async function list({limit=100,level,source}={}){
  let lines=[];
  try{lines=(await fsp.readFile(filename,'utf8')).split('\n').filter(Boolean)}catch(e){if(e.code!=='ENOENT')throw e}
  const out=[];
  for(let i=lines.length-1;i>=0&&out.length<limit;i--){let e;try{e=JSON.parse(lines[i])}catch{continue}if(level&&e.level!==level)continue;if(source&&e.source!==source)continue;out.push(e)}
  return out;
 }
 return {append,list,filename};
}
module.exports={create};
