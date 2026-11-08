'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const gate=require('../release-gate');
const commitSha='a'.repeat(40),artifactSha256='b'.repeat(64);
const plan={repository:'PasevSU/hAPI',commitSha,version:'0.69.207',
  previousVersion:'0.69.206',artifactSha256,targets:['amd64','aarch64']};
const checks=['unit','integration','regression','integrity','rollback'];
const runs=[
  {runId:1,environment:'ubuntu',commitSha,artifactSha256,checks},
  {runId:2,environment:'haos',commitSha,artifactSha256,checks}
];
function verification(){
 return {gitHubCommit:true,commitSha,openpgpReleaseIntent:true,
  planDigest:gate.planDigest(plan),gitHubWritePermission:true,
  protectedEnvironment:true,ciRunIdsValidated:true,
  reproducibleArtifacts:true,backupVerified:true,rollbackDrillPassed:true,
  recoveryOutsideTarget:true,haosCompatibilityPassed:true};
}
test('canonical release intent binds exact repository, SHA, version, artifact and architectures',()=>{
 assert.equal(gate.safePlan(plan).version,'0.69.207');
 assert.match(gate.canonicalIntent(plan),/release-intent-v1/);
 assert.equal(gate.planDigest(plan).length,64);
 assert.notEqual(gate.planDigest(plan),gate.planDigest({...plan,commitSha:'c'.repeat(40)}));
 assert.equal(gate.safePlan({...plan,repository:'untrusted/repo'}),null);
 assert.equal(gate.safePlan({...plan,targets:['amd64','amd64']}),null);
 assert.equal(gate.safePlan({...plan,artifactSha256:'bad'}),null);
});
test('fail-closed when evidence is missing or simulated',()=>{
 assert.equal(gate.evaluate(plan,{}).status,'blocked');
 assert.equal(gate.evaluate(plan,{runs},verification()).status,'review-ready');
 const outcome=gate.evaluate(plan,{runs},verification());
 assert.equal(outcome.canPublish,false);
 assert.equal(outcome.canDeploy,false);
 assert.equal(outcome.canRestart,false);
 assert.equal(outcome.percentage,null,'do not infer success probability from checkbox results');
 assert.ok(gate.evaluate(plan,{runs},{...verification(),gitHubCommit:false}).reasons.includes('TRUSTED_GITHUB_COMMIT_SIGNATURE_REQUIRED'));
 assert.ok(gate.evaluate(plan,{runs},{...verification(),backupVerified:false}).reasons.includes('BACKUP_AND_EXTERNAL_RECOVERY_REQUIRED'));
 assert.ok(gate.evaluate(plan,{runs},{...verification(),ciRunIdsValidated:false}).reasons.includes('CI_RUNS_NOT_INDEPENDENTLY_VERIFIED'));
 assert.ok(gate.evaluate(plan,{runs:[runs[0],{...runs[1],environment:'ubuntu'}]},verification()).reasons.includes('INDEPENDENT_CI_ENVIRONMENTS_REQUIRED'));
 assert.ok(gate.evaluate(plan,{runs:[runs[0],{...runs[1],checks:['unit']}]},verification()).reasons.includes('CI_REQUIRED_PHASES_MISSING'));
 assert.ok(gate.evaluate(plan,{runs,dataMigration:true},verification()).reasons.includes('HIGH_RISK_MANUAL_RELEASE_REVIEW'));
});
