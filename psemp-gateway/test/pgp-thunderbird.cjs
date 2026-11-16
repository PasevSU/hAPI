#!/usr/bin/env node
/*
 * PSEMP + Thunderbird OpenPGP test.
 *
 * Thunderbird signs outgoing mail with the key configured in the account, and a
 * MailExtension cannot read that keyring. The useful move is therefore to read the
 * signer out of the signature that is already on the message.
 *
 * The fixtures below are hand-built OpenPGP v4 signature packets, so this test
 * needs no gpg binary, no keyring and no network: it proves the packet parser and
 * every layer above it, including the fingerprint that ends up in
 * X-PasevSU-PGP-Fingerprint when the sender left the claim empty.
 *
 *   node psemp-gateway/test/pgp-thunderbird.cjs
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = require('../api.js');

const FINGERPRINT = 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678';
const KEY_ID = FINGERPRINT.slice(-16);

/** A v4 signature packet carrying issuer fingerprint (type 33) and key ID (type 16). */
function signaturePacket() {
  const fingerprint = Buffer.from(FINGERPRINT, 'hex');
  const keyId = Buffer.from(KEY_ID, 'hex');

  const issuerFingerprint = Buffer.concat([
    Buffer.from([22, 0x21, 0x04]), // length 22, type 33, fingerprint version 4
    fingerprint,
  ]);
  const created = Buffer.from([5, 0x02, 0x69, 0x00, 0x00, 0x00]); // length 5, type 2, time
  const hashed = Buffer.concat([created, issuerFingerprint]);
  const unhashed = Buffer.concat([Buffer.from([9, 0x10]), keyId]); // length 9, type 16

  const hashedLength = Buffer.alloc(2);
  hashedLength.writeUInt16BE(hashed.length, 0);
  const unhashedLength = Buffer.alloc(2);
  unhashedLength.writeUInt16BE(unhashed.length, 0);

  const body = Buffer.concat([
    Buffer.from([0x04, 0x01, 0x01, 0x08]), // v4, canonical text, RSA, SHA-256
    hashedLength,
    hashed,
    unhashedLength,
    unhashed,
    Buffer.from([0x00, 0x00]), // left 16 bits of the signed hash
  ]);

  return Buffer.concat([Buffer.from([0xc2, body.length]), body]); // new-format packet, tag 2
}

function armor(packet) {
  const base64 = packet.toString('base64').replace(/(.{64})/g, '$1\n').trimEnd();
  return [
    '-----BEGIN PGP SIGNATURE-----',
    '',
    base64,
    '=AbCd',
    '-----END PGP SIGNATURE-----',
  ].join('\n');
}

