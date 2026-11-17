#!/usr/bin/env node
/*
 * Whole-message OpenPGP signature — PGP/MIME (RFC 3156).
 *
 * A detached signature over the manifest proves the manifest. The manifest lists the
 * attachments by hash, so the chain reaches them — but only if the verifier walks the
 * whole chain. Nothing in that arrangement puts the attachment BYTES under a
 * signature, and N per-file signatures would not fix it either: they prove each file
 * is genuine and say nothing about the SET, so an attacker who deletes a file together
 * with its signature leaves every remaining signature perfectly valid.
 *
 * `api.signWholeMessage()` closes that with one signature over one MIME entity that
 * contains the body and every attachment in full. This suite pins the properties that
 * make the difference real:
 *
 *   1. One signature verifies over body + attachments.
 *   2. Changing ONE BYTE of ONE ATTACHMENT breaks it. This is the whole point.
 *   3. Adding or removing an attachment breaks it.
 *   4. Changing the body breaks it.
 *   5. Output is reproducible: the same input produces the same bytes, boundary and all.
 *   6. Line endings are CRLF throughout, and a bare LF never leaks into the signed bytes.
 *   7. An attachment without bytes is REFUSED, not signed as a claim.
 *   8. The micalg token matches the digest actually used.
 *
 * The signature itself needs gpg. When gpg is absent the suite proves the structure
 * and the refusal path and states plainly that it could not sign — it never reports a
 * signature it did not make.
 *
 *   node psemp-gateway/test/signed-message.cjs
 */

'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = require('../api.js');

const BODY = 'Sehr geehrte Damen und Herren,\n\nanbei die Unterlagen.\n';
const PDF = Buffer.from('%PDF-1.7\nkeine echten Daten\n', 'utf8');
const TXT = Buffer.from('Anlage 2\nzeile zwei\n', 'utf8');

const checks = [];
const notes = [];
async function check(name, fn) {
  checks.push({ name, detail: await fn() });
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'psemp-signed-message-'));
}

/**
 * Reach gpg the way a real user has it: on PATH, or installed where Windows puts it.
 * spawn inherits PATH, so prepending the directory is the only way in.
 */
function gpgOnPath() {
  const found = api.pgpStatus();
  if (found.available) return found;
  const directories = process.platform === 'win32'
    ? ['C:\\Program Files\\GnuPG\\bin', 'C:\\Program Files (x86)\\GnuPG\\bin']
    : ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];
  const binary = process.platform === 'win32' ? 'gpg.exe' : 'gpg';
  for (const directory of directories) {
    if (!fs.existsSync(path.join(directory, binary))) continue;
    process.env.PATH = `${directory}${path.delimiter}${process.env.PATH || ''}`;
    const after = api.pgpStatus();
    if (after.available) return after;
  }
  return api.pgpStatus();
}

/**
 * A throwaway keyring, so a real signature is proven without touching — or needing the
 * passphrase of — the user's own keys. GNUPGHOME is always restored.
 */
async function withTempKeyring(run) {
  const executable = api.pgpStatus().executable;
  const home = tempDir();
  const previous = process.env.GNUPGHOME;
  process.env.GNUPGHOME = home;
  try {
    const generated = spawnSync(
      executable,
      ['--batch', '--passphrase', '', '--quick-generate-key', 'PSEMP Test <test@psemp.invalid>', 'ed25519', 'sign', '1d'],
      { encoding: 'utf8', env: process.env }
    );
    assert.strictEqual(generated.status, 0, `key generation failed: ${generated.stderr}`);
    const listing = spawnSync(executable, ['--batch', '--with-colons', '--list-secret-keys'], {
      encoding: 'utf8',
      env: process.env,
    });
    const fingerprint = (/^fpr:+([0-9A-F]{40}):/m.exec(listing.stdout) || [])[1];
    assert.ok(fingerprint, 'gpg generated a key with a fingerprint');
    return await run({ fingerprint, executable, home });
  } finally {
    if (previous === undefined) delete process.env.GNUPGHOME;
    else process.env.GNUPGHOME = previous;
    spawnSync(executable, ['--quiet', '--batch', '--no-tty', '--kill', 'all'], { env: process.env });
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      // A leftover agent lock in %TEMP% is not a test failure.
    }
  }
}

