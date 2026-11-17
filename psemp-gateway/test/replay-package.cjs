#!/usr/bin/env node
/*
 * PSEMP 1.1 — replay defence, metadata signature, canary, self-describing package.
 *
 * These are the three things the protocol promised beyond hashing: a copy that
 * cannot be usefully re-sent, metadata that is signed as well as the body, and one
 * JSON file that explains the evidence without this codebase.
 *
 * The point of several checks below is the NEGATIVE case: a store that accepts
 * everything is indistinguishable from no store at all, so every refusal verdict
 * (replay / expired / future-dated) is asserted, not just the happy path.
 *
 * Time is injected everywhere (`now`, `issuedAt`), so nothing here depends on the
 * wall clock and the checks cannot flake at a second boundary.
 *
 *   node psemp-gateway/test/replay-package.cjs
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = require('../api.js');

const FIXED = {
  evidenceId: '11111111-2222-3333-4444-555555555555',
  timestamp: '2026-11-16T14:00:00.000Z',
  nonce: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  sequence: 7,
  subject: 'Case 2026 evidence',
  from: 'sender@example.org',
  to: ['recipient@example.net'],
  date: '2026-11-16T14:00:00.000Z',
};

const NOW = Date.parse(FIXED.timestamp);

function check(name, fn) {
  const detail = fn();
  console.log(`  ok  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psemp-replay-'));
  console.log('replay-package:');

  try {
    /* ---------------------------------------------------------------- *
     * The replay record
     * ---------------------------------------------------------------- */

    check('replay-record-is-shaped-and-expires-after-its-window', () => {
      const replay = api.buildReplay({
        nonce: FIXED.nonce,
        sequence: FIXED.sequence,
        issuedAt: FIXED.timestamp,
        recipient: 'recipient@example.net',
      });
      assert.deepStrictEqual(Object.keys(replay), [
        'nonce',
        'sequence',
        'issued_at',
        'expires_at',
        'recipient',
        'single_use',
      ]);
      assert.strictEqual(replay.issued_at, FIXED.timestamp);
      const window = Date.parse(replay.expires_at) - Date.parse(replay.issued_at);
      assert.strictEqual(window, api.REPLAY_DEFAULTS.maxAgeSeconds * 1000);
      assert.strictEqual(replay.single_use, true);
      return `window ${window / 1000}s`;
    });

    check('a minted nonce is fresh per message and never repeats', () => {
      const seen = new Set();
      for (let i = 0; i < 64; i += 1) {
        const nonce = api.buildReplay({ issuedAt: FIXED.timestamp, sequence: i }).nonce;
        assert.match(nonce, /^[0-9a-f]{32}$/, `nonce ${nonce} is not 128-bit hex`);
        assert.ok(!seen.has(nonce), 'a nonce was minted twice');
        seen.add(nonce);
      }
      return '64 distinct 128-bit nonces';
    });

    check('honouring a nonce changes nothing about its validity', () => {
      // Case folding only: the value is hex/uuid shaped, so "A1B2" and "a1b2" are
      // the same nonce and must not be usable as two.
      const guard = new api.ReplayGuard({ persist: false });
      assert.strictEqual(guard.check('A1B2', { now: NOW }).verdict, 'first-use');
      assert.strictEqual(guard.check('a1b2', { now: NOW }).verdict, 'replay');
      return 'nonce comparison is case-insensitive';
    });

    /* ---------------------------------------------------------------- *
     * The guard — every verdict, not just "ok"
     * ---------------------------------------------------------------- */

    check('a nonce is accepted once and refused forever after', () => {
      const guard = new api.ReplayGuard({ persist: false });
      const first = guard.check(FIXED.nonce, { issuedAt: FIXED.timestamp, now: NOW });
      const again = guard.check(FIXED.nonce, { issuedAt: FIXED.timestamp, now: NOW });
      assert.strictEqual(first.ok, true);
      assert.strictEqual(first.verdict, 'first-use');
      assert.strictEqual(again.ok, false);
      assert.strictEqual(again.verdict, 'replay');
      assert.match(again.detail, /first seen at/);
      return 'first-use → replay';
    });

    check('a stale copy is refused as expired', () => {
      const guard = new api.ReplayGuard({ persist: false });
      const stale = new Date(NOW - (api.REPLAY_DEFAULTS.maxAgeSeconds + 60) * 1000).toISOString();
      const verdict = guard.check(FIXED.nonce, { issuedAt: stale, now: NOW });
      assert.strictEqual(verdict.ok, false);
      assert.strictEqual(verdict.verdict, 'expired');
      return verdict.detail;
    });

    check('a future-dated copy is refused before it can extend the window', () => {
      const guard = new api.ReplayGuard({ persist: false });
      const ahead = new Date(NOW + (api.REPLAY_DEFAULTS.maxSkewSeconds + 60) * 1000).toISOString();
      const verdict = guard.check(FIXED.nonce, { issuedAt: ahead, now: NOW });
      assert.strictEqual(verdict.ok, false);
      assert.strictEqual(verdict.verdict, 'future-dated');
      return verdict.detail;
    });

    check('a refused nonce does not poison the store', () => {
      // The freshness test runs BEFORE the insert, so a replayed or expired copy
      // must not teach the guard a nonce it never legitimately accepted.
      const guard = new api.ReplayGuard({ persist: false });
      const stale = new Date(NOW - 9999 * 1000).toISOString();
      assert.strictEqual(guard.check(FIXED.nonce, { issuedAt: stale, now: NOW }).verdict, 'expired');
      assert.strictEqual(guard.seen.size, 0, 'an expired check wrote to the store');
      assert.strictEqual(
        guard.check(FIXED.nonce, { issuedAt: FIXED.timestamp, now: NOW }).verdict,
        'first-use'
      );
      return 'store untouched by refusals';
    });

    check('the store survives a restart', () => {
      const storePath = path.join(dir, 'seen.json');
      const guard = new api.ReplayGuard({ storePath });
      assert.strictEqual(guard.check(FIXED.nonce, { issuedAt: FIXED.timestamp, now: NOW }).verdict, 'first-use');
      assert.ok(fs.existsSync(storePath), 'the store file was not written');

      const restarted = new api.ReplayGuard({ storePath });
      const verdict = restarted.check(FIXED.nonce, { issuedAt: FIXED.timestamp, now: NOW });
      assert.strictEqual(verdict.ok, false);
      assert.strictEqual(verdict.verdict, 'replay');
      return 'nonce remembered across instances';
    });

    check('the store is bounded, so memory cannot grow without limit', () => {
      const guard = new api.ReplayGuard({ persist: false, limits: { windowSize: 2 } });
      for (const nonce of ['n1', 'n2', 'n3']) guard.check(nonce, { now: NOW });
      assert.strictEqual(guard.seen.size, 2);
      assert.ok(!guard.seen.has('n1'), 'the oldest nonce was not evicted');
      return 'windowSize 2 keeps the 2 newest';
    });

    check('verifyReplay reads the manifest, not the caller', () => {
      const guard = new api.ReplayGuard({ persist: false });
      const manifest = {
        evidence_id: FIXED.evidenceId,
        replay: api.buildReplay({
          nonce: FIXED.nonce,
          sequence: FIXED.sequence,
          issuedAt: FIXED.timestamp,
          recipient: FIXED.to[0],
        }),
      };
      const first = api.verifyReplay(manifest, { guard, now: NOW });
      const again = api.verifyReplay(manifest, { guard, now: NOW });
      assert.strictEqual(first.verdict, 'first-use');
      assert.strictEqual(again.verdict, 'replay');
      assert.strictEqual(again.nonce, FIXED.nonce);
      return 'the nonce comes from the manifest';
    });

    check('a manifest with no nonce is reported, not silently accepted', () => {
      const guard = new api.ReplayGuard({ persist: false });
      const verdict = api.verifyReplay({ evidence_id: FIXED.evidenceId }, { guard, now: NOW });
      assert.strictEqual(verdict.ok, false);
      assert.strictEqual(verdict.verdict, 'unknown');
      return 'missing nonce is a refusal';
    });

    /* ---------------------------------------------------------------- *
     * Signed metadata — the body is not the only thing that can be edited
     * ---------------------------------------------------------------- */

    check('the signed-headers record covers the envelope', () => {
      const base = api.buildSignedHeaders({
        subject: FIXED.subject,
        from: FIXED.from,
        to: FIXED.to,
        date: FIXED.date,
        messageId: '<abc@psemp.local>',
      });
      assert.deepStrictEqual(Object.keys(base), [
        'subject',
        'from',
        'to',
        'date',
        'message_id',
        'attachments_sha256',
        'headers_sha256',
      ]);
      assert.deepStrictEqual(Array.from(base.to), FIXED.to);

      const edits = [
        ['subject', { subject: 'Case 2026 evidence (edited)' }],
        ['message_id', { messageId: '<other@psemp.local>' }],
        ['date', { date: '2026-11-16T15:00:00.000Z' }],
        ['from', { from: 'someone@example.org' }],
        ['to', { to: ['third@example.net'] }],
      ];
      for (const [label, patch] of edits) {
        const moved = api.buildSignedHeaders(
          Object.assign(
            {
              subject: FIXED.subject,
              from: FIXED.from,
              to: FIXED.to,
              date: FIXED.date,
              messageId: '<abc@psemp.local>',
            },
            patch
          )
        );
        assert.notStrictEqual(moved.headers_sha256, base.headers_sha256, `${label} is not signed`);
      }
      return `${edits.length} envelope fields are unforgeable`;
    });

    check('the attachment manifest digest ignores order but not content', () => {
      const entries = [
        { filename: 'a.pdf', sha256: 'a'.repeat(64) },
        { filename: 'b.pdf', sha256: 'b'.repeat(64) },
      ];
      const ordered = api.buildSignedHeaders({ attachmentEntries: entries });
      const reversed = api.buildSignedHeaders({ attachmentEntries: [...entries].reverse() });
      assert.strictEqual(reversed.attachments_sha256, ordered.attachments_sha256, 'order changed the digest');

      const renamed = api.buildSignedHeaders({
        attachmentEntries: [{ filename: 'c.pdf', sha256: 'a'.repeat(64) }, entries[1]],
      });
      assert.notStrictEqual(renamed.attachments_sha256, ordered.attachments_sha256, 'a rename went unnoticed');

      const swapped = api.buildSignedHeaders({
        attachmentEntries: [entries[0], { filename: 'b.pdf', sha256: 'c'.repeat(64) }],
      });
      assert.notStrictEqual(swapped.attachments_sha256, ordered.attachments_sha256, 'an edited file went unnoticed');
      return 'sorted pairs: order is stable, content is not';
    });

    check('the metadata digest does not cover itself', () => {
      const record = api.buildSignedHeaders({
        subject: FIXED.subject,
        to: FIXED.to,
        messageId: '<abc@psemp.local>',
      });
      const { headers_sha256: declared, ...rest } = record;
      assert.strictEqual(api.sha256Hex(JSON.stringify(rest)), declared);
      return 'recomputable from the record alone';
    });

    /* ---------------------------------------------------------------- *
     * Provenance and canary
     * ---------------------------------------------------------------- */

    check('provenance is a watermark inside the hashed manifest', () => {
      const provenance = api.buildProvenance({
        recipient: FIXED.to[0],
        messageId: '<abc@psemp.local>',
        evidenceId: FIXED.evidenceId,
        issuedAt: FIXED.timestamp,
        organization: 'PasevSU',
      });
      assert.strictEqual(provenance.framework, 'PasevSU');
      assert.strictEqual(provenance.standard, 'PSEMP');
      assert.strictEqual(provenance.recipient, FIXED.to[0]);
      assert.strictEqual(provenance.issued_at, FIXED.timestamp);
      // A newline in any field would be a header-injection primitive and must be
      // flattened before the value can reach a header or the manifest.
      const hostile = api.buildProvenance({ recipient: 'a@b.c\r\nBcc: victim@b.c' });
      assert.ok(!/[\r\n]/.test(hostile.recipient), 'provenance kept a CR/LF');
      return 'recipient + message id + issue time sealed inside the manifest';
    });

    check('the canary is derived, reproducible and not predictable forward', () => {
      const token = api.buildCanary({
        issuedAt: FIXED.timestamp,
        sequence: FIXED.sequence,
        organization: 'PasevSU',
        nonce: FIXED.nonce,
      });
      assert.match(token, /^PASEVSU-2026-11-16-[0-9A-F]{8}$/);
      assert.strictEqual(
        api.buildCanary({
          issuedAt: FIXED.timestamp,
          sequence: FIXED.sequence,
          organization: 'PasevSU',
          nonce: FIXED.nonce,
        }),
        token,
        'the same inputs must give the same token'
      );
      const later = api.buildCanary({
        issuedAt: FIXED.timestamp,
        sequence: FIXED.sequence + 1,
        organization: 'PasevSU',
        nonce: FIXED.nonce,
      });
      assert.notStrictEqual(later, token, 'the next message shares the canary');
      const otherNonce = api.buildCanary({
        issuedAt: FIXED.timestamp,
        sequence: FIXED.sequence,
        organization: 'PasevSU',
        nonce: 'ffffffffffffffffffffffffffffffff',
      });
      assert.notStrictEqual(otherNonce, token, 'the nonce is not part of the canary');
      return token;
    });

    check('the algorithms block names what was actually used', () => {
      const algorithms = api.buildAlgorithms();
      assert.strictEqual(algorithms.body, 'SHA-256');
      assert.strictEqual(algorithms.merkle, 'SHA-256');
      assert.ok(algorithms.extra.includes('SHA3-512') && algorithms.extra.includes('BLAKE3'));
      assert.ok(!JSON.stringify(algorithms).match(/MD5|SHA-?1\b/i), 'a broken algorithm was advertised');
      return algorithms.extra.join(' + ');
    });

    /* ---------------------------------------------------------------- *
     * End to end: evidence → verify → package
     * ---------------------------------------------------------------- */

    const evidence = await api.computeEvidence({
      body: 'Forensic evidence body\n',
      attachments: [{ name: 'report.pdf', data: Buffer.from('PDF') }],
      config: {
        version: '1.0',
        organization: 'PasevSU',
        pgpFingerprint: 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678',
      },
      evidenceId: FIXED.evidenceId,
      timestamp: FIXED.timestamp,
      nonce: FIXED.nonce,
      sequence: FIXED.sequence,
      recipient: FIXED.to[0],
      subject: FIXED.subject,
      from: FIXED.from,
      to: FIXED.to,
      date: FIXED.date,
    });

    check('the manifest carries the new blocks in a stable place', () => {
      const keys = Object.keys(evidence.manifest);
      assert.deepStrictEqual(keys.slice(-4), ['algorithms', 'provenance', 'signed_headers', 'replay']);
      assert.strictEqual(evidence.manifest.replay.nonce, FIXED.nonce);
      assert.strictEqual(evidence.manifest.provenance.recipient, FIXED.to[0]);
      assert.strictEqual(evidence.manifest.signed_headers.subject, FIXED.subject);
      assert.strictEqual(evidence.manifest.algorithms.body, 'SHA-256');
      return `appended after evidence_id: ${keys.slice(-4).join(', ')}`;
    });

    check('every new header line is emitted once, in contract order', () => {
      const lines = api.buildHeaderLines({
        config: { version: '1.0', organization: 'PasevSU' },
        evidenceId: evidence.evidenceId,
        bodyHash: evidence.bodySha256,
        attachmentEntries: evidence.attachments,
        merkle: evidence.merkleRoot,
        manifestHash: evidence.manifestSha256,
        timestamp: evidence.timestamp,
        replay: evidence.replay,
        signedHeaders: evidence.signedHeaders,
      });
      const names = lines.map((line) => line.slice(0, line.indexOf(':')));
      for (const name of [
        'X-PasevSU-Created',
        'X-PasevSU-Expires',
        'X-PasevSU-Nonce',
        'X-PasevSU-Sequence',
        'X-PasevSU-Canary',
        'X-PasevSU-Headers-SHA256',
      ]) {
        assert.strictEqual(
          names.filter((entry) => entry === name).length,
          1,
          `${name} is not emitted exactly once`
        );
      }
      const values = new Map(
        lines.map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()])
      );
      assert.strictEqual(values.get('X-PasevSU-Nonce'), FIXED.nonce);
      assert.strictEqual(values.get('X-PasevSU-Sequence'), String(FIXED.sequence));
      assert.strictEqual(values.get('X-PasevSU-Expires'), evidence.replay.expires_at);
      assert.strictEqual(values.get('X-PasevSU-Headers-SHA256'), evidence.signedHeaders.headers_sha256);
      assert.ok(!/[\r\n]/.test(lines.join('')), 'a header line carries a CR/LF');
      return 'nonce/sequence/window/metadata digest travel with the message';
    });

    check('the unedited manifest verifies clean', () => {
      const guard = new api.ReplayGuard({ persist: false });
      const verdict = api.verifyEvidence(evidence.manifest, {
        body: 'Forensic evidence body\n',
        attachments: [{ name: 'report.pdf', data: Buffer.from('PDF') }],
        subject: FIXED.subject,
        from: FIXED.from,
        to: FIXED.to,
        date: FIXED.date,
        replayGuard: guard,
        now: NOW,
      });
      const failed = verdict.checks.filter((entry) => !entry.ok);
      assert.ok(verdict.ok, `unexpected failures: ${JSON.stringify(failed)}`);
      assert.ok(verdict.checks.some((entry) => entry.name === 'replay:first-use'), 'the replay check did not run');
      assert.ok(verdict.checks.some((entry) => entry.name === 'headers-sha256'));
      return `${verdict.checks.length} checks`;
    });

    check('a re-sent copy fails verification the second time', () => {
      const guard = new api.ReplayGuard({ persist: false });
      const input = {
        body: 'Forensic evidence body\n',
        attachments: [{ name: 'report.pdf', data: Buffer.from('PDF') }],
        subject: FIXED.subject,
        from: FIXED.from,
        to: FIXED.to,
        date: FIXED.date,
        replayGuard: guard,
        now: NOW,
      };
      const first = api.verifyEvidence(evidence.manifest, input);
      const second = api.verifyEvidence(evidence.manifest, input);
      assert.strictEqual(first.ok, true);
      assert.strictEqual(second.ok, false, 'the replay was accepted');
      const replay = second.checks.find((entry) => entry.name === 'replay:replay');
      assert.ok(replay, 'the verdict was not reported');
      assert.strictEqual(replay.ok, false);
      return 'same evidence, second delivery refused';
    });

    check('edited metadata is detected even when the bytes are untouched', () => {
      const guard = new api.ReplayGuard({ persist: false });
      const verdict = api.verifyEvidence(evidence.manifest, {
        body: 'Forensic evidence body\n',
        attachments: [{ name: 'report.pdf', data: Buffer.from('PDF') }],
        subject: 'Case 2026 evidence (forwarded)',
        from: FIXED.from,
        to: FIXED.to,
        date: FIXED.date,
        replayGuard: guard,
        now: NOW,
      });
      assert.strictEqual(verdict.ok, false);
      const failed = new Set(verdict.checks.filter((entry) => !entry.ok).map((entry) => entry.name));
      assert.ok(failed.has('headers-match-message'), 'the metadata edit was not seen');
      assert.ok(failed.has('subject-match'), 'the subject edit was not seen');
      return `refused by ${[...failed].filter((name) => !name.startsWith('replay')).join(', ')}`;
    });

    check('an edited signed_headers block cannot verify', () => {
      const tampered = JSON.parse(JSON.stringify(evidence.manifest));
      tampered.signed_headers.subject = 'something else';
      const guard = new api.ReplayGuard({ persist: false });
      const verdict = api.verifyEvidence(tampered, { replayGuard: guard, now: NOW });
      assert.strictEqual(verdict.ok, false);
      const digest = verdict.checks.find((entry) => entry.name === 'headers-sha256');
      assert.ok(digest && digest.ok === false, 'tampering the signed block was not detected');
      return 'headers-sha256 mismatch';
    });

    /* ---------------------------------------------------------------- *
     * The self-describing package (PROTOCOL.md §12)
     * ---------------------------------------------------------------- */

    const pkg = api.buildEvidencePackage(evidence, {
      bodyFilename: 'message.txt',
      pgpFingerprint: 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678',
    });

    check('the package explains itself without the codebase', () => {
      assert.deepStrictEqual(Object.keys(pkg), [
        'package',
        'standard',
        'version',
        'generated_at',
        'algorithms',
        'evidence',
        'provenance',
        'signed_headers',
        'files',
        'signature',
        'timestamp',
        'verify',
      ]);
      assert.strictEqual(pkg.package, 'PasevSU_Evidence_Package');
      assert.strictEqual(pkg.standard, 'PSEMP');
      assert.strictEqual(pkg.verify.length, 7);
      assert.ok(pkg.verify.some((line) => /nonce/.test(line)), 'the package never tells the reader about replay');
      return `${pkg.files.length} files, ${pkg.verify.length} verification steps`;
    });

    check('every hash in the package is copied, never re-invented', () => {
      const byRole = new Map(pkg.files.map((file) => [file.role, file]));
      assert.strictEqual(byRole.get('manifest').sha256, evidence.manifestSha256);
      assert.strictEqual(byRole.get('body').sha256, evidence.manifest.message_sha256);
      assert.strictEqual(byRole.get('attachment').sha256, evidence.manifest.attachments[0].sha256);
      assert.strictEqual(pkg.evidence.merkle_root, evidence.merkleRoot);
      assert.strictEqual(pkg.evidence.nonce, FIXED.nonce);
      assert.strictEqual(pkg.evidence.sequence, FIXED.sequence);
      assert.strictEqual(pkg.evidence.recipient, FIXED.to[0]);
      assert.strictEqual(pkg.signed_headers.headers_sha256, evidence.signedHeaders.headers_sha256);
      return 'manifest + body + attachment digests agree with the manifest';
    });

    check('an absent signature or proof is reported absent, not faked', () => {
      assert.strictEqual(pkg.signature.detached.present, false);
      assert.strictEqual(pkg.signature.detached.sha256, null);
      assert.strictEqual(pkg.timestamp.proof.present, false);
      assert.strictEqual(pkg.timestamp.proof.sha256, null);
      assert.match(pkg.signature.note, /cannot run gpg/);
      assert.match(pkg.timestamp.note, /cannot run ots/);
      return 'honest about what this layer cannot do';
    });

    check('the package round-trips through JSON unchanged', () => {
      const text = api.serializePackage(pkg);
      assert.deepStrictEqual(JSON.parse(text), JSON.parse(JSON.stringify(pkg)));
      assert.ok(text.startsWith('{\n  "package": "PasevSU_Evidence_Package"'), 'the shape is not stable');
      return `${text.length} bytes`;
    });

    check('writing the package produces a readable file', () => {
      const target = path.join(dir, api.PACKAGE_FILENAME);
      const written = api.writeEvidencePackage(target, evidence);
      assert.strictEqual(written, target);
      const text = fs.readFileSync(written, 'utf8');
      assert.ok(text.endsWith('\n'), 'the file must end with a newline');
      assert.ok(!text.includes('\r'), 'the file carries CRLF');
      const parsed = JSON.parse(text);
      assert.strictEqual(parsed.evidence.evidence_id, FIXED.evidenceId);
      return path.basename(target);
    });

    check('a real sidecar is digested into the package', () => {
      const manifestPath = path.join(dir, 'PasevSU_Manifest.json');
      fs.writeFileSync(manifestPath, evidence.manifestText, 'utf8');
      fs.writeFileSync(`${manifestPath}.asc`, '-----BEGIN PGP SIGNATURE-----\n', 'utf8');
      const signed = api.buildEvidencePackage(evidence, { manifestPath });
      assert.strictEqual(signed.signature.detached.present, true);
      assert.strictEqual(
        signed.signature.detached.sha256,
        api.sha256Hex(Buffer.from('-----BEGIN PGP SIGNATURE-----\n'))
      );
      assert.strictEqual(signed.timestamp.proof.present, false, 'an .ots that does not exist must not appear');
      return 'the .asc is named by its own digest';
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('replay-package: OK');
}

main().catch((error) => {
  console.error('replay-package: FAILED');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
