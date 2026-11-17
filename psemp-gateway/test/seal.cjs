#!/usr/bin/env node
/*
 * PSEMP sealing — the step a Thunderbird MailExtension cannot perform.
 *
 * The extension can hash with Web Crypto and attach a manifest, but it cannot run
 * `gpg` or `ots`, and Web Crypto has no SHA3-512. `api.sealManifest()` closes that
 * gap: it fills the slots the extension left null, then writes `<manifest>.asc` and
 * `<manifest>.ots` over the SEALED text.
 *
 * Four properties are worth more than the happy path, so they are what this test
 * actually pins:
 *
 *   1. Filling SHA3-512 must NOT move the Merkle root. The root is built from SHA-256
 *      leaves only; a stronger second digest may never invalidate the chain the
 *      recipient already holds from the message headers.
 *   2. A manifest whose claimed hashes do not match the supplied bytes is REFUSED.
 *      Sealing it would turn a mismatch into a certificate.
 *   3. Sealing is idempotent: the same bytes twice must not re-sign, re-stamp or
 *      rewrite the file.
 *   4. An `.ots` proof is append-only. Proofs over superseded text are moved aside
 *      (`*.superseded`), never overwritten and never left at the live path.
 *
 * Signing and stamping are exercised with whatever tooling is present: gpg is often
 * not on PATH, and a real OpenTimestamps stamp talks to calendar servers, so the
 * default cases pass `sign:false`/`stamp:false` and the degrade path is asserted
 * rather than assumed.
 *
 *   node psemp-gateway/test/seal.cjs
 */

'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = require('../api.js');

const BODY = 'Sehr geehrte Damen und Herren,\n\nanbei die Unterlagen zum Verfahren.\n';
const PDF = Buffer.from('%PDF-1.7\nkeine echten Daten, nur ein Testkoerper\n', 'utf8');
const TXT = Buffer.from('Anlage 2\n', 'utf8');

const checks = [];
async function check(name, fn) {
  checks.push({ name, detail: await fn() });
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'psemp-seal-'));
}

/** The manifest exactly as the MailExtension writes it: SHA3-512/BLAKE3 left null. */
function extensionManifest({ body = BODY, attachments = [] } = {}) {
  const bodyHash = api.sha256Hex(body);
  const entries = attachments.map((item) => ({ filename: item.filename, sha256: api.sha256Hex(item.data) }));
  const leaves = [bodyHash, ...entries.map((entry) => entry.sha256)];
  return api.buildManifest({
    config: {},
    bodyHash,
    attachmentEntries: entries,
    merkle: api.merkleRoot(leaves),
    evidenceId: 'e7c1f0d2-0000-4000-8000-000000000000',
  });
}

/** Write a manifest the way Thunderbird's attachment does: no trailing newline. */
function writeManifest(dir, manifest, name = api.MANIFEST_FILENAME) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, api.serializeManifest(manifest), 'utf8');
  return file;
}

