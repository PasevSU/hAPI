'use strict';
/**
 * Independent static/dynamic operating model for hAPI-DEV. Static work is
 * owner-directed; dynamic work consumes measured observations and creates
 * reviewable improvement proposals, not executed fixes.
 */
const STATIC=Object.freeze({
  id:'static',trigger:'assigned-task-or-repository-change',
  agents:['architecture-agent','incident-agent','security-agent','storage-agent',
    'portal-agent','frontend-agent','performance-agent','locale-agent',
    'qa-agent','release-agent','recovery-agent','knowledge-agent'],
  outputs:['classification','plan','candidate-patch-in-isolated-worker','test-evidence'],
  mayModifyProduction:false,
});
const IMPROVEMENTS=Object.freeze([
  {id:'optimization',name:'Оптимизация',description:'Измерена латентност, памет или ненужно повторение'},
  {id:'outcome-improvement',name:'Подобрение на резултата',description:'Промяна в успешното изпълнение и качество на резултата'},
  {id:'bug-fix',name:'Поправки',description:'Повтарящи се откази, грешки и регресии'},
  {id:'reliability',name:'Надеждност',description:'Нестабилност, периодични проблеми и възстановяване'},
  {id:'coverage',name:'Покритие на мониторинга',description:'Липсващи или остарели измервания за функции и сензори'},
  {id:'security',name:'Сигурност',description:'Безопасни диагностични сигнали за нарушени политики'},
  {id:'localization',name:'Езикови пакети',description:'Липсващи преводи, невалидни формати и placeholder грешки'},
]);
const DYNAMIC=Object.freeze({
  id:'dynamic',trigger:'continuous-sampling-and-configurable-analysis-interval',
  defaultAnalysisIntervalMinutes:360,minAnalysisIntervalMinutes:15,
  maxAnalysisIntervalMinutes:10080,
  outputs:IMPROVEMENTS.map(x=>x.id),
  persistence:'local-bounded-jsonl',inputPolicy:'sanitized-aggregate-metrics-only',
  falseCoveragePolicy:'unknown-not-healthy',
  mayModifyProduction:false,
});
function parseInterval(value){
  const raw=typeof value==='number'?value:String(value??DYNAMIC.defaultAnalysisIntervalMinutes);
  if(!/^(?:[1-9][0-9]{0,4})$/.test(String(raw)))throw Error('INVALID_DYNAMIC_ANALYSIS_INTERVAL');
  const n=Number(raw);
  if(!Number.isSafeInteger(n)||n<DYNAMIC.minAnalysisIntervalMinutes||
     n>DYNAMIC.maxAnalysisIntervalMinutes)throw Error('INVALID_DYNAMIC_ANALYSIS_INTERVAL');
  return n;
}
module.exports={STATIC,DYNAMIC,IMPROVEMENTS,parseInterval};
