'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const text={
    bg:{title:'Административни инструменти',description:'Самостоятелен модул за диагностика и исторически протоколи на hAPI.',
      lock:'Заключено. В настройките на добавката въведете посочения OpenPGP fingerprint и проверете притежанието на ключа.',
      sign:'Подпишете challenge-а със своя OpenPGP signing ключ. Частният ключ никога не се изпраща.',
      verified:'Подписът е проверен. Административните DevTools са активирани.',
      ready:'hAPI отговаря на проверката за готовност.',offline:'hAPI не отговаря на проверката за готовност.',
      error:'Проверката не успя: ',noAuto:'Само четене. Няма автоматични поправки, рестартиране или промяна на документи.'},
    en:{title:'Administrator tools',description:'Independent diagnostic companion and release knowledge for hAPI.',
      lock:'Locked. Enter your full GitHub-registered OpenPGP fingerprint in add-on settings, then prove key ownership.',
      sign:'Prove possession of the OpenPGP private key. The private key is never uploaded.',
      verified:'Signature verified. Administrator DevTools are activated.',
      ready:'hAPI responds to readiness checks.',offline:'hAPI is not responding to readiness checks.',
      error:'Verification failed: ',noAuto:'Read-only. No automatic repairs, restarts or document changes.'},
    de:{title:'Administratorwerkzeuge',description:'Unabhängige Diagnose und Versionswissen für hAPI.',
      lock:'Gesperrt. OpenPGP-Fingerabdruck in den Add-on-Einstellungen eintragen und Schlüsselbesitz nachweisen.',
      sign:'Den Besitz des OpenPGP-Signaturschlüssels nachweisen. Der private Schlüssel wird nie übertragen.',
      verified:'Signatur geprüft. Administratorwerkzeuge sind aktiviert.',
      ready:'hAPI antwortet auf die Bereitschaftsprüfung.',offline:'hAPI antwortet nicht auf die Bereitschaftsprüfung.',
      error:'Verifizierung fehlgeschlagen: ',noAuto:'Nur Lesen. Keine automatischen Reparaturen, Neustarts oder Dokumentänderungen.'}
  };
  let lang='bg',challengeId=null;
  function t(k){return text[lang][k]||text.bg[k]}
  function chooseLanguage(value){lang=Object.hasOwn(text,value)?value:'bg';document.documentElement.lang=lang; $('title').textContent=t('title');$('description').textContent=t('description');$('help').textContent=t('sign');$('safety-note').textContent=t('noAuto')}
  async function api(path,options={}){
    const res=await fetch('./api/'+path,{cache:'no-store',headers:{'Content-Type':'application/json'},...options});
    const data=await res.json();
    if(!res.ok)throw Error(data.error||String(res.status));
    return data;
  }
  async function refresh(){
    try{
      const state=await api('status');
      $('fingerprint').textContent=state.fingerprint;
      $('enrollment').hidden=!state.configured||state.activated;
      $('overview').hidden=!state.activated;
      $('identity-state').textContent=state.activated?t('verified'):t('lock');
      if(state.activated){
        const overview=await api('overview');
        $('hapi-health').textContent=overview.hapi.ready?t('ready'):t('offline');
        $('operation-mode').textContent=t('noAuto');
        const list=$('protocols');list.replaceChildren();
        for(const [name,record] of Object.entries(overview.modules)){
          const item=document.createElement('li');
          item.textContent=name+' · '+(record.available?'OK':'missing')+
            (Number.isSafeInteger(record.items)?' · '+record.items:'');
          list.appendChild(item);
        }
      }
    }catch(error){$('identity-state').textContent=t('error')+error.message}
  }
  $('challenge-btn').addEventListener('click',async()=>{
    try{
      const x=await api('challenge',{method:'POST',body:'{}'});
      challengeId=x.id;$('challenge-text').value=x.challenge;$('challenge-block').hidden=false;
      $('identity-state').textContent=t('sign');
    }catch(e){$('identity-state').textContent=t('error')+e.message}
  });
  $('copy-btn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('challenge-text').value)}catch{$('challenge-text').focus();$('challenge-text').select()}});
  $('verify-btn').addEventListener('click',async()=>{
    if(!challengeId)return;
    try{
      await api('enroll',{method:'POST',body:JSON.stringify({id:challengeId,signature:$('signature').value})});
      challengeId=null;$('signature').value='';await refresh();
    }catch(e){$('identity-state').textContent=t('error')+e.message}
  });
  document.querySelectorAll('[data-language]').forEach(btn=>btn.addEventListener('click',()=>chooseLanguage(btn.dataset.language)));
  chooseLanguage('bg');refresh();
})();
