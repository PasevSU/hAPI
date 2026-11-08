'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DEFINITIONS,parsePort,getRuntimeConfig,readAddonVersion}=require('../definitions');

test('definitions are deeply immutable, not editable from environment',()=>{
 assert.equal(Object.isFrozen(DEFINITIONS),true);
 assert.equal(Object.isFrozen(DEFINITIONS.github),true);
 assert.equal(Object.isFrozen(DEFINITIONS.security.releasePhaseNames),true);
 assert.equal(DEFINITIONS.github.owner,'PasevSU');
 assert.equal(DEFINITIONS.github.repo,'hAPI');
 assert.equal(DEFINITIONS.github.keyId,'4FC0B2596C68DCB9');
 assert.equal(DEFINITIONS.security.writeEnabled,false);
 assert.equal(DEFINITIONS.security.deployEnabled,false);
 assert.throws(()=>{DEFINITIONS.github.owner='attacker';},TypeError);
 assert.throws(()=>{DEFINITIONS.security.releasePhaseNames.push('skip');},TypeError);
});

test('runtime overrides cannot silently bypass validation or mutate policy',()=>{
 assert.equal(parsePort(undefined,8099),8099);
 assert.equal(parsePort('18888',8099),18888);
 for(const invalid of ['-1','0','65536','abc','8080junk','3.5',' 80 ']){
  assert.throws(()=>parsePort(invalid,8099),/INVALID_DEVTOOLS_PORT/);
 }
 const result=getRuntimeConfig({PORT:'18888',HAPI_DEVTOOLS_DATA:'/tmp/guardian-example'});
 assert.equal(result.ingressPort,18888);
 assert.equal(result.dataDir,'/tmp/guardian-example');
 assert.equal(result.enrollmentPath,'/tmp/guardian-example/enrollment.json');
 assert.equal(DEFINITIONS.transport.ingressPort,8099);
 assert.equal(DEFINITIONS.security.autoRepairEnabled,false);
 assert.equal(Object.isFrozen(result),true);
});

test('Home Assistant descriptor, Docker and central definitions remain consistent',()=>{
 const folder=path.join(__dirname,'..');
 const yaml=fs.readFileSync(path.join(folder,'config.yaml'),'utf8');
 const docker=fs.readFileSync(path.join(folder,'Dockerfile'),'utf8');
 assert.equal(readAddonVersion(),'0.2.0');
 assert.match(yaml,/^slug: "hapi_admin_devtools"$/m);
 assert.match(yaml,/^ingress_port: 8099$/m);
 assert.match(yaml,/^version: "0\.2\.0"$/m);
 assert.ok(docker.includes('definitions.js /app/'));
 assert.equal(DEFINITIONS.transport.ingressPort,8099);
 assert.deepEqual(DEFINITIONS.security.targetArchitectures,['amd64','aarch64','armv7']);
});

test('no stale repeated policy constants in core modules',()=>{
 for(const name of ['server.js','identity.js','monitor.js','github-verification.js','github-actions-evidence.js','release-gate.js']){
  const content=fs.readFileSync(path.join(__dirname,'..',name),'utf8');
  assert.match(content,/require\('\.\/definitions'\)/,name+' should import central definitions');
  assert.doesNotMatch(content,/const (?:GITHUB_USER|OWNER|REPO)='PasevSU'/,name);
 }
});
