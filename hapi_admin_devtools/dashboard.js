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
        const [hierarchy,backlog]=await Promise.all([api('director/hierarchy'),api('director/backlog')]);
        $('development-director').hidden=false;
        $('director-state').textContent='Development Director · '+hierarchy.categories.length+
          ' категории · '+hierarchy.roles.length+' роли · '+backlog.total+' автоматично класифицирани задачи';
        const categories=$('director-categories');categories.replaceChildren();
        for(const c of hierarchy.categories){
          const li=document.createElement('li');
          li.textContent=c.title+' · '+c.division+' → '+c.owner+' · '+(backlog.categories[c.id]||0)+' задачи';
          categories.appendChild(li);
        }
        const pendingList=$('director-backlog');pendingList.replaceChildren();
        for(const task of backlog.tasks.slice(0,25)){
          const li=document.createElement('li');
          li.textContent=task.id+' · '+task.category+' · '+task.title.slice(0,140);
          pendingList.appendChild(li);
        }
        const policy=await api('release-policy');
        $('release-control').hidden=false;
        $('release-status').textContent=policy.publishAvailable?'Release available':
          'Release Control: само преглед. Публикуването и инсталирането са заключени.';
        const requirements=$('release-requirements');requirements.replaceChildren();
        for(const item of ['OpenPGP signed release intent','Trusted signed GitHub commit',
          'Two independent CI environments','Verified backup and external rollback',
          'Scoped GitHub App permissions','Protected release environment']){
          const li=document.createElement('li');li.textContent=item;requirements.appendChild(li);
        }
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
  $('director-plan-form').addEventListener('submit',async(event)=>{
    event.preventDefault();
    const title=$('director-plan-title').value.trim();
    if(!title)return;
    try{
      const task=await api('director/plan',{method:'POST',
        body:JSON.stringify({title,target:'enterprise'})});
      $('director-plan-result').textContent=[
        'Категория: '+task.category,
        'Направление: '+task.division,
        'Отговорник: '+task.owner,
        'Риск: '+task.risk,
        'Режим: '+task.automation,
        ...task.plan.map((s,i)=>(i+1)+'. '+s.step+' / '+s.owner)
      ].join('\n');
    }catch(e){$('director-plan-result').textContent=t('error')+e.message;}
  });
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