function multipartSigned(packet) {
  const boundary = 'psemp-test-boundary';
  return [
    'From: alice@example.org',
    'To: bob@example.org',
    'Subject: signed evidence',
    'Content-Type: multipart/signed; micalg=pgp-sha256;',
    ` protocol="application/pgp-signature"; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Signed body.',
    `--${boundary}`,
    'Content-Type: application/pgp-signature; name="signature.asc"',
    '',
    packet.toString('base64').replace(/(.{64})/g, '$1\n').trimEnd(),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

function clearsigned(packet) {
  return [
    '-----BEGIN PGP SIGNED MESSAGE-----',
    'Hash: SHA256',
    '',
    'Inline signed body.',
    armor(packet),
    '',
  ].join('\n');
}

function check(name, fn) {
  const detail = fn();
  console.log(`  ok  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const packet = signaturePacket();
  const armoredBlock = armor(packet);

  console.log('pgp-thunderbird:');

  check('parser-reads-issuer', () => {
    const [signature] = api.parseOpenPgpSignatures(packet);
    assert.strictEqual(signature.version, 4);
    assert.strictEqual(signature.sigType, 1);
    assert.strictEqual(signature.issuerFingerprint, FINGERPRINT);
    assert.strictEqual(signature.issuerKeyId, KEY_ID);
    return FINGERPRINT.slice(0, 16);
  });

  check('parser-accepts-armor', () => {
    const [signature] = api.parseOpenPgpSignatures(armoredBlock);
    assert.strictEqual(signature.issuerFingerprint, FINGERPRINT);
    return 'armored block decoded';
  });

  check('parser-rejects-junk', () => {
    assert.deepStrictEqual(api.parseOpenPgpSignatures(Buffer.from('not a signature', 'utf8')), []);
    assert.deepStrictEqual(api.parseOpenPgpSignatures(Buffer.alloc(0)), []);
    return 'no throw, no packets';
  });

  check('detect-formats', () => {
    assert.strictEqual(api.detectPgpSignature(multipartSigned(packet)).format, 'pgp-mime');
    assert.strictEqual(api.detectPgpSignature(clearsigned(packet)).format, 'inline');
    assert.strictEqual(api.detectPgpSignature(`body\n${armoredBlock}`).format, 'armored-only');
    const plain = api.detectPgpSignature('From: a@b.c\n\nunsigned body\n');
    assert.strictEqual(plain.signed, false);
    assert.strictEqual(plain.format, null);
    return 'pgp-mime, inline, armored-only, none';
  });

  check('inspect-signer-from-packet', () => {
    const info = api.pgpInspectMessage(multipartSigned(packet));
    assert.strictEqual(info.signed, true);
    assert.strictEqual(info.signerSource, 'signature-packet');
    assert.strictEqual(info.reason, null);
    assert.strictEqual(info.issuerFingerprint, FINGERPRINT);
    assert.strictEqual(info.issuerKeyId, KEY_ID);
    return 'no gpg required';
  });

  check('inspect-unsigned', () => {
    const info = api.pgpInspectMessage('From: a@b.c\n\nbody\n');
    assert.strictEqual(info.signed, false);
    assert.strictEqual(info.reason, 'NO_SIGNATURE');
    return 'NO_SIGNATURE';
  });

  check('resolved-fingerprint-fills-the-blank', () => {
    assert.strictEqual(api.pgpResolvedFingerprint(multipartSigned(packet)), FINGERPRINT);
    assert.strictEqual(api.pgpResolvedFingerprint(clearsigned(packet)), FINGERPRINT);
    assert.strictEqual(api.pgpResolvedFingerprint('From: a@b.c\n\nbody\n'), '');
    return 'claim can stay empty';
  });

  check('normalize-fingerprint', () => {
    assert.strictEqual(api.normalizeFingerprint(FINGERPRINT.toLowerCase()), FINGERPRINT);
    assert.strictEqual(
      api.normalizeFingerprint('0x A1B2 C3D4 E5F6 0718 293A 4B5C 6D7E 8F90 1234 5678'),
      FINGERPRINT
    );
    assert.strictEqual(api.normalizeFingerprint('a1b2:c3d4:e5f6'), 'A1B2C3D4E5F6');
    assert.strictEqual(api.normalizeFingerprint(null), '');
    assert.strictEqual(api.normalizeFingerprint(undefined), '');
    return '0x, spaces and colons are noise';
  });

  check('cross-check-matches-claim', () => {
    const message = multipartSigned(packet);
    const full = api.pgpCrossCheck(message, { fingerprint: FINGERPRINT });
    assert.ok(full.ok, JSON.stringify(full.checks));
    assert.deepStrictEqual(full.checks.map((entry) => entry.name), [
      'signature-present',
      'fingerprint-match',
    ]);

    const sloppy = api.pgpCrossCheck(message, { fingerprint: `0x${FINGERPRINT.toLowerCase()}` });
    assert.ok(sloppy.ok, 'lowercase or 0x-prefixed claims must still match');

    const shortId = api.pgpCrossCheck(message, { keyId: KEY_ID });
    assert.ok(shortId.ok, 'a short key ID must match the tail of the fingerprint');
    return 'full, 0x-prefixed, short key ID';
  });

  check('cross-check-catches-wrong-claim', () => {
    const wrong = api.pgpCrossCheck(multipartSigned(packet), {
      fingerprint: 'DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF',
    });
    assert.strictEqual(wrong.ok, false);
    assert.strictEqual(wrong.checks[1].name, 'fingerprint-match');
    assert.match(wrong.checks[1].detail, /claim=DEADBEEF.*signer=A1B2C3D4/);

    const unsigned = api.pgpCrossCheck('body only', { fingerprint: FINGERPRINT });
    assert.strictEqual(unsigned.ok, false);
    assert.strictEqual(unsigned.checks[0].name, 'signature-present');

    const silent = api.pgpCrossCheck(multipartSigned(packet), {});
    assert.strictEqual(silent.ok, false);
    assert.strictEqual(silent.checks[1].name, 'fingerprint-claimed');
    return 'mismatch, unsigned, no claim';
  });

  check('evidence-fills-fingerprint-from-signature', () => {
    const fixed = {
      evidenceId: '11111111-2222-4333-8444-555555555555',
      timestamp: '2026-01-01T00:00:00.000Z',
      // Pinned so the manifest is byte-identical apart from the claim under test: the
      // nonce is fresh per message and would otherwise move the manifest hash itself.
      nonce: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sequence: 1,
    };
    const signed = api.computeEvidence({ body: 'hello', signature: multipartSigned(packet), ...fixed });
    const unsigned = api.computeEvidence({ body: 'hello', ...fixed });

    const header = (result, name) => {
      const found = result.headers.find((entry) => entry.name === name);
      return found ? found.value : '';
    };
    assert.strictEqual(header(signed, 'X-PasevSU-PGP-Fingerprint'), FINGERPRINT);
    assert.strictEqual(header(unsigned, 'X-PasevSU-PGP-Fingerprint'), '');
    assert.strictEqual(
      header(signed, 'X-PasevSU-Manifest-SHA256'),
      header(unsigned, 'X-PasevSU-Manifest-SHA256'),
      'the fingerprint is a header claim only; it must never move the manifest hash',
    );
    return 'signer read from the Thunderbird signature';
  });

  check('evidence-config-beats-signature', () => {
    const explicit = api.computeEvidence({
      body: 'hello',
      signature: multipartSigned(packet),
      config: { pgpFingerprint: 'DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF' },
    });
    const claimed = explicit.headers.find((entry) => entry.name === 'X-PasevSU-PGP-Fingerprint');
    assert.strictEqual(claimed.value, 'DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF');
    return 'an explicit claim is not overwritten';
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psemp-pgp-'));
  try {
    const signedFile = path.join(dir, 'signed.eml');
    fs.writeFileSync(signedFile, multipartSigned(packet), 'utf8');
    const unsignedFile = path.join(dir, 'unsigned.eml');
    fs.writeFileSync(unsignedFile, 'From: a@b.c\n\nunsigned body\n', 'utf8');

    check('sign-refuses-to-stack', () => {
      const skipped = api.pgpSign(signedFile);
      assert.strictEqual(skipped.status, 'skipped');
      assert.strictEqual(skipped.reason, 'ALREADY_SIGNED');
      assert.strictEqual(skipped.format, 'pgp-mime');
      assert.ok(!fs.existsSync(`${signedFile}.asc`), 'nothing may be written when skipping');
      return 'Thunderbird signed it already';
    });

    check('sign-force-bypasses-guard', () => {
      let forced;
      try {
        forced = api.pgpSign(signedFile, { force: true });
      } catch (error) {
        forced = { status: 'error', reason: error.message };
      }
      assert.notStrictEqual(forced.reason, 'ALREADY_SIGNED', 'force:true must not skip');
      return `reached the signer (${forced.status})`;
    });

    check('file-input-is-accepted', () => {
      assert.strictEqual(api.pgpResolvedFingerprint({ path: signedFile }), FINGERPRINT);
      assert.strictEqual(api.pgpResolvedFingerprint({ path: unsignedFile }), '');
      return 'evidence can be a path';
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('pgp-thunderbird: OK');
}

main().catch((error) => {
  console.error('pgp-thunderbird: FAILED');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
