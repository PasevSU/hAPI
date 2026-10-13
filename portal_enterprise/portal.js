"use strict";
const $=id=>document.getElementById(id);
const slug=decodeURIComponent(location.pathname.split('/')[2]||'');
const token=new URL(location.href).searchParams.get('portal_token')||'';
const base='/api/v1/p/'+encodeURIComponent(slug);
const api=p=>base+p+(token?(p.includes('?')?'&':'?')+'portal_token='+encodeURIComponent(token):'');
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
const setStatus=(msg,type)=>{const s=$('status');if(!msg){s.hidden=true;s.textContent='';return}s.hidden=false;s.textContent=msg;s.className='status'+(type?' status-'+type:'')};
const MODE_LABEL={FREE:'Без ключ',KEY_REQUIRED:'Изисква ключ',DISABLED:'Забранено'};
const MODE_CLASS={FREE:'badge-free',KEY_REQUIRED:'badge-key',DISABLED:'badge-disabled'};
const download=async(file,key,btn)=>{
 btn.disabled=true;
 try{
  const r=await fetch(api('/files/'+encodeURIComponent(file.id)+'/download'),{headers:key?{'X-File-Key':key}:{},referrerPolicy:'no-referrer'});
  if(!r.ok){setStatus(r.status===403?'Невалиден ключ или изтеглянето е забранено.':'Изтеглянето не бе успешно.','error');return}
  const blob=await r.blob(),a=document.createElement('a'),url=URL.createObjectURL(blob);
  a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  setStatus('Изтеглянето започна.','success');
 }catch{
  setStatus('Изтеглянето не бе успешно.','error');
 }finally{
  btn.disabled=false;
 }
};
const renderFile=f=>{
 const card=el('article','file');
 const head=el('div','file-head');
 const mode=f.accessMode||'FREE';
 head.append(el('span','file-name',f.name),el('span','badge '+(MODE_CLASS[mode]||''),MODE_LABEL[mode]||mode));
 card.append(head);
 const meta=[f.category,f.group,(f.tags||[]).join(', ')].filter(Boolean).join(' · ');
 if(meta)card.append(el('p','file-meta',meta));
 if(mode==='DISABLED'){
  card.append(el('p','file-note','Изтеглянето е забранено.'));
 }else{
  const actions=el('div','file-actions');
  let input=null;
  const btn=el('button','',mode==='KEY_REQUIRED'?'Изтегли с ключ':'Изтегли');
  if(mode==='KEY_REQUIRED'){
   input=el('input');input.type='password';input.autocomplete='off';input.placeholder='Файлов ключ';
   input.setAttribute('aria-label','Файлов ключ за '+f.name);actions.append(input);
  }
  btn.addEventListener('click',()=>download(f,input?input.value:'',btn));
  actions.append(btn);card.append(actions);
 }
 return card;
};
(async()=>{try{
 const [a,b]=await Promise.all([fetch(api('')),fetch(api('/files?limit=500'))]);
 if(!a.ok||!b.ok)throw Error('Няма достъп до портала или токенът е невалиден.');
 const portal=await a.json(),listing=await b.json();
 document.title=portal.title;
 $('title').textContent=portal.title;
 $('description').textContent=portal.description||'';
 const files=$('files');
 if(!listing.files.length){
  files.append(el('div','empty','Няма достъпни файлове.'));
 }else{
  const frag=document.createDocumentFragment();
  for(const f of listing.files)frag.append(renderFile(f));
  files.append(frag);
  setStatus('Намерени файлове: '+listing.total+(listing.hasMore?' (показани са първите 500)':''),'');
 }
}catch(e){setStatus(e.message,'error')}})();
