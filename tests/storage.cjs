'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const { needsSymlinks, link, removeLink } = require('./helpers.cjs');
if (needsSymlinks('storage', 'маркерът на диска не може да сочи извън него')) return;
const {check}=require('../hapi_enterprise/storage-preflight');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'portal-storage-'));
try{
 for(const kind of ['addon_config','media','share'])fs.mkdirSync(path.join(tmp,kind));
 const env={STORAGE_ROOT_OVERRIDE:tmp};
 const opt={storage_location:'media',storage_subdirectory:'usb_disk',min_free_mb:0};
 const target=check(opt,env);assert.equal(target,path.join(tmp,'media','usb_disk'));
 assert.equal(check(opt,env),target);
 assert.throws(()=>check({...opt,storage_subdirectory:'../escape'},env));
 assert.throws(()=>check({...opt,storage_location:'other'},env));
 fs.mkdirSync(path.join(tmp,'share','existing'));fs.writeFileSync(path.join(tmp,'share','existing','data'),'KEEP');
 assert.throws(()=>check({storage_location:'share',storage_subdirectory:'existing',min_free_mb:0},env));
 assert.equal(fs.readFileSync(path.join(tmp,'share','existing','data'),'utf8'),'KEEP');
 // A symlinked marker must never be trusted as proof of storage ownership.
 const marker=path.join(tmp,'media','usb_disk','.portal-enterprise-storage');
 const outside=path.join(tmp,'external-marker');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'portal-enterprise-v1'),'portal-enterprise-v1\n');
 removeLink(marker);link(outside,marker);
 assert.throws(()=>check(opt,env),/Unsafe storage marker/);
 removeLink(marker);fs.writeFileSync(marker,'portal-enterprise-v1\n');
 fs.rmSync(path.join(tmp,'media','usb_disk'),{recursive:true});link(tmp,path.join(tmp,'media','usb_disk'));
 assert.throws(()=>check(opt,env));
 console.log('PASS storage: selectable mount, persistent marker, path traversal, nonempty directory, symlink refusal');
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
