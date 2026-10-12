'use strict';
// Phase 1.5 migration bridge: legacy (directory, portals, cabinet) -> DOCFLOW core.
// Idempotent via `meta` markers; writes only to the separate core.sqlite store, so the
// legacy metadata store is never mutated. dry-run reports without writing.
const fsp=require('node:fs/promises'),path=require('node:path');

function create({root,store,registry}){
 const cabinetRoot=path.join(root,'cabinet');
 const META={contacts:'migrated.contacts',portals:'migrated.portals',cabinet:'migrated.cabinet'};
 // Legacy directory field key -> DOCFLOW 1000 profile field.
 const CONTACT_MAP={name:'name',organization:'organization',department:'department',phone:'phone',address:'address',city:'city',country:'country',website:'website',notes:'notes'};

 async function walkCabinet(){
  const files=[];
  async function walk(dir,rel){
   let names;try{names=await fsp.readdir(dir,{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return;throw e}
   for(const n of names){
    if(n.name.startsWith('.'))continue;
    const abs=path.join(dir,n.name),r=rel?rel+'/'+n.name:n.name;
    if(n.isDirectory())await walk(abs,r);
    else if(n.isFile())files.push({abs,rel:r,name:n.name});
   }
  }
  await walk(cabinetRoot,'');
  return files;
 }
 async function analyze(db){
  const files=await walkCabinet();
  return {
   contacts:(db.directory&&db.directory.contacts||[]).length,
   portals:(db.portals||[]).length,
   cabinetFiles:files.length,
   migrated:{contacts:!!store.getMeta(META.contacts),portals:!!store.getMeta(META.portals),cabinet:!!store.getMeta(META.cabinet)}
  };
 }
 function migrateContacts(db){
  if(store.getMeta(META.contacts))return {skipped:true,reason:'already migrated'};
  const contacts=(db.directory&&db.directory.contacts)||[];
  if(!contacts.length){store.setMeta(META.contacts,'1');return {created:0,skipped:0,empty:true}}
  const group=store.createGroup({name:'Указател (мигриран)',description:'Импортирано от директорията',autoRecords:false,registry});
  let created=0,failed=0;const unknown={};
  for(const c of contacts){
   const fields={};if(c.email)fields.email=c.email;
   for(const [src,dst] of Object.entries(CONTACT_MAP))if(c.fields&&c.fields[src])fields[dst]=c.fields[src];
   for(const k of Object.keys(c.fields||{}))if(!(k in CONTACT_MAP)&&k!=='email')unknown[k]=(unknown[k]||0)+1;
   try{store.createRecord({prefix:'1000',group_id:group.id,fields,registry});created++}catch{failed++}
  }
  store.setMeta(META.contacts,'1');
  return {created,failed,group:group.id,unknownFields:Object.keys(unknown).length?unknown:undefined};
 }
 function migratePortals(db){
  if(store.getMeta(META.portals))return {skipped:true,reason:'already migrated'};
  const portals=db.portals||[];
  if(!portals.length){store.setMeta(META.portals,'1');return {created:0,empty:true}}
  let created=0,failed=0;
  for(const p of portals){
   const group=store.createGroup({name:p.title||p.slug,description:p.description||'',autoRecords:false,registry});
   try{store.createRecord({prefix:'3000',group_id:group.id,fields:{slug:p.slug,title:p.title,description:p.description||''},registry});created++}
   catch{store.deleteGroup(group.id);failed++}
  }
  store.setMeta(META.portals,'1');
  return {created,failed};
 }
 async function migrateCabinet(){
  if(store.getMeta(META.cabinet))return {skipped:true,reason:'already migrated'};
  const files=await walkCabinet();
  if(!files.length){store.setMeta(META.cabinet,'1');return {created:0,empty:true}}
  const group=store.createGroup({name:'Картотека (мигриран)',description:'Импортирано от шкафа',autoRecords:false,registry});
  let created=0,failed=0;
  for(const f of files){
   const top=f.rel.split('/')[0]||'root';
   const ext=path.extname(f.name).slice(1)||'';
   const fields={title:path.basename(f.name,path.extname(f.name)),category:f.rel.split('/').slice(0,-1).join('/')||'root',group:top,tags:ext?[ext]:[],notes:f.rel};
   try{store.createRecord({prefix:'2000',group_id:group.id,fields,registry});created++}catch{failed++}
  }
  store.setMeta(META.cabinet,'1');
  return {created,failed,group:group.id};
 }
 async function migrate(db,{dryRun=false}={}){
  const report=await analyze(db);
  if(dryRun)return {dryRun:true,report};
  const contacts=migrateContacts(db);
  const portals=migratePortals(db);
  const cabinet=await migrateCabinet();
  return {dryRun:false,report,contacts,portals,cabinet};
 }
 return {analyze,migrate};
}
module.exports={create};
