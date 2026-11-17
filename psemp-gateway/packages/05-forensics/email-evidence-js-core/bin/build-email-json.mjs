import fs from 'node:fs';
import path from 'node:path';
import { buildEmailEvidence } from '../src/email/build_email_evidence.js';
import { getEmailEvidenceOptions } from '../src/core/config.js';
import { atomicWriteNew } from '../src/core/utils.js';

const [input, outputArgument, evidenceId] = process.argv.slice(2);
if (!input) {
  console.error('Usage: node bin/build-email-json.mjs <input.eml> [output.json] [evidence-id]');
  process.exit(2);
}
const output = path.resolve(outputArgument || `${input}.evidence.json`);
const { maxEmailSizeMb } = getEmailEvidenceOptions();
const inputSize = fs.statSync(input).size;
if (inputSize > maxEmailSizeMb * 1024 * 1024) throw new RangeError(`Email exceeds configured maximum of ${maxEmailSizeMb} MB.`);
const bytes=fs.readFileSync(input);
const manifest=buildEmailEvidence(bytes,{filename:path.basename(input),evidenceId:evidenceId||null,...getEmailEvidenceOptions()});
atomicWriteNew(output,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output,source_sha256:manifest.source.hashes.sha256,headers:manifest.email.headers.ordered.length,received_hops:manifest.email.transport.hop_count,mime_parts:manifest.email.mime.part_count,attachments:manifest.email.attachments.length},null,2));
