'use strict';
// Named configuration profiles. Each profile is a validated, atomically persisted
// snapshot of runtime settings that an administrator can save, list, apply or delete.
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {validate}=require('./runtime-config');
function create(root){
 const file=path.join(root,'config','profiles.json');
 async function read(){try{return JSON.parse(await fsp.readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return {};throw e}}
 async function write(profiles){
  const tmp=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
  await fsp.mkdir(path.dirname(file),{recursive:true});
  try{const h=await fsp.open(tmp,'wx',0o600);try{await h.writeFile(JSON.stringify(profiles,null,2));await h.sync()}finally{await h.close()}await fsp.rename(tmp,file)}catch(e){await fsp.rm(tmp,{force:true}).catch(()=>{});throw e}
 }
 function validName(name){return typeof name==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)}
 const bad=()=>Object.assign(new Error('Invalid profile name'),{status:400});
 async function list(){const p=await read();return Object.keys(p).sort().map(name=>({name,createdAt:p[name].createdAt,settings:p[name].settings}))}
 async function save(name,settings){if(!validName(name))throw bad();const validated=validate(settings);const p=await read();p[name]={createdAt:p[name]?.createdAt||new Date().toISOString(),settings:validated};await write(p);return {name,createdAt:p[name].createdAt,settings:validated}}
 async function get(name){if(!validName(name))throw bad();const p=await read();return p[name]?{name,createdAt:p[name].createdAt,settings:p[name].settings}:null}
 async function remove(name){if(!validName(name))throw bad();const p=await read();if(!p[name])return false;delete p[name];await write(p);return true}
 return {list,save,get,remove};
}
module.exports={create};
