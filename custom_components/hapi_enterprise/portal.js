"use strict";
const $=id=>document.getElementById(id);
const match=location.pathname.match(/^\/api\/hapi_enterprise\/portal\/([a-z0-9][a-z0-9-]{0,62})$/);
const slug=match&&match[1];
// The portal credential stays in the URL fragment, never in an HTTP request URL.
const fragment=new URLSearchParams(location.hash.slice(1));
const portalKey=fragment.get('token')||'';
const base='/api/hapi_enterprise/v1/p/'+encodeURIComponent(slug||'');
const headers=()=>({'X-Portal-Key':portalKey});
const show=t=>{$('status').textContent=t};
async function api(path,extra={}) {return fetch(base+path,{headers:{...headers(),...extra},cache:'no-store',referrerPolicy:'no-referrer'});}
async function download(f,key){
 try{
  const response=await api('/files/'+encodeURIComponent(f.id)+'/download',key?{'X-File-Key':key}:{});
  if(!response.ok)throw Error(response.status===403?'Изтеглянето е забранено или ключът е невалиден.':'Неуспешно изтегляне.');
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=f.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  show('Изтеглянето започна.');
 }catch(e){show(e.message)}
}
(async()=>{
 if(!slug||!portalKey){show('Липсва валиден адрес или токен за портала.');return}
 try{
  const [a,b]=await Promise.all([api(''),api('/files?limit=500')]);
  if(!a.ok||!b.ok)throw Error('Невалиден токен или порталът не е достъпен.');
  const p=await a.json(),listing=await b.json();
  $('title').textContent=p.title;$('description').textContent=p.description||'';
  show('Намерени файлове: '+listing.total+(listing.hasMore?' (показани са първите 500)':''));
  for(const f of listing.files){
   const article=document.createElement('article'),name=document.createElement('strong'),meta=document.createElement('small');
   name.textContent=f.name;meta.textContent=[f.category,f.group,(f.tags||[]).join(', ')].filter(Boolean).join(' · ');
   article.append(name,meta);
   if(f.accessMode==='DISABLED') {const label=document.createElement('small');label.textContent='Недостъпен за изтегляне';article.append(label)}
   else {const button=document.createElement('button');button.textContent=f.accessMode==='KEY_REQUIRED'?'Изтегли с ключ':'Изтегли';
    if(f.accessMode==='KEY_REQUIRED'){const input=document.createElement('input');input.type='password';input.autocomplete='off';input.placeholder='Файлов ключ';article.append(input);button.addEventListener('click',()=>download(f,input.value))}
    else button.addEventListener('click',()=>download(f,''));article.append(button)}
   $('files').append(article);
  }
 }catch(e){show(e.message)}
})();
