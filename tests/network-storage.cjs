'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {check,isMounted}=require('../portal_enterprise/storage-preflight');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'portal-network-'));
try{
 for(const k of ['addon_config','media','share'])fs.mkdirSync(path.join(tmp,k));
 const env={STORAGE_ROOT_OVERRIDE:tmp};
 const cfg={storage_mode:'ha_network',storage_location:'media',storage_mount_name:'NAS',storage_subdirectory:'portal_enterprise',min_free_mb:0};
 assert.throws(()=>check(cfg,env),/not mounted/);
 fs.mkdirSync(path.join(tmp,'media','NAS'));
 const base=check(cfg,env);assert.equal(base,path.join(tmp,'media','NAS','portal_enterprise'));
 assert.equal(check(cfg,env),base);
 assert.throws(()=>check({...cfg,storage_mount_name:'../escape'},env),/Invalid/);
 assert.throws(()=>check({...cfg,storage_location:'addon_config'},env),/requires/);
 assert.throws(()=>check({...cfg,storage_mode:'nfs'},env),/Unsupported/);
 fs.mkdirSync(path.join(tmp,'media','bad'));fs.mkdirSync(path.join(tmp,'media','bad','portal_enterprise'));fs.writeFileSync(path.join(tmp,'media','bad','portal_enterprise','existing'),'safe');
 assert.throws(()=>check({...cfg,storage_mount_name:'bad'},env),/Nonempty/);
 fs.symlinkSync(tmp,path.join(tmp,'share','linked'));
 assert.throws(()=>check({...cfg,storage_location:'share',storage_mount_name:'linked'},env),/not mounted/);
 const mi=path.join(tmp,'mountinfo');fs.writeFileSync(mi,'12 11 0:50 / /media/NAS rw - cifs //nas/share rw\n');
 assert.equal(isMounted('/media/NAS',mi),true);assert.equal(isMounted('/media/missing',mi),false);
 console.log('PASS network storage: existing mount, fail closed, validation, marker, mountinfo');
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
