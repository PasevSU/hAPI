'use strict';
/**
 * Every dynamic finding becomes a static development proposal assigned to an
 * existing specialist. No models are invoked and no remediation is executed.
 */
const {buildPlan}=require('./director');
const IMPROVEMENT_TO_AGENT=Object.freeze({
 'optimization':{category:'performance',owner:'performance-agent',division:'delivery-lead'},
 'outcome-improvement':{category:'diagnostics',owner:'incident-agent',division:'reliability-lead'},
 'bug-fix':{category:'diagnostics',owner:'incident-agent',division:'reliability-lead'},
 'reliability':{category:'diagnostics',owner:'incident-agent',division:'reliability-lead'},
 'coverage':{category:'architecture',owner:'architecture-agent',division:'strategy-lead'},
 'security':{category:'security',owner:'security-agent',division:'reliability-lead'},
 'localization':{category:'localization',owner:'locale-agent',division:'strategy-lead'}
});
function assignFinding(finding){
  const mapping=IMPROVEMENT_TO_AGENT[finding?.category];
  if(!mapping||typeof finding.id!=='string')throw Error('UNCLASSIFIED_DYNAMIC_FINDING');
  const input={id:finding.id,title:(finding.summary||'Investigate observed signal').slice(0,240),
    description:'Measured '+finding.metric+' on '+finding.signalId,
    files:[],target:'enterprise',risk:finding.priority==='high'?'high':'medium'};
  const plan=buildPlan(input);
  return {id:finding.id,mode:'dynamic-to-static',findingCategory:finding.category,
    category:mapping.category,owner:mapping.owner,division:mapping.division,
    risk:finding.priority||'medium',status:'planned',signalId:finding.signalId,
    evidence:finding.evidence||{},sourceFindingId:finding.id,
    plan:plan.plan,applyAllowed:false,releaseAuthorized:false,
    note:'Dynamic evidence produced an assigned review task; production mutation is not allowed.'};
}
function routeAnalysis(analysis){
  if(!Array.isArray(analysis?.findings))return [];
  return analysis.findings.map(assignFinding);
}
module.exports={assignFinding,routeAnalysis,IMPROVEMENT_TO_AGENT};
