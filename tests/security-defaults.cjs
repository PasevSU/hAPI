const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pe-security-'));
 const script=path.join(__dirname,'../hapi_enterprise/server.js');
 const run=(token)=>new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[script],{env:{...process.env,DATA_DIR:tmp,PORT:'0',ADMIN_TOKEN:token},stdio:['ignore','pipe','pipe']});
   let err='';child.stderr.on('data',b=>err+=b.toString());
   const timeout=setTimeout(()=>{child.kill();reject(new Error('server did not exit for rejected credential'))},1800);
   child.on('exit',code=>{clearTimeout(timeout);resolve({code,err})});
 });
 try{
   for(const token of ['CHANGE_TO_RANDOM_SECRET_AT_LEAST_24_CHARACTERS','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','short']){
     const r=await run(token);assert.notEqual(r.code,0);assert.match(r.err,/ADMIN_TOKEN/);
   }
   console.log('PASS: insecure default, repeated and short administrative secrets rejected');
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
