'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const canonical=e=>JSON.stringify({seq:e.seq,at:e.at,event:e.event,details:e.details,prevHash:e.prevHash});
function createAuditChain(root){
 const filename=path.join(root,'audit-chain.jsonl');let queue=Promise.resolve();let previous='0'.repeat(64),sequence=0,initialized=false;
 async function verify(){let rows;try{rows=(await fs.readFile(filename,'utf8')).split('\n').filter(Boolean)}catch(e){if(e.code==='ENOENT')return {valid:true,count:0,lastHash:'0'.repeat(64)};throw e}
 let prev='0'.repeat(64);let seq=0;
 for(const line of rows){let e;try{e=JSON.parse(line)}catch{return {valid:false,count:seq,reason:'INVALID_JSON'}};
 if(e.seq!==seq+1||e.prevHash!==prev||typeof e.hash!=='string'||e.hash!==hash(canonical(e)))return {valid:false,count:seq,reason:'CHAIN_MISMATCH'};
 seq++;prev=e.hash;
 }return {valid:true,count:seq,lastHash:prev};}
 async function init(){if(initialized)return;const result=await verify();if(!result.valid)throw Error('Audit chain corrupted: '+result.reason);sequence=result.count;previous=result.lastHash;initialized=true}
 function append(event,details={}){const task=queue.then(async()=>{await init();const e={seq:++sequence,at:new Date().toISOString(),event,details,prevHash:previous};e.hash=hash(canonical(e));const line=JSON.stringify(e).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));await fs.appendFile(filename,line+'\n',{mode:0o600});previous=e.hash;return e});queue=task.catch(()=>{});return task}
 return {append,verify:async()=>{await queue;return verify()},init};
}
module.exports={createAuditChain};
