'use strict';
// Filing cabinet: an admin-only document store (folders, subfolders, files) separate from portals.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const ooxml=require('./ooxml'),pdf=require('./pdf-writer');
const err=(m,status=400)=>Object.assign(new Error(m),{status});
const BAD=/[\u0000-\u001f<>:"\\|?*^&%!`$;]/;
const RESERVED=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const MIME={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',txt:'text/plain; charset=utf-8',md:'text/plain; charset=utf-8',csv:'text/plain; charset=utf-8',json:'text/plain; charset=utf-8',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
const INLINE=new Set(['pdf','png','jpg','jpeg','gif','webp','txt','md','csv','json']);
const TEXT_EXT=new Set(['txt','md','csv','json']);
const OPENABLE=new Set(['pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','txt','md','csv','png','jpg','jpeg','gif','webp','rtf']);
const ext=n=>(path.extname(n).slice(1)||'').toLowerCase();

function create({root,maxBytes:maxBytesOpt=52428800,localOpen=false}){const limit=()=>typeof maxBytesOpt==='function'?maxBytesOpt():maxBytesOpt;
 const base=path.join(root,'cabinet');
 const segs=rel=>{
  const out=[];for(const s of String(rel||'').split('/')){if(!s)continue;
   if(s==='.'||s==='..'||BAD.test(s)||s.length>200||/[ .]$/.test(s)||RESERVED.test(s))throw err('Invalid path');out.push(s)}
  if(out.length>16)throw err('Path too deep');return out;
 };
 async function resolve(rel,{mustExist=true}={}){
  const s=segs(rel);await fsp.mkdir(base,{recursive:true,mode:0o700});
  let cur=base;
  for(let i=0;i<s.length;i++){cur=path.join(cur,s[i]);const st=await fsp.lstat(cur).catch(e=>{if(e.code==='ENOENT')return null;throw e});
   if(st&&st.isSymbolicLink())throw err('Symbolic links are not allowed');
   if(!st&&(mustExist||i<s.length-1))throw err('Not found',404)}
  return {abs:cur,segs:s,rel:s.join('/')};
 }
 const name=n=>{const s=segs(n);if(s.length!==1)throw err('Invalid name');return s[0]};
 const entry=async(dir,n)=>{const st=await fsp.lstat(path.join(dir,n));return {name:n,type:st.isDirectory()?'folder':'file',size:st.isDirectory()?0:st.size,modified:st.mtime.toISOString(),ext:st.isDirectory()?'':ext(n)}};
 const unique=async(dir,n)=>{const e=path.extname(n),b=path.basename(n,e);let c=n,i=2;while(await fsp.lstat(path.join(dir,c)).then(()=>true,()=>false))c=`${b} (${i++})${e}`;return c};
 return {
  capabilities:{localOpen,get maxBytes(){return limit()},createTypes:['docx','xlsx','txt','md'],convert:{docx:['pdf'],md:['pdf']}},
  async list(rel){
   const r=await resolve(rel),st=await fsp.lstat(r.abs);if(!st.isDirectory())throw err('Not a folder');
   const names=await fsp.readdir(r.abs);const items=[];
   for(const n of names){try{if(BAD.test(n))continue;items.push(await entry(r.abs,n))}catch{}}
   items.sort((a,b)=>(a.type===b.type?0:a.type==='folder'?-1:1)||a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
   return {path:r.rel,items};
  },
  async mkdir(rel,n){const r=await resolve(rel),nm=name(n);await fsp.mkdir(path.join(r.abs,nm),{mode:0o700}).catch(e=>{if(e.code==='EEXIST')throw err('Already exists',409);throw e});return entry(r.abs,nm)},
  async upload(rel,n,buf){const r=await resolve(rel),nm=name(n);if(buf.length>limit())throw err('Payload too large',413);await fsp.writeFile(path.join(r.abs,nm),buf,{flag:'wx',mode:0o600}).catch(e=>{if(e.code==='EEXIST')throw err('Already exists',409);throw e});return entry(r.abs,nm)},
  async createFile(rel,n,type){
   if(!['docx','xlsx','txt','md'].includes(type))throw err('Unsupported file type');
   const r=await resolve(rel);let nm=name(n);if(ext(nm)!==type)nm=name(nm+'.'+type);
   const data=type==='docx'?ooxml.docx(''):type==='xlsx'?ooxml.xlsx():Buffer.from(type==='md'?'# '+path.basename(nm,'.md')+'\n\n':'','utf8');
   await fsp.writeFile(path.join(r.abs,nm),data,{flag:'wx',mode:0o600}).catch(e=>{if(e.code==='EEXIST')throw err('Already exists',409);throw e});return entry(r.abs,nm);
  },
  async saveText(rel,buf){
   const r=await resolve(rel);if(!TEXT_EXT.has(ext(r.abs)))throw err('Only text files can be edited');if(buf.length>5*1024*1024)throw err('Payload too large',413);
   const st=await fsp.lstat(r.abs);if(!st.isFile())throw err('Not a file');await fsp.writeFile(r.abs,buf,{mode:0o600});return entry(path.dirname(r.abs),path.basename(r.abs));
  },
  async file(rel){
   const r=await resolve(rel),st=await fsp.lstat(r.abs);if(!st.isFile())throw err('Not a file');
   const e=ext(r.abs);return {abs:r.abs,size:st.size,name:path.basename(r.abs),mime:MIME[e]||'application/octet-stream',inline:INLINE.has(e)};
  },
  async remove(rel){const r=await resolve(rel);if(!r.segs.length)throw err('Cannot delete the root');await fsp.rm(r.abs,{recursive:true,force:true});return {deleted:r.rel}},
  async rename(rel,n){const r=await resolve(rel);if(!r.segs.length)throw err('Invalid path');const nm=name(n),dest=path.join(path.dirname(r.abs),nm);
   if(await fsp.lstat(dest).then(()=>true,()=>false))throw err('Already exists',409);await fsp.rename(r.abs,dest);return entry(path.dirname(dest),nm)},
  async convert(rel,to){
   if(to!=='pdf')throw err('Only conversion to PDF is supported');
   const r=await resolve(rel),st=await fsp.lstat(r.abs);if(!st.isFile())throw err('Not a file');if(st.size>20*1024*1024)throw err('File too large to convert',413);
   const e=ext(r.abs),stem=path.basename(r.abs,path.extname(r.abs));let blocks;
   const buf=await fsp.readFile(r.abs);
   if(e==='md')blocks=pdf.markdownBlocks(buf.toString('utf8'));
   else if(e==='docx')blocks=ooxml.docxBlocks(buf);
   else throw err('Supported conversions: Word (.docx) → PDF and Markdown (.md) → PDF');
   const out=pdf.render(blocks,{title:stem}),dir=path.dirname(r.abs),nm=await unique(dir,stem+'.pdf');
   await fsp.writeFile(path.join(dir,nm),out,{flag:'wx',mode:0o600});return entry(dir,nm);
  },
  async open(rel){
   if(!localOpen||process.platform!=='win32')throw err('Opening on this computer is not available',404);
   const r=await resolve(rel),st=await fsp.lstat(r.abs);if(!st.isFile())throw err('Not a file');
   if(!OPENABLE.has(ext(r.abs)))throw err('This file type cannot be opened directly');
   const child=spawn('explorer.exe',[r.abs],{detached:true,stdio:'ignore',windowsHide:false});child.on('error',()=>{});child.unref();return {opened:path.basename(r.abs)};
  }
 };
}
module.exports={create};
