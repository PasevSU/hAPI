'use strict';
/**
 * Evidence-first decision policy. No side effects: this file NEVER applies fixes.
 * Percentages describe observed, verified outcomes, NOT AI self-assessed certainty.
 */
function wilsonLower(successes, trials, z=1.96) {
  if (!Number.isSafeInteger(successes)||!Number.isSafeInteger(trials)||trials<1||successes<0||successes>trials) return null;
  const p=successes/trials,z2=z*z,den=1+z2/trials;
  return Math.max(0,(p+z2/(2*trials)-z*Math.sqrt((p*(1-p)+z2/(4*trials))/trials))/den);
}
const SAFE_ACTIONS=new Set(['refresh-guardian-index','rotate-guardian-journal','refresh-translations-cache']);
const DISALLOWED_TARGETS=new Set(['database','documents','quarantine','access-policy','pgp-keys','secrets','os','supervisor','add-on-version']);
function evaluate(candidate) {
  if(!candidate||typeof candidate!=='object') return {mode:'blocked',reason:'MISSING_EVIDENCE',successPercent:null};
  const a=candidate.variantA,b=candidate.variantB;
  const checks=[a,b].map(x=>!!x && x.tested===true && x.independent===true &&
      Number.isSafeInteger(x.successes) && Number.isSafeInteger(x.trials) && x.trials>=30 &&
      x.successes>=0 && x.successes<=x.trials &&
      x.regressionPassed===true && x.integrityPassed===true && x.rollbackPassed===true);
  if(!checks.every(Boolean) || a.environment===b.environment || a.testRunId===b.testRunId ||
      !a.testRunId || !b.testRunId) return {mode:'blocked',reason:'TWO_INDEPENDENT_VERIFIED_VARIANTS_REQUIRED',successPercent:null};
  if(candidate.backupVerified!==true || candidate.rollbackTested!==true ||
      candidate.postRestartHealthDefined!==true || candidate.recoveryControllerOutsideTarget!==true)
    return {mode:'blocked',reason:'RECOVERY_SAFETY_NOT_VERIFIED',successPercent:null};
  if(candidate.riskLevel==='critical' || DISALLOWED_TARGETS.has(candidate.target))
    return {mode:'manual-review',reason:'PROTECTED_TARGET',successPercent:null};
  const lowerA=wilsonLower(a.successes,a.trials);
  const lowerB=wilsonLower(b.successes,b.trials);
  const measured=Math.floor(Math.min(lowerA,lowerB)*10000)/100;
  if(measured<80) return {mode:'blocked',reason:'EVIDENCE_BELOW_80',successPercent:measured};
  if(measured<90) return {mode:'approval-required',reason:'OPERATOR_BUTTON_REQUIRED',successPercent:measured};
  if(!SAFE_ACTIONS.has(candidate.actionId) || candidate.reversible!==true)
    return {mode:'approval-required',reason:'NOT_ALLOWLISTED_FOR_AUTOMATIC_ACTION',successPercent:measured};
  return {mode:'automatic-eligible',reason:'VERIFIED_LOW_RISK_REVERSIBLE',successPercent:measured};
}
module.exports={wilsonLower,evaluate,SAFE_ACTIONS};
