#!/usr/bin/env node
/*
 * PSEMP gateway self-test.
 *
 * Runs the built-in known-answer checks and adds a round-trip proof: evidence is
 * computed, then re-verified from the same bytes, then rejected after tampering.
 *
 *   node psemp-gateway/test/self-test.cjs
 */

'use strict';

const assert = require('node:assert');
const api = require('../api.js');

async function main() {
  const result = await api.selfTest();
  const failed = result.checks.filter((check) => !check.ok);
  assert.ok(
    result.ok,
    `gateway self-test failed:\n${failed.map((check) => `  ${check.name}: ${check.detail}`).join('\n')}`
  );

  const body = 'Evidence body that must round-trip.';
  const attachments = [
    { name: 'report.txt', data: Buffer.from('report bytes', 'utf8') },
    { name: 'image.bin', data: Buffer.from([0x00, 0xff, 0x10, 0x42]) },
  ];
  const evidence = api.computeEvidence({
    body,
    attachments,
    config: { version: '1.0', pgpFingerprint: 'DEADBEEF' },
    evidenceId: '00000000-0000-4000-8000-000000000000',
    timestamp: '2026-01-01T00:00:00.000Z',
  });

  const verified = api.verifyEvidence(evidence.manifest, { body, attachments });
  assert.ok(verified.ok, `round-trip verification failed: ${JSON.stringify(verified.checks)}`);

  const manifestCheck = api.verifyManifest(evidence.manifestText, evidence.manifestSha256);
  assert.ok(manifestCheck.ok, `manifest hash mismatch: ${JSON.stringify(manifestCheck)}`);

  const tampered = api.verifyEvidence(evidence.manifest, { body: `${body} `, attachments });
  assert.ok(!tampered.ok, 'tampered body must fail verification');
  assert.ok(
    tampered.checks.some((check) => check.name === 'merkle-root' && !check.ok),
    'tampered body must also break the Merkle root'
  );

  assert.strictEqual(
    evidence.manifest.evidence_id,
    evidence.evidenceId,
    'header Evidence-ID must equal the manifest evidence_id'
  );

  const leaves = [evidence.bodySha256, ...evidence.attachments.map((entry) => entry.sha256)];
  assert.strictEqual(api.merkleRoot(leaves), api.merkleRoot([...leaves].reverse()));

  process.stdout.write(
    `psemp-gateway self-test: ${result.checks.length} checks + round-trip OK\n` +
      result.checks.map((check) => `  ok  ${check.name}${check.detail ? ` — ${check.detail}` : ''}`).join('\n') +
      '\n'
  );
}

main().catch((error) => {
  process.stderr.write(`psemp-gateway self-test: ${error && error.message ? error.message : error}\n`);
  process.exitCode = 1;
});
