'use strict';
// Storage health checks: verifies that each configured storage location exists, is a
// real directory and is writable, using a unique probe file that is immediately removed.
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
async function checkLocation(location){
 const name=path.basename(location);
 try{
  const st=await fsp.stat(location);
  if(!st.isDirectory())return {name,available:false,writable:false,error:'NOT_A_DIRECTORY'};
  const probe=path.join(location,'.write-test-'+crypto.randomBytes(4).toString('hex'));
  let writable=true,error=null;
  try{await fsp.writeFile(probe,'ok',{flag:'wx',mode:0o600});await fsp.unlink(probe)}catch(e){writable=false;error=e.code||'WRITE_FAILED'}
  return {name,available:true,writable,error};
 }catch(e){return {name,available:false,writable:false,error:e.code||'UNAVAILABLE'}}
}
async function check(locations){const results=await Promise.all(locations.map(checkLocation));return {checkedAt:new Date().toISOString(),healthy:results.every(r=>r.available&&r.writable),locations:results}}
module.exports={check,checkLocation};