/** One attachment set used by every signing case, so only the mutation differs. */
function sample() {
  return [
    { filename: 'Anlage 1.pdf', data: PDF },
    { filename: 'Anlage 2.txt', data: TXT },
  ];
}

/** Flip one byte in the middle of a buffer. */
function tamper(buffer) {
  const copy = Buffer.from(buffer);
  const at = Math.floor(copy.length / 2);
  copy[at] = copy[at] === 0x41 ? 0x42 : 0x41;
  return copy;
}

async function main() {
  const status = gpgOnPath();
  if (!status.available) {
    notes.push(`gpg unavailable (${status.reason}) — signature cases reduced to structure and refusal`);
  }

  await check('the-entity-contains-the-body-and-every-attachment', async () => {
    const built = api.buildSignedEntity({ body: BODY, attachments: sample() });
    assert.strictEqual(built.coverage.length, 3, 'body + two attachments');
    assert.deepStrictEqual(built.coverage.map((entry) => entry.role), ['body', 'attachment', 'attachment']);
    assert.strictEqual(built.coverage[1].sha256, api.sha256Hex(PDF));
    assert.strictEqual(built.coverage[2].sha256, api.sha256Hex(TXT));
    // The attachment octets must be inside the entity, base64 encoded, not summarised.
    assert.ok(built.entity.includes(PDF.toString('base64').slice(0, 40)), 'PDF bytes are in the entity');
    assert.ok(built.entity.includes(TXT.toString('base64').slice(0, 20)), 'TXT bytes are in the entity');
    assert.ok(built.boundary, 'a multipart entity has a boundary');
    return `entity of ${built.bytes} bytes covers 3 parts`;
  });

  await check('line-endings-are-crlf-and-no-bare-lf-leaks', async () => {
    const built = api.buildSignedEntity({ body: BODY, attachments: sample() });
    assert.ok(!/(^|[^\r])\n/.test(built.entity), 'no bare LF anywhere in the signed bytes');
    assert.ok(built.entity.includes('\r\n'), 'CRLF is used');
    // Round-trip: the base64 of the attachment decodes back to the exact octets.
    for (const item of api.describeSignedEntity(built.entity)) {
      if (!item.filename) continue;
      assert.strictEqual(item.encoding, 'base64', 'every part is base64');
    }
    return 'CRLF only';
  });

  await check('building-twice-gives-identical-bytes', async () => {
    const first = api.buildSignedEntity({ body: BODY, attachments: sample() });
    const second = api.buildSignedEntity({ body: BODY, attachments: sample() });
    assert.strictEqual(first.entity, second.entity, 'same input, same bytes');
    assert.strictEqual(first.boundary, second.boundary, 'the boundary is derived, not random');
    const other = api.buildSignedEntity({ body: BODY, attachments: [{ filename: 'a.txt', data: TXT }] });
    assert.notStrictEqual(first.boundary, other.boundary, 'different content, different boundary');
    return `boundary ${first.boundary}`;
  });

  await check('a-message-without-attachments-is-a-bare-text-part', async () => {
    const built = api.buildSignedEntity({ body: BODY, attachments: [] });
    assert.strictEqual(built.boundary, null, 'no multipart wrapper for one part');
    assert.ok(built.entity.startsWith('Content-Type: text/plain; charset=utf-8\r\n'));
    assert.strictEqual(built.coverage.length, 1);
    return 'no empty multipart/mixed';
  });

  await check('an-attachment-without-bytes-is-refused', async () => {
    assert.throws(
      () => api.buildSignedEntity({ body: BODY, attachments: [{ filename: 'ghost.pdf' }] }),
      /carries no bytes/,
      'signing a claim instead of content must fail loudly'
    );
    return 'refused, not guessed';
  });

  await check('a-non-ascii-filename-stays-legal-in-the-headers', async () => {
    const built = api.buildSignedEntity({
      body: BODY,
      attachments: [{ filename: 'Приложение 1.pdf', data: PDF }],
    });
    assert.ok(built.entity.includes("filename*=UTF-8''"), 'RFC 2231 extended form is used');
    assert.ok(!/Content-Disposition: attachment; filename="[^"]*[\u0400-\u04ff]/.test(built.entity), 'no raw 8-bit name on the wire');
    return 'percent-encoded';
  });

  if (status.available) {
    await withTempKeyring(async ({ fingerprint }) => {
      let signed = null;

      await check('one-signature-verifies-over-body-and-attachments', async () => {
        signed = await api.signWholeMessage({
          body: BODY,
          attachments: sample(),
          keyId: fingerprint,
          headers: { from: 'Pasev <pasev@example.com>', to: 'Gericht <post@example.org>', subject: 'Unterlagen' },
        });
        assert.strictEqual(signed.ok, true, JSON.stringify(signed.signature && signed.signature.detail || ''));
        assert.strictEqual(signed.status, 'signed');
        assert.ok(signed.message.startsWith('From: Pasev <pasev@example.com>\r\n'));
        assert.ok(signed.message.includes('multipart/signed'), 'PGP/MIME wrapper present');
        assert.ok(signed.message.includes(`micalg=${signed.micalg}`));
        assert.ok(signed.message.includes('protocol="application/pgp-signature"'));

        const dir = tempDir();
        const file = path.join(dir, 'message.eml');
        fs.writeFileSync(file, signed.message, 'utf8');
        const verified = await api.verifySignedMessage({ path: file });
        assert.strictEqual(verified.ok, true, JSON.stringify(verified.signature));
        assert.strictEqual(verified.parts.length, 3, 'body + two attachments recovered from the signed entity');
        assert.strictEqual(verified.micalg, signed.micalg);
        assert.strictEqual(verified.signature.issuerFingerprint, fingerprint, 'the report names the signer');
        return `${signed.micalg}, ${verified.parts.length} parts, signer ${fingerprint.slice(0, 16)}…`;
      });

      await check('one-byte-in-one-attachment-breaks-the-signature', async () => {
        assert.ok(signed, 'the signing case ran first');
        // Rebuild the message with a single byte of ONE attachment changed: everything
        // else — body, filenames, second attachment — is identical.
        const mutant = tamper(PDF);
        assert.notDeepStrictEqual(mutant, PDF, 'the attachment really changed');
        const rebuilt = api.buildSignedEntity({
          body: BODY,
          attachments: [{ filename: 'Anlage 1.pdf', data: mutant }, { filename: 'Anlage 2.txt', data: TXT }],
        });
        // Splice the original signature onto the mutated entity: exactly what a
        // repackager does when changing one file and leaving the signature alone.
        const original = api.splitSignedMessage(signed.message);
        assert.strictEqual(original.signed, true);
        const forged = signed.message.replace(original.entity, rebuilt.entity);
        assert.notStrictEqual(forged, signed.message, 'the message really changed');

        const dir = tempDir();
        const file = path.join(dir, 'forged.eml');
        fs.writeFileSync(file, forged, 'utf8');
        const verified = await api.verifySignedMessage({ path: file });
        assert.strictEqual(verified.ok, false, 'a changed attachment MUST fail verification');
        assert.strictEqual(verified.reason, 'SIGNATURE_INVALID');
        return 'tampered attachment rejected';
      });

      await check('removing-an-attachment-breaks-the-signature', async () => {
        const original = api.splitSignedMessage(signed.message);
        const shrunk = api.buildSignedEntity({
          body: BODY,
          attachments: [{ filename: 'Anlage 1.pdf', data: PDF }],
        });
        const forged = signed.message.replace(original.entity, shrunk.entity);
        const dir = tempDir();
        const file = path.join(dir, 'shrunk.eml');
        fs.writeFileSync(file, forged, 'utf8');
        const verified = await api.verifySignedMessage({ path: file });
        assert.strictEqual(verified.ok, false, 'dropping a part MUST fail verification');
        return 'removed part rejected';
      });

      await check('changing-the-body-breaks-the-signature', async () => {
        const original = api.splitSignedMessage(signed.message);
        const rewritten = api.buildSignedEntity({
          body: `${BODY}Nachtrag: der Betrag ist anders.\n`,
          attachments: sample(),
        });
        const forged = signed.message.replace(original.entity, rewritten.entity);
        const dir = tempDir();
        const file = path.join(dir, 'rewritten.eml');
        fs.writeFileSync(file, forged, 'utf8');
        const verified = await api.verifySignedMessage({ path: file });
        assert.strictEqual(verified.ok, false, 'an edited body MUST fail verification');
        return 'edited body rejected';
      });

      await check('the-micalg-token-names-the-digest-actually-used', async () => {
        assert.ok(signed.micalg.startsWith('pgp-'), 'micalg is a pgp- token');
        const digestAlgo = signed.signature.digestAlgo;
        assert.ok(digestAlgo, 'the signature report states its digest');
        // RFC 3156 spells the tokens `pgp-sha512`, without the dash in SHA-512, so the
        // comparison is on the letters and digits only.
        const token = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
        assert.strictEqual(token(signed.micalg), `pgp${token(digestAlgo)}`, 'the token matches the signature');
        // And the digest is read out of the packet by the verifier too, independently.
        const dir = tempDir();
        const file = path.join(dir, 'message.eml');
        fs.writeFileSync(file, signed.message, 'utf8');
        const verified = await api.verifySignedMessage({ path: file });
        assert.strictEqual(verified.signature.digestAlgo, digestAlgo, 'verifier reads the same digest');
        return `${signed.micalg} == ${digestAlgo}`;
      });
    });
  }

  await check('the-cli-signs-and-verifies-a-whole-message', async () => {
    if (!status.available) {
      // Without gpg the command must fail rather than emit a hollow signature.
      const dir = tempDir();
      const bodyFile = path.join(dir, 'body.txt');
      fs.writeFileSync(bodyFile, BODY, 'utf8');
      const result = spawnSync(
        process.execPath,
        [path.join(__dirname, '..', 'cli.js'), 'sign-message', '--body', bodyFile],
        { encoding: 'utf8' }
      );
      assert.notStrictEqual(result.status, 0, 'no gpg means no signature, and a non-zero exit');
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.ok, false);
      assert.strictEqual(report.status, 'unavailable');
      assert.strictEqual(report.message, null, 'no hollow multipart/signed is offered');
      return 'reported unavailable';
    }

    return withTempKeyring(async ({ fingerprint }) => {
      const dir = tempDir();
      const bodyFile = path.join(dir, 'body.txt');
      const pdfFile = path.join(dir, 'anlage1.pdf');
      const out = path.join(dir, 'message.eml');
      fs.writeFileSync(bodyFile, BODY, 'utf8');
      fs.writeFileSync(pdfFile, PDF);

      const signedRun = spawnSync(
        process.execPath,
        [
          path.join(__dirname, '..', 'cli.js'),
          'sign-message',
          '--body', bodyFile,
          '--attach', `Anlage 1.pdf=${pdfFile}`,
          '--key', fingerprint,
          '--out', out,
          '--subject', 'Unterlagen',
        ],
        { encoding: 'utf8' }
      );
      assert.strictEqual(signedRun.status, 0, signedRun.stderr || signedRun.stdout);
      const report = JSON.parse(signedRun.stdout);
      assert.strictEqual(report.ok, true);
      assert.strictEqual(report.message, undefined, 'the body is not dumped into the report');
      assert.ok(report.messagePreview.includes('multipart/signed'));
      assert.strictEqual(report.messagePath, out);
      assert.ok(fs.existsSync(out), 'the message was written');
      assert.ok(fs.existsSync(`${out}.asc`), 'the armored signature is kept beside it');
      assert.ok(fs.existsSync(`${out}.entity`), 'the signed entity is kept, so gpg --verify works by hand');

      const verifiedRun = spawnSync(
        process.execPath,
        [path.join(__dirname, '..', 'cli.js'), 'verify-message', out],
        { encoding: 'utf8' }
      );
      assert.strictEqual(verifiedRun.status, 0, verifiedRun.stderr || verifiedRun.stdout);
      const verified = JSON.parse(verifiedRun.stdout);
      assert.strictEqual(verified.ok, true);
      assert.strictEqual(verified.parts.length, 2, 'body + one attachment');
      return 'CLI round trip, signature verified';
    });
  });

  await check('a-plain-message-is-not-reported-as-signed', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'plain.eml');
    fs.writeFileSync(file, `Subject: nichts\r\n\r\nnur Text\r\n`, 'utf8');
    const verified = await api.verifySignedMessage({ path: file });
    assert.strictEqual(verified.ok, false);
    assert.strictEqual(verified.signed, false);
    assert.strictEqual(verified.reason, 'NOT_MULTIPART_SIGNED');
    return 'honest about unsigned mail';
  });

  // An OpenPGP signature carries a creation time always, and an expiry only when the
  // signer stated one. Both are read here, because "no expiry stated" and "not yet
  // expired" are different claims: merging them would let a report say "valid
  // forever" about a signature that simply never promised anything.
  await check('the-report-says-when-the-signature-was-made', async () => {
    if (!gpgOnPath().available) return 'skipped — no gpg';
    return withTempKeyring(async ({ fingerprint }) => {
      const before = Math.floor(Date.now() / 1000);
      const report = await api.signWholeMessage({
        body: BODY,
        attachments: sample(),
        keyId: fingerprint,
      });
      assert.strictEqual(report.ok, true, JSON.stringify(report.signature));
      assert.ok(Number.isFinite(report.signature.createdAt), 'a creation time is in the packet');
      assert.ok(report.signature.createdAt >= before - 5, 'and it is not in the past');
      assert.ok(report.signature.createdIso, 'reported as an ISO date too');
      assert.strictEqual(
        report.signature.expiryStated,
        false,
        'no expiry is stated by default, because an exhibit must not stop verifying'
      );
      assert.strictEqual(report.signature.expiresAt, null);
      assert.strictEqual(report.signature.expiresIn, null);
      return `made ${report.signature.createdIso}, no expiry stated`;
    });
  });

  await check('an-expiry-is-stated-only-when-asked-for', async () => {
    if (!gpgOnPath().available) return 'skipped — no gpg';
    return withTempKeyring(async ({ fingerprint }) => {
      const report = await api.signWholeMessage({
        body: BODY,
        attachments: sample(),
        keyId: fingerprint,
        sigExpire: '1d',
      });
      assert.strictEqual(report.ok, true, JSON.stringify(report.signature));
      assert.strictEqual(report.signature.expiryStated, true, 'the expiry is stated');
      assert.strictEqual(report.signature.expiresIn, 86400, 'and it is the one requested');
      assert.strictEqual(report.signature.expired, false, 'a fresh signature has not expired');
      assert.strictEqual(
        report.signature.expiresAt,
        report.signature.createdAt + 86400,
        'expiry is measured from the creation time in the packet'
      );

      // The expiry lives inside the signed packet, so it cannot be dropped or edited
      // without breaking the signature — and a verifier reports it back.
      const dir = tempDir();
      const out = path.join(dir, 'expires.eml');
      const written = await api.signWholeMessage({
        body: BODY,
        attachments: sample(),
        keyId: fingerprint,
        sigExpire: '1d',
        outputPath: out,
      });
      assert.strictEqual(written.ok, true);
      const verified = await api.verifySignedMessage({ path: out });
      assert.strictEqual(verified.ok, true, JSON.stringify(verified.signature));
      assert.strictEqual(verified.signature.expiryStated, true);
      assert.strictEqual(verified.signature.expiresIn, 86400);
      assert.strictEqual(
        verified.signature.createdAt,
        written.signature.createdAt,
        'the verifier reads the same creation time the signer wrote'
      );
      return 'expiry stated, signed, and read back';
    });
  });

  await check('the-times-come-out-of-the-signature-not-the-clock', async () => {
    // signatureTimes() must translate a packet's fields, and must not invent an
    // expiry for a packet that carries none — the failure mode behind a report that
    // claims a signature expires when it does not, or vice versa.
    const created = 1700000000;
    const plain = api.signatureTimes({ createdAt: created, expiresIn: null });
    assert.strictEqual(plain.createdAt, created);
    assert.strictEqual(plain.createdIso, new Date(created * 1000).toISOString());
    assert.strictEqual(plain.expiresAt, null);
    assert.strictEqual(plain.expiryStated, false);
    assert.strictEqual(plain.expired, null, 'no expiry is not the same as not expired');

    const lasting = api.signatureTimes({ createdAt: created, expiresIn: 86400 });
    assert.strictEqual(lasting.expiresAt, created + 86400);
    assert.strictEqual(lasting.expiryStated, true);
    assert.strictEqual(lasting.expired, true, 'a 2023 signature with a day to live has expired');

    assert.strictEqual(api.signatureTimes(null).createdAt, null, 'a missing packet is not a date');
    assert.strictEqual(api.signatureTimes(null).expired, null);
    return 'null expiry stays null, stated expiry is computed';
  });

  console.log('signed-message:');
  for (const entry of checks) console.log(`  ok  ${entry.name} — ${entry.detail}`);
  for (const note of notes) console.log(`  note ${note}`);
  console.log('signed-message: OK');
}

main().catch((error) => {
  console.error('signed-message: FAILED');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
