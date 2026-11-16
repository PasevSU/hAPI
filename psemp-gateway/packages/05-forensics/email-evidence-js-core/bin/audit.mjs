import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildEmailEvidence } from '../src/email/build_email_evidence.js';
import { getEmailEvidenceOptions } from '../src/core/config.js';
import { atomicWriteReplace } from '../src/core/utils.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const functionDir=path.join(root,'src/functions');
const modules=fs.readdirSync(functionDir).filter(x=>x.endsWith('.js')).sort();
const expected=Array.from({length:25},(_,i)=>String(i+1).padStart(2,'0'));
const present=modules.map(x=>x.slice(0,2));
const inventoryPass=expected.every(x=>present.includes(x))&&modules.length===25;
const testRun=spawnSync(process.execPath,['--test'],{cwd:root,encoding:'utf8'});
const fixture=Buffer.from([
  'From: Evidence Sender <sender@example.invalid>',
  'To: Evidence Receiver <receiver@example.invalid>',
  'Subject: Deterministic audit fixture',
  'Message-ID: <audit-fixture@example.invalid>',
  'Date: Tue, 08 May 2026 10:00:00 +0000',
  'Received: from mx.example.invalid (mx.example.invalid [192.0.2.10]) by local.example.invalid; Tue, 08 May 2026 10:00:00 +0000',
  'Authentication-Results: local.example.invalid; dkim=pass; spf=pass; dmarc=pass',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Synthetic audit fixture.'
].join('\r\n'));
const sample=buildEmailEvidence(fixture,{filename:'audit-fixture.eml',...getEmailEvidenceOptions()});
const external=[
  {function:'canonical PDF/source renderer end-to-end',status:'NOT_VERIFIED',reason:'requires actual PDF/image renderer execution and independent pixel verification'},
  {function:'OCR engine execution for six crops',status:'NOT_VERIFIED',reason:'core creates/records six observations but no OCR engine is bundled'},
  {function:'shape/image matcher benchmark',status:'NOT_VERIFIED',reason:'descriptor storage contract exists; matcher threshold must be benchmarked on real scans'},
  {function:'irreversible PDF redaction end-to-end',status:'NOT_VERIFIED',reason:'plan/verification gate exists; actual PDF content-stream redaction engine is external'}
];
const report={
  generated_at:new Date().toISOString(),
  package:'evidence-object-email-core',
  status:(inventoryPass&&testRun.status===0&&external.every(x=>x.status==='PASS'))?'PASS':'BLOCKED',
  checks:{
    function_inventory:{status:inventoryPass?'PASS':'FAIL',expected:25,found:modules.length,modules},
    node_tests:{status:testRun.status===0?'PASS':'FAIL',stdout:testRun.stdout,stderr:testRun.stderr},
    sample_eml:{status:sample.email?.message?.message_id==='<audit-fixture@example.invalid>'&&sample.email?.transport?.hop_count===1?'PASS':'FAIL',source_sha256:sample.source?.hashes?.sha256,received_hops:sample.email?.transport?.hop_count,headers:sample.email?.headers?.ordered?.length,decoded_body_included:sample.audit?.events?.[0]?.decoded_body_included},
    external_engine_qualification:external
  },
  release_gate:'BLOCKED_UNTIL_ALL_REQUIRED_EXTERNAL_ENGINE_CHECKS_PASS'
};
atomicWriteReplace(path.join(root,'audit_report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,inventory:report.checks.function_inventory.status,tests:report.checks.node_tests.status,sample_eml:report.checks.sample_eml.status,external_not_verified:external.length,report:'audit_report.json'},null,2));
process.exit(testRun.status===0&&inventoryPass&&report.checks.sample_eml.status==='PASS'?0:1);
