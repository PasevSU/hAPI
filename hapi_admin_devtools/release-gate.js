'use strict';
/**
 * Release eligibility engine. Pure read-only evaluator; it cannot publish a
 * release, call Home Assistant Supervisor, or execute a remediation.
 *
 * A green GitHub "Verified" badge is not a deployment authorization.
 * All evidence must be independently verified by trusted CI/restore adapters.
 */
const crypto=require('node:crypto');
const {DEFINITIONS}=require('./definitions');
const REPO=DEFINITIONS.github.owner+'/'+DEFINITIONS.github.repo;
const VALID_PHASES=new Set(DEFINITIONS.security.releasePhaseNames);
const SHA=/^[0-9a-f]{40}$/;
const VERSION=/^\d+\.\d+\.\d+$/;
function isHex64(v){return typeof v==='string'&&/^[0-9a-f]{64}$/.test(v)}
function safePlan(plan) {
  if(!plan||typeof plan!=='object'||Array.isArray(plan))return null;
  if(plan.repository!==REPO||!SHA.test(plan.commitSha||'')||
     !VERSION.test(plan.version||'')||!VERSION.test(plan.previousVersion||'')||
     !isHex64(plan.artifactSha256)||plan.version===plan.previousVersion)return null;
  if(!Array.isArray(plan.targets)||plan.targets.length===0||plan.targets.length>3||
     plan.targets.some(t=>!DEFINITIONS.security.targetArchitectures.includes(t))||
     new Set(plan.targets).size!==plan.targets.length)return null;
  return {repository:REPO,commitSha:plan.commitSha,version:plan.version,
    previousVersion:plan.previousVersion,artifactSha256:plan.artifactSha256,
    targets:[...plan.targets].sort()};
}
function canonicalIntent(plan) {
  const p=safePlan(plan);
  if(!p)throw Error('INVALID_RELEASE_PLAN');
  return 'hapi-admin-devtools/release-intent-v1\n'+JSON.stringify(p)+'\n';
}
function planDigest(plan){
  return crypto.createHash('sha256').update(canonicalIntent(plan)).digest('hex');
}
function evaluate(plan,evidence,verified={}) {
  const p=safePlan(plan);
  if(!p)return {status:'blocked',reasons:['INVALID_RELEASE_PLAN'],percentage:null};
  const problems=[];
  // trustedGitHubSignature must result from authenticated fetch + trusted GPG verification,
  // not from user-supplied JSON or a GitHub "Verified" badge alone.
  if(verified.gitHubCommit!==true||verified.commitSha!==p.commitSha)
    problems.push('TRUSTED_GITHUB_COMMIT_SIGNATURE_REQUIRED');
  if(verified.openpgpReleaseIntent!==true||verified.planDigest!==planDigest(p))
    problems.push('FRESH_OPENPGP_RELEASE_AUTHORIZATION_REQUIRED');
  if(verified.gitHubWritePermission!==true)
    problems.push('SCOPED_GITHUB_APP_PERMISSION_REQUIRED');
  if(verified.protectedEnvironment!==true)
    problems.push('PROTECTED_RELEASE_ENVIRONMENT_REQUIRED');
  const runs=Array.isArray(evidence?.runs)?evidence.runs:[];
  const distinct=new Set();
  if(runs.length!==2)problems.push('TWO_INDEPENDENT_CI_RUNS_REQUIRED');
  for(const run of runs){
    if(!run||!Number.isSafeInteger(run.runId)||run.runId<1 ||
       typeof run.environment!=='string'||!DEFINITIONS.security.releaseEnvironments.includes(run.environment) ||
       run.commitSha!==p.commitSha||run.artifactSha256!==p.artifactSha256)
      problems.push('CI_EVIDENCE_INVALID');
    else distinct.add(run.environment+':'+run.runId);
    // "passed" from the client is only descriptive until verified via GitHub API.
    if(!Array.isArray(run?.checks)||![...VALID_PHASES].every(phase=>run.checks.includes(phase)))
      problems.push('CI_REQUIRED_PHASES_MISSING');
  }
  if(distinct.size!==2||new Set(runs.map(x=>x?.environment)).size!==2)
    problems.push('INDEPENDENT_CI_ENVIRONMENTS_REQUIRED');
  if(verified.ciRunIdsValidated!==true)
    problems.push('CI_RUNS_NOT_INDEPENDENTLY_VERIFIED');
  if(verified.reproducibleArtifacts!==true)
    problems.push('REPRODUCIBLE_ARTIFACTS_NOT_VERIFIED');
  if(verified.backupVerified!==true||verified.rollbackDrillPassed!==true ||
     verified.recoveryOutsideTarget!==true)
    problems.push('BACKUP_AND_EXTERNAL_RECOVERY_REQUIRED');
  if(verified.haosCompatibilityPassed!==true)
    problems.push('HAOS_COMPATIBILITY_REQUIRED');
  if(evidence?.dataMigration===true||evidence?.quarantinePolicyChange===true||
     evidence?.secretsChanged===true)problems.push('HIGH_RISK_MANUAL_RELEASE_REVIEW');
  const reasons=[...new Set(problems)];
  return {
    status:reasons.length?'blocked':'review-ready',
    reasons,percentage:null,releaseTag:'v'+p.version,
    planDigest:planDigest(p),
    // Even review-ready cannot trigger publication without separate deliberate action.
    canPublish:false,canDeploy:false,canRestart:false,canRollback:false
  };
}
module.exports={REPO,safePlan,canonicalIntent,planDigest,evaluate};
