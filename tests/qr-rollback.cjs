'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {create}=require('../portal_enterprise/runtime-config');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'qr-rollback-'));try{
 const runtime=create(root);const artifact=await runtime.createArtifacts({qrId:'QR_A'});
 assert(fs.existsSync(path.join(root,artifact.relativeDirectory,'manifest.json')));
 await runtime.removeArtifacts(artifact);
 assert(!fs.existsSync(path.join(root,artifact.relativeDirectory)));
 const b=await runtime.createArtifacts({qrId:'QR_B'});
 await assert.rejects(()=>runtime.createArtifacts({qrId:'QR_B'}));
 assert(fs.existsSync(path.join(root,b.relativeDirectory,'manifest.json')),'duplicate request must preserve existing artifact');
 await assert.rejects(()=>runtime.removeArtifacts({...b,relativeDirectory:'../other'}));
 console.log('PASS: QR rollback cleanup, duplicate protection, path validation');
}finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