/**
 * Find gpg the way a real user has it: on PATH, or installed where Windows puts it.
 * Prepending the directory is the only way to reach it, because spawn inherits PATH.
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
 * A throwaway keyring, so a real signature can be proven without touching — or
 * needing the passphrase of — the user's own keys. Always restores GNUPGHOME.
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
    // The agent keeps the keyring open; kill it before the directory can go.
    spawnSync(executable, ['--quiet', '--batch', '--no-tty', '--kill', 'all'], { env: process.env });
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      // A leftover agent lock in %TEMP% is not a test failure.
    }
  }
}

async function main() {
  await check('fills-the-sha3-slots-the-extension-cannot-compute', async () => {
    const dir = tempDir();
    const file = writeManifest(dir, extensionManifest({ attachments: [{ filename: 'Anlage 1.pdf', data: PDF }] }));
    const report = await api.sealManifest(file, {
      body: BODY,
      attachments: [{ filename: 'Anlage 1.pdf', data: PDF }],
      sign: false,
      stamp: false,
    });
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.status, 'sealed-partial', 'no signature and no proof yet');
    assert.strictEqual(report.changed, true);

    const sealed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(sealed.message_sha3_512, api.hashHex('sha3-512', BODY));
    assert.match(sealed.message_sha3_512, /^[0-9a-f]{128}$/);
    assert.strictEqual(sealed.attachments[0].sha3_512, api.hashHex('sha3-512', PDF));
    assert.strictEqual(sealed.attachments[0].blake3, null, 'BLAKE3 stays null without an implementation');
    assert.strictEqual(sealed.message_sha256, api.sha256Hex(BODY), 'SHA-256 is untouched');

    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /\n$/, 'the sealed file ends with a newline so gpg and ots are happy');
    assert.strictEqual(report.sealedManifestSha256, api.sha256Hex(text));
    assert.notStrictEqual(
      report.sealedManifestSha256,
      report.claimedManifestSha256,
      'the certificate covers the sealed text, so the two hashes must differ'
    );
    return `${report.filled.length} slots filled`;
  });

  await check('filling-the-slots-does-not-move-the-merkle-root', async () => {
    const dir = tempDir();
    const manifest = extensionManifest({ attachments: [{ filename: 'Anlage 1.pdf', data: PDF }] });
    const before = manifest.merkle_root;
    const file = writeManifest(dir, manifest);
    await api.sealManifest(file, {
      body: BODY,
      attachments: [{ filename: 'Anlage 1.pdf', data: PDF }],
      sign: false,
      stamp: false,
    });
    const sealed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(sealed.merkle_root, before, 'the root the headers carry must still hold');
    // The root the recipient recomputes from the message must still match, and the new
    // SHA3-512 claims must verify rather than fail.
    const verified = api.verifyEvidence(sealed, {
      body: BODY,
      attachments: [{ name: 'Anlage 1.pdf', data: PDF }],
    });
    assert.strictEqual(verified.ok, true, JSON.stringify(verified.checks.filter((c) => !c.ok)));
    assert.ok(verified.checks.some((c) => c.name === 'body-sha3-512'), 'the SHA3 claim is checked');
    return `${before.slice(0, 16)}… held`;
  });

  await check('a-tampered-sha3-claim-is-caught', async () => {
    const dir = tempDir();
    const file = writeManifest(dir, extensionManifest());
    await api.sealManifest(file, { body: BODY, sign: false, stamp: false });
    const sealed = JSON.parse(fs.readFileSync(file, 'utf8'));
    sealed.message_sha3_512 = api.hashHex('sha3-512', 'something else entirely');
    const verified = api.verifyEvidence(sealed, { body: BODY });
    assert.strictEqual(verified.ok, false);
    assert.ok(
      verified.checks.some((entry) => entry.name === 'body-sha3-512' && entry.ok === false),
      'a filled slot that is wrong is worse than an empty one'
    );
    return 'body-sha3-512 fails as designed';
  });

  await check('refuses-to-seal-a-manifest-that-describes-other-bytes', async () => {
    const dir = tempDir();
    const file = writeManifest(dir, extensionManifest());
    const original = fs.readFileSync(file, 'utf8');
    const report = await api.sealManifest(file, {
      body: `${BODY}one more line the manifest never saw\n`,
      sign: false,
      stamp: false,
    });
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.status, 'mismatch');
    assert.strictEqual(report.mismatches[0].target, 'body');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), original, 'a refused seal must not touch the file');
    assert.strictEqual(report.sealedManifestSha256, '', 'nothing was sealed');
    return `refused: ${report.mismatches[0].detail}`;
  });

  await check('refuses-to-seal-a-tampered-attachment', async () => {
    const dir = tempDir();
    const file = writeManifest(dir, extensionManifest({ attachments: [{ filename: 'Anlage 1.pdf', data: PDF }] }));
    const report = await api.sealManifest(file, {
      body: BODY,
      attachments: [{ filename: 'Anlage 1.pdf', data: Buffer.from('different bytes') }],
      sign: false,
      stamp: false,
    });
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.mismatches[0].target, 'Anlage 1.pdf');
    return 'attachment mismatch refused';
  });

  await check('second-run-over-identical-bytes-is-a-no-op', async () => {
    const dir = tempDir();
    const file = writeManifest(dir, extensionManifest({ attachments: [{ filename: 'Anlage 1.pdf', data: PDF }] }));
    const options = {
      body: BODY,
      attachments: [{ filename: 'Anlage 1.pdf', data: PDF }],
      sign: false,
      stamp: false,
    };
    const first = await api.sealManifest(file, options);
    const text = fs.readFileSync(file, 'utf8');
    const second = await api.sealManifest(file, options);
    assert.strictEqual(first.changed, true);
    assert.strictEqual(second.changed, false, 'identical bytes must not rewrite the file');
    assert.deepStrictEqual(second.filled, [], 'nothing left to fill');
    assert.deepStrictEqual(second.confirmed, ['message_sha3_512', 'Anlage 1.pdf:sha3_512'], 'the slots are checked, not skipped');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), text, 'byte-identical after the second run');
    assert.strictEqual(second.supersededProof, null);
    return 'idempotent';
  });

  await check('a-stale-timestamp-proof-is-moved-aside-never-overwritten', async () => {
    const dir = tempDir();
    const file = writeManifest(dir, extensionManifest());
    const stale = `${file}.ots`;
    fs.writeFileSync(stale, 'a proof over text that no longer exists', 'utf8');
    const report = await api.sealManifest(file, { body: BODY, sign: false, stamp: false });
    assert.strictEqual(report.changed, true);
    assert.strictEqual(report.supersededProof, `${stale}.superseded`);
    assert.strictEqual(fs.existsSync(stale), false, 'the live path must not keep a stale proof');
    assert.strictEqual(fs.readFileSync(`${stale}.superseded`, 'utf8'), 'a proof over text that no longer exists');
    return 'kept as .superseded';
  });

  await check('attachments-without-bytes-are-reported-not-guessed', async () => {
    const dir = tempDir();
    const file = writeManifest(
      dir,
      extensionManifest({
        attachments: [
          { filename: 'Anlage 1.pdf', data: PDF },
          { filename: 'Anlage 2.txt', data: TXT },
        ],
      })
    );
    const report = await api.sealManifest(file, {
      body: BODY,
      attachments: [{ filename: 'Anlage 1.pdf', data: PDF }],
      sign: false,
      stamp: false,
    });
    assert.deepStrictEqual(report.unsealedFiles, ['Anlage 2.txt']);
    assert.ok(report.filled.includes('Anlage 1.pdf:sha3_512'));
    const sealed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(sealed.attachments[1].sha3_512, null, 'no bytes, no claim');
    return 'left null and listed';
  });

  await check('accepts-a-buffer-body-the-way-the-cli-reads-it', async () => {
    const dir = tempDir();
    const bodyFile = path.join(dir, 'body.txt');
    fs.writeFileSync(bodyFile, BODY, 'utf8');
    const file = writeManifest(dir, extensionManifest());
    const report = await api.sealManifest(file, { body: fs.readFileSync(bodyFile), sign: false, stamp: false });
    assert.strictEqual(report.ok, true, 'a Buffer and the string it came from hash the same');
    return 'Buffer and string agree';
  });

  await check('the-digest-name-is-the-one-gpg-accepts', async () => {
    // gpg spells digests without punctuation and answers anything else with
    // "selected digest algorithm is invalid". Asking for `SHA-512` therefore produced
    // no signature at all — the manifest shipped unsigned while the code claimed
    // stronger signing. Normalisation, not a weaker claim, is the fix.
    assert.strictEqual(api.normalizeDigestAlgo('SHA-512').name, 'SHA512');
    assert.strictEqual(api.normalizeDigestAlgo('SHA512').name, 'SHA512');
    assert.strictEqual(api.normalizeDigestAlgo('sha-256').name, 'SHA256');
    assert.strictEqual(api.normalizeDigestAlgo(undefined).name, 'SHA512', 'SHA-512 is still the default');
    assert.deepStrictEqual(api.normalizeDigestAlgo('SHA3-512'), { error: 'UNSUPPORTED_DIGEST', requested: 'SHA3-512' });

    const dir = tempDir();
    const file = path.join(dir, 'claim.json');
    fs.writeFileSync(file, '{"framework":"PasevSU"}', 'utf8');
    const refused = api.pgpSign(file, { digestAlgo: 'SHA3-512' });
    assert.strictEqual(refused.status, 'failed');
    assert.strictEqual(refused.reason, 'UNSUPPORTED_DIGEST', 'refused up front, not left to gpg');
    assert.strictEqual(fs.existsSync(`${file}.asc`), false, 'an impossible digest writes nothing');
    return 'SHA-512 normalised; SHA3-512 refused';
  });

  await check('signing-degrades-loudly-when-gpg-is-missing', async () => {
    const gpg = gpgOnPath();
    if (!gpg.available) {
      const dir = tempDir();
      const file = writeManifest(dir, extensionManifest());
      const report = await api.sealManifest(file, { body: BODY, sign: true, stamp: false });
      assert.strictEqual(report.signature.status, 'unavailable', JSON.stringify(report.signature));
      assert.strictEqual(report.ok, true, 'missing gpg must not break sealing');
      assert.strictEqual(report.status, 'sealed-partial');
      assert.strictEqual(report.signaturePath, null, 'nothing is claimed that was not written');
      return `degraded: ${report.signature.reason}`;
    }
    // On a machine with gpg the same contract is proven by hiding it from PATH.
    const previousPath = process.env.PATH;
    const dir = tempDir();
    const file = writeManifest(dir, extensionManifest());
    try {
      process.env.PATH = '';
      const report = await api.sealManifest(file, { body: BODY, sign: true, stamp: false });
      assert.strictEqual(report.signature.status, 'unavailable', JSON.stringify(report.signature));
      assert.strictEqual(report.ok, true);
      assert.strictEqual(report.signaturePath, null);
      assert.strictEqual(fs.existsSync(`${file}.asc`), false);
    } finally {
      process.env.PATH = previousPath;
    }
    return 'an unsigned seal is still a valid certificate';
  });

  await check('a-real-signature-is-produced-and-its-digest-read-back', async () => {
    const gpg = gpgOnPath();
    if (!gpg.available) return 'skipped: no gpg binary to sign with';
    return withTempKeyring(async ({ fingerprint }) => {
      const dir = tempDir();
      const file = writeManifest(dir, extensionManifest({ attachments: [{ filename: 'Anlage 1.pdf', data: PDF }] }));
      const report = await api.sealManifest(file, {
        body: BODY,
        attachments: [{ filename: 'Anlage 1.pdf', data: PDF }],
        stamp: false,
        keyId: fingerprint,
      });
      const signature = report.signature || {};
      assert.strictEqual(signature.status, 'ok', JSON.stringify(signature));
      assert.strictEqual(report.ok, true);
      assert.strictEqual(report.status, 'sealed-partial', 'signed, but stamping was disabled');
      assert.strictEqual(report.signaturePath, `${file}.asc`);
      assert.strictEqual(fs.existsSync(`${file}.asc`), true, 'the .asc exists on disk');

      assert.strictEqual(signature.digestSource, 'gpg --list-packets', 'the digest is read, not assumed');
      assert.strictEqual(signature.digestAlgo, 'SHA-512', 'the strongest digest an OpenPGP packet carries');
      assert.strictEqual(signature.digestRequested, 'SHA512');

      const verified = api.pgpVerify(file, `${file}.asc`);
      assert.strictEqual(verified.verified, true, 'a real detached signature over the sealed text');

      // Sealing again over identical bytes must not re-sign, and must still report the digest.
      const again = await api.sealManifest(file, {
        body: BODY,
        attachments: [{ filename: 'Anlage 1.pdf', data: PDF }],
        stamp: false,
        keyId: fingerprint,
      });
      assert.strictEqual(again.changed, false);
      assert.strictEqual(again.signature.reason, 'ALREADY_SIGNED');
      assert.strictEqual(again.signature.digestAlgo, 'SHA-512', 'the second report also states the truth');
      return `signed and verified with ${signature.digestAlgo} (ed25519)`;
    });
  });

  await check('seal-can-also-sign-the-whole-message', async () => {
    const dir = tempDir();
    const runSeal = async (keyId) => {
      const file = writeManifest(
        dir,
        extensionManifest({ attachments: [{ filename: 'Anlage 1.pdf', data: PDF }] })
      );
      const out = path.join(dir, 'message.eml');
      const report = await api.sealManifest(file, {
        body: BODY,
        attachments: [{ filename: 'Anlage 1.pdf', data: PDF }],
        sign: false,
        stamp: false,
        keyId,
        // Opt-in on purpose: the whole-message signature needs the attachment BYTES,
        // which a caller sealing a manifest it received may not hold.
        signedMessage: { outputPath: out },
      });
      return { report, out };
    };

    if (!api.pgpStatus().available) {
      const { report } = await runSeal();
      assert.strictEqual(report.signature.status, 'skipped');
      assert.ok(report.message, 'the whole-message report is present when it was asked for');
      assert.strictEqual(report.message.status, 'unavailable');
      assert.strictEqual(report.message.message, null, 'no hollow multipart/signed is offered');
      assert.strictEqual(report.ok, false, 'the one thing the caller asked for did not happen');
      return `reported unavailable (${report.message.reason})`;
    }

    return withTempKeyring(async ({ fingerprint }) => {
      const { report, out } = await runSeal(fingerprint);
      assert.strictEqual(report.message.ok, true, JSON.stringify(report.message.signature || report.message.reason));
      assert.strictEqual(report.ok, true, 'a requested message signature that worked is a clean seal');
      assert.ok(report.artifacts.includes(out), 'the message is listed among the artifacts');
      assert.strictEqual(report.message.coverage.length, 2, 'body + the one sealed attachment');
      assert.strictEqual(report.message.coverage[1].sha256, api.sha256Hex(PDF), 'the signed bytes are the sealed bytes');
      const verified = await api.verifySignedMessage({ path: out });
      assert.strictEqual(verified.ok, true, 'the sealed message verifies');
      return `one signature over body + ${report.message.coverage.length - 1} attachment`;
    });
  });

  await check('stamping-is-reported-not-faked', async () => {
    const dir = tempDir();
    const file = writeManifest(dir, extensionManifest());
    const report = await api.sealManifest(file, { body: BODY, sign: false, stamp: false });
    assert.deepStrictEqual(report.timestamp, { status: 'skipped', reason: 'DISABLED' });
    assert.strictEqual(report.proofPath, null, 'no proof is claimed when none was written');
    return 'skipped honestly';
  });

  await check('the-cli-wires-seal-and-repeating-attach', async () => {
    const dir = tempDir();
    const bodyFile = path.join(dir, 'body.txt');
    fs.writeFileSync(bodyFile, BODY, 'utf8');
    const pdfFile = path.join(dir, 'Anlage 1.pdf');
    fs.writeFileSync(pdfFile, PDF);
    const txtFile = path.join(dir, 'raw-name.txt');
    fs.writeFileSync(txtFile, TXT);
    const file = writeManifest(
      dir,
      extensionManifest({
        attachments: [
          { filename: 'Anlage 1.pdf', data: PDF },
          { filename: 'Anlage 2.txt', data: TXT },
        ],
      })
    );
    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, '..', 'cli.js'),
        'seal',
        file,
        '--body',
        bodyFile,
        '--attach',
        pdfFile,
        '--attach',
        `Anlage 2.txt=${txtFile}`,
        '--no-sign',
        '--no-ots',
      ],
      { encoding: 'utf8' }
    );
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.ok, true);
    assert.deepStrictEqual(report.filled, ['message_sha3_512', 'Anlage 1.pdf:sha3_512', 'Anlage 2.txt:sha3_512']);
    const sealed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(sealed.attachments[1].filename, 'Anlage 2.txt', 'name=path renames the file');
    assert.strictEqual(sealed.attachments[1].sha3_512, api.hashHex('sha3-512', TXT));
    return 'CLI filled two attachments';
  });

  console.log('seal:');
  for (const entry of checks) console.log(`  ok  ${entry.name} — ${entry.detail}`);
  console.log('seal: OK');
}

main().catch((error) => {
  console.error('seal: FAILED');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
