'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {create,validate}=require('../portal_enterprise/runtime-config');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'portal-storage-'));try{
const rt=create(root);assert.equal(rt.databaseRelative,'db.json');
await rt.save({databaseDirectory:'database',databaseFile:'metadata.json',artifactDirectory:'qr-archive'});
const next=create(root);assert.equal(next.databaseRelative,path.join('database','metadata.json'));
const a=await next.createArtifacts({qrId:'QR_100'});assert.equal(a.relativeDirectory,path.join('qr-archive','QR_100'));
assert(fs.existsSync(path.join(root,'qr-archive','QR_100','manifest.json')));
assert.throws(()=>validate({databaseDirectory:'../bad'}));assert.throws(()=>validate({artifactDirectory:'../../bad'}));
fs.symlinkSync(root,path.join(root,'unsafe'));await assert.rejects(()=>next.save({databaseDirectory:'unsafe'}));
console.log('PASS: independently configurable DB directory/file and QR archive directory, persistence and traversal protection');
}finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
