"use strict";
const $=id=>document.getElementById(id);
const slug=decodeURIComponent(location.pathname.split('/')[2]||'');
const token=new URL(location.href).searchParams.get('portal_token')||'';
const base='/api/v1/p/'+encodeURIComponent(slug);
const api=(path)=>base+path+(token?(path.includes('?')?'&':'?')+'portal_token='+encodeURIComponent(token):'');
const show=msg=>{$('status').textContent=msg};
const download=async(file,key)=>{
 const r=await fetch(api('/files/'+encodeURIComponent(file.id)+'/download'),{headers:key?{'X-File-Key':key}:{},referrerPolicy:'no-referrer'});
 if(!r.ok){show(r.status===403?'Невалиден ключ или изтеглянето е забранено.':'Изтеглянето не бе успешно.');return}
 const blob=await r.blob(),link=document.createElement('a'),url=URL.createObjectURL(blob);
 link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);show('Изтеглянето започна.');
};
(async()=>{try{
 const [a,b]=await Promise.all([fetch(api('')),fetch(api('/files?limit=500'))]);
 if(!a.ok||!b.ok)throw Error('Няма достъп до портала или токенът е невалиден.');
 const portal=await a.json(),listing=await b.json();$('title').textContent=portal.title;$('description').textContent=portal.description||'';
 if(!listing.files.length)show('Няма достъпни файлове.');else show('Намерени файлове: '+listing.total+(listing.hasMore?' (показани са първите 500)':''));
 for(const f of listing.files){const article=document.createElement('article'),name=document.createElement('strong'),meta=document.createElement('small');name.textContent=f.name;meta.textContent=[f.category,f.group,(f.tags||[]).join(', ')].filter(Boolean).join(' · ');article.append(name,meta);
 const mode=f.accessMode||'FREE';if(mode==='DISABLED'){const status=document.createElement('small');status.textContent='Изтеглянето е забранено';article.append(status)}else{
 const button=document.createElement('button');button.textContent=mode==='KEY_REQUIRED'?'Изтегли с ключ':'Изтегли';
 if(mode==='KEY_REQUIRED'){const input=document.createElement('input');input.type='password';input.autocomplete='off';input.placeholder='Файлов ключ';input.setAttribute('aria-label','Файлов ключ за '+f.name);article.append(input);button.addEventListener('click',()=>download(f,input.value));}
 else button.addEventListener('click',()=>download(f,''));article.append(button)}$('files').append(article)}
 }catch(e){show(e.message)}})();
