'use strict';
// Storage плъгин (Фаза 2.4). Интерфейс за файловия бекенд; днес — локална ФС.
// P2/P4: смяната на бекенда (S3, NFS, etc.) става чрез нов create(), не рефакторинг.
const fsp=require('node:fs/promises');
const path=require('node:path');

function safe(root,rel){
  if(typeof rel!=='string'||!rel)throw Object.assign(Error('Invalid path'),{status:400});
  const abs=path.resolve(root,rel);
  const base=path.resolve(root);
  if(abs!==base&&!abs.startsWith(base+path.sep))throw Object.assign(Error('Path outside root'),{status:400});
  return abs;
}

function create({root,writeMode=0o600}={}){
  if(!root)throw Error('Storage: root required');
  const base=path.resolve(root);
  return {
    root:base,
    exists:async rel=>fsp.stat(safe(base,rel)).then(()=>true).catch(()=>false),
    read:async rel=>fsp.readFile(safe(base,rel)),
    write:async(rel,data)=>{const abs=safe(base,rel);await fsp.mkdir(path.dirname(abs),{recursive:true});await fsp.writeFile(abs,data,{mode:writeMode})},
    remove:async rel=>fsp.rm(safe(base,rel),{recursive:true,force:true}),
    list:async(rel='')=>{const abs=safe(base,rel);const ents=await fsp.readdir(abs,{withFileTypes:true});return ents.map(e=>({name:e.name,dir:e.isDirectory()}))},
    stat:async rel=>fsp.stat(safe(base,rel)),
    resolve:rel=>safe(base,rel)
  };
}
module.exports={create,safe};
