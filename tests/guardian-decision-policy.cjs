'use strict';
const assert=require('node:assert/strict');
const {evaluate,wilsonLower}=require('../hapi_enterprise/guardian/decision-policy.js');
function variant(environment,successful=950,all=1000) {
  return {tested:true,independent:true,successes:successful,trials:all,
    regressionPassed:true,integrityPassed:true,rollbackPassed:true,
    environment,testRunId:'run-'+environment};
}
const base={variantA:variant('ubuntu'),variantB:variant('haos'),
  backupVerified:true,rollbackTested:true,postRestartHealthDefined:true,
  recoveryControllerOutsideTarget:true,riskLevel:'low',
  actionId:'refresh-guardian-index',target:'diagnostic-index',reversible:true};
assert.equal(wilsonLower(1,1)<0.5,true,'perfect tiny sample is NOT 100% confidence');
assert.equal(evaluate(base).mode,'automatic-eligible');
assert.ok(evaluate(base).successPercent>=90);
assert.equal(evaluate({...base,variantB:variant('haos',890)}).mode,'approval-required');
assert.equal(evaluate({...base,variantB:variant('haos',820)}).mode,'blocked');
assert.equal(evaluate({...base,variantA:variant('haos')}).mode,'blocked','two environments mandatory');
assert.equal(evaluate({...base,backupVerified:false}).mode,'blocked');
assert.equal(evaluate({...base,recoveryControllerOutsideTarget:false}).mode,'blocked');
assert.equal(evaluate({...base,target:'database'}).mode,'manual-review');
assert.equal(evaluate({...base,actionId:'restart-home-assistant'}).mode,'approval-required',
  'whole-system restarts are not on the unattended allowlist');
assert.equal(evaluate({...base,actionId:'refresh-guardian-index',reversible:false}).mode,'approval-required');
assert.equal(evaluate({...base,variantB:{...variant('haos'),rollbackPassed:false}}).mode,'blocked');
console.log('guardian dual-variant evidence gates: OK');
