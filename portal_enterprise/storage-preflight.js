'use strict';
const fs=require('node:fs'),path=require('node:path');
const roots={addon_config:'/config',media:'/media',share:'/share'};
function decodeMount(s){return s.replace(/\\([0-7]{3})/g,(_,oct)=>String.fromCharCode(parseInt(oct,8)))}
function isMounted(mount,infoPath){
 try{return fs.readFileSync(infoPath,'utf8').split('\n').some(line=>{const fields=line.split(' ');return fields.length>4&&decodeMount(fields[4])===mount})}catch{return false}
}
function check(options, env=process.env){
 const kind=options.storage_location||'addon_config';
 if(!Object.hasOwn(roots,kind))throw Error('Unsupported storage location');
 const sub=options.storage_subdirectory||'portal_enterprise';
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(sub)||sub==='.'||sub==='..')throw Error('Invalid storage subdirectory');
 const root=env.STORAGE_ROOT_OVERRIDE ? path.resolve(env.STORAGE_ROOT_OVERRIDE,kind) : roots[kind];
 const mode=options.storage_mode||'local';
 if(!['local','ha_network'].includes(mode))throw Error('Unsupported storage mode');
 let parent=root;
 if(mode==='ha_network'){
  if(!['media','share'].includes(kind))throw Error('Network storage requires media or share mapping');
  const mount=options.storage_mount_name||'';
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(mount)||mount==='.'||mount==='..')throw Error('Invalid Home Assistant network storage name');
  parent=path.join(root,mount);
  if(!fs.existsSync(parent)||!fs.statSync(parent).isDirectory()||fs.lstatSync(parent).isSymbolicLink())throw Error('Home Assistant network storage is not mounted: '+parent);
  // Never create the mountpoint: a missing NAS must fail closed, not write to the host filesystem.
  if(env.STORAGE_ROOT_OVERRIDE===undefined && !isMounted(parent,env.MOUNTINFO_PATH||'/proc/self/mountinfo'))throw Error('Network storage mount is not active: '+parent);
 }
 const base=path.join(parent,sub);
 if(!fs.existsSync(root)||!fs.statSync(root).isDirectory())throw Error('Storage mount unavailable: '+root);
 if(fs.lstatSync(root).isSymbolicLink())throw Error('Symlink storage root refused');
 if(fs.existsSync(base)){
  if(fs.lstatSync(base).isSymbolicLink()||!fs.statSync(base).isDirectory())throw Error('Unsafe storage directory');
  const marker=path.join(base,'.portal-enterprise-storage');
  if(!fs.existsSync(marker)){
   if(fs.readdirSync(base).length)throw Error('Nonempty uninitialized storage directory; refusing to overwrite');
   fs.writeFileSync(marker,'portal-enterprise-v1\n',{flag:'wx',mode:0o600});
  } else {
   const markerStat=fs.lstatSync(marker);
   if(!markerStat.isFile()||markerStat.isSymbolicLink()||markerStat.nlink!==1)throw Error('Unsafe storage marker');
   if(fs.readFileSync(marker,'utf8')!=='portal-enterprise-v1\n')throw Error('Invalid storage marker');
  }
 }else{
  fs.mkdirSync(base,{mode:0o700});
  fs.writeFileSync(path.join(base,'.portal-enterprise-storage'),'portal-enterprise-v1\n',{flag:'wx',mode:0o600});
 }
 const probe=path.join(base,'.write-test-'+process.pid);
 try{fs.writeFileSync(probe,'ok',{flag:'wx',mode:0o600});fs.unlinkSync(probe)}catch(e){throw Error('Storage is not writable: '+e.message)}
 if(fs.statfsSync){const s=fs.statfsSync(base);const free=Number(s.bavail)*Number(s.bsize);if(free<Number(options.min_free_mb||100)*1024*1024)throw Error('Insufficient free storage space')}
 return base;
}
if(require.main===module){try{const options=JSON.parse(fs.readFileSync(process.env.OPTIONS_PATH||'/data/options.json','utf8'));process.stdout.write(check(options)+'\n')}catch(e){console.error('STORAGE PREFLIGHT FAILED: '+e.message);process.exit(1)}}
module.exports={check,isMounted};
