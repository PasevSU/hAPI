// hAPI consent gate. Never treat browser state as server authorization.
const API='/api/evidence';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
const folder=()=>{const m=location.pathname.match(/\/portal\.html:([A-Za-z0-9_-]{1,90})$/);return m?.[1]||new URLSearchParams(location.search).get('folder')||'demo-evidence'};
const demo=folder()==='demo-evidence';
const terms=`УСЛОВИЯ ЗА ЗАЩИТЕН ДОСТЪП ДО ЦИФРОВИ ДОКАЗАТЕЛСТВА — v1.0\n\n1. Обхват: достъпът се отнася само за изрично предоставените материали от конкретния QR пакет.\n2. Достъп: разрешените файлове могат да се разглеждат и изтеглят според предоставените права. Не е разрешено заобикаляне на техническите ограничения.\n3. Проследимост: сървърът регистрира посещения, опити за достъп, отваряния и трансфери с времеви маркери и идентификатори на сесии.\n4. Лични данни: техническите данни се обработват за сигурност и отчетност съгласно отделното уведомление за поверителност. Приемането на условията не е съгласие за незадължително проследяване.\n5. Криптографски данни: хешове и подписи се проверяват самостоятелно; интерфейсните статуси не заместват независима експертиза.\n6. Срок: достъпът може да изтече или да бъде отнет от администратора.\n7. Права: приложимите права и ограничения зависят от основанието за предоставяне и действащото право.\n\nТози текст е проектен шаблон и изисква правен преглед преди публична употреба.`;
function openGate(){return new Promise(resolve=>{
 const back=el('div','gateback'),box=el('section','gate');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby','gate-title');
 const brand=el('div','gatebrand','⬡ hAPI  /  EVIDENCE ACCESS');const title=el('h1','', 'Защитен достъп до доказателства');title.id='gate-title';const note=el('p','muted','Преди прегледа на предоставените файлове прочетете условията за достъп и информацията за бисквитките.');
 const cookie=el('div','gategroup');cookie.append(el('h2','', 'Необходими бисквитки'),el('p','muted','Сесийна защита и удостоверяване. Активни са само докато са необходими за услугата. Не се използват за реклама.'));
 const necessary=el('label','checkline');const nec=document.createElement('input');nec.type='checkbox';nec.checked=true;nec.disabled=true;necessary.append(nec,document.createTextNode(' Строго необходими (винаги активни)'));cookie.append(necessary);
 const analytics=el('label','checkline');const ana=document.createElement('input');ana.type='checkbox';ana.checked=false;analytics.append(ana,document.createTextNode(' Незадължителна аналитика (изключена по подразбиране)'));cookie.append(analytics);
 const policy=el('p','muted','Администраторът трябва да публикува реални данни за администратора на лични данни, правното основание, получателите и сроковете за съхранение.');cookie.append(policy);
 const license=el('div','gategroup');license.append(el('h2','', 'Условия за използване'));const text=el('pre','termstext',terms);license.append(text);
 const agree=el('label','checkline');const ack=document.createElement('input');ack.type='checkbox';agree.append(ack,document.createTextNode(' Прочетох и приемам условията за достъп (v1.0)'));license.append(agree);
 const status=el('p','gateerror','');const foot=el('div','gatebuttons');const deny=el('button','tool','Отказ');const accept=el('button','primary','Приемам и продължавам');accept.disabled=true;ack.addEventListener('change',()=>accept.disabled=!ack.checked);
 deny.onclick=()=>{box.replaceChildren(el('h2','','Достъпът не е активиран'),el('p','muted','Можете да затворите този прозорец. Защитените файлове не са заредени.'))};
 accept.onclick=async()=>{accept.disabled=true;status.textContent='';try{
  if(!demo){const r=await fetch(`${API}/${encodeURIComponent(folder())}/consent`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({terms_version:'1.0',optional_analytics:ana.checked})});if(!r.ok)throw Error('Сървърът не потвърди разрешението за достъп.');}
  else sessionStorage.setItem('hapi-demo-consent','1');
  back.remove();resolve();
 }catch(e){status.textContent=e.message;accept.disabled=false}};
 foot.append(deny,accept);box.append(brand,title,note,cookie,license,status,foot);back.append(box);document.body.append(back);ack.focus();
})}
export async function requireConsent(){if(demo&&sessionStorage.getItem('hapi-demo-consent')==='1')return;await openGate()}
export function isDemo(){return demo}
