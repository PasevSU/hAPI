#!/usr/bin/env node
/*
 * PasevSU Forensic Mail Framework — PSEMP gateway CLI
 *
 * Thin, dependency-free front end over ./api.js:
 *
 *   node psemp-gateway/cli.js status
 *   node psemp-gateway/cli.js hash <sha256|sha512|sha3|sha224|sha384|ripemd160> <file>
 *   node psemp-gateway/cli.js evidence <file> [--name <filename>] [--blake3 <hex>]
 *   node psemp-gateway/cli.js eml <file.eml> [--out <manifest.json>]
 *   node psemp-gateway/cli.js stamp <file> [--out <file.ots>]
 *   node psemp-gateway/cli.js verify <file.ots>
 *   node psemp-gateway/cli.js upgrade <file.ots>
 *   node psemp-gateway/cli.js sign <file> [--key <keyid>] [--out <file.asc>] [--force]
 *   node psemp-gateway/cli.js verify-sig <file> <file.asc>
 *   node psemp-gateway/cli.js seal <manifest.json> [--body <file>] [--attach <name>=<file>]…
 *   node psemp-gateway/cli.js pgp-info <file>
 *   node psemp-gateway/cli.js pgp-check <file> [--fingerprint <hex>]
 *   node psemp-gateway/cli.js package <manifest.json> [--out <file.json>]
 *   node psemp-gateway/cli.js self-test
 *
 * Every command prints JSON and exits non-zero only on a real failure. Missing
 * external tooling (npm `opentimestamps`, a `gpg` binary) is reported as
 * "pending"/"unavailable" rather than an error, matching the MailExtension.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const api = require('./api.js');

const USAGE = `PasevSU PSEMP gateway

  status                                tooling + adapter availability
  hash <algo> <file>                    digest a file (algo: ${Object.keys(api.ALGORITHMS).join('|')})
  evidence <file> [--name n]            headers + manifest for one file body
  eml <file.eml> [--out manifest.json]  evidence-object for an RFC822 message
  stamp-sent [--profile dir] [--file msg] [--out dir]
                                        find the newest Sent message, verify its
                                        evidence chain, then stamp its manifest.
                                        REFUSES to stamp when the chain is broken,
                                        because anchoring broken evidence would make
                                        a defect look proven. Proofs land in
                                        psemp-gateway/data/pending/ (git-ignored).
  stamp <file> [--out proof.ots]        OpenTimestamps proof (degrades to pending)
  verify <proof.ots>                    verify an OpenTimestamps proof
  upgrade <proof.ots>                   upgrade a pending proof
  sign <file> [--key id] [--out .asc] [--force] [--digest SHA512]
                                        detached OpenPGP signature (needs gpg; skipped
                                        when the message is already signed). SHA-512 is
                                        the default digest; the report states the digest
                                        read back out of the signature.
  verify-sig <file> <file.asc>          verify a detached OpenPGP signature
  seal <manifest.json> [--body f] [--attach name=f]…
                                        fill the SHA3-512 slots a MailExtension cannot
                                        compute, then write <manifest>.asc (SHA-512
                                        digest) and <manifest>.ots. Refuses to seal a
                                        manifest whose claimed hashes do not match the
                                        supplied bytes.
  pgp-info <file>                       who signed this message (Thunderbird's key)
  pgp-check <file> [--fingerprint hex]  compare the claim with the actual signer
  package <manifest.json> [--out f] [--body-name n] [--fingerprint hex]
                                        build the self-describing evidence package
                                        (PROTOCOL.md §12) from a manifest
  self-test                             known-answer vectors + parity checks`;

function parseOptions(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    // `--attach` may repeat, one file (or name=file) per occurrence.
    if (key === 'attach') {
      if (!Array.isArray(options.attach)) options.attach = [];
      if (next === undefined || next.startsWith('--')) {
        options.attach.push(true);
      } else {
        options.attach.push(next);
        i += 1;
      }
      continue;
    }
    if (next === undefined || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return { positional, options };
}

function readFileOrFail(file, label) {
  if (!file || file === true) throw new Error(`${label} is required.`);
  const resolved = path.resolve(String(file));
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(argv) {
  const { positional, options } = parseOptions(argv);
  const [command, ...rest] = positional;

  if (!command || command === 'help' || options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  switch (command) {
    case 'status': {
      emit({
        framework: api.FRAMEWORK,
        schemaVersion: api.SCHEMA_VERSION,
        node: process.version,
        openssl: process.versions.openssl,
        headerNames: api.HEADER_NAMES,
        algorithms: Object.keys(api.ALGORITHMS),
        vendoredAlgorithms: api.vendoredAlgorithms(),
        ots: api.otsStatus(),
        pgp: api.pgpStatus(),
        packages: fs.existsSync(api.PACKAGES_DIR),
      });
      return;
    }

    case 'hash': {
      const [algorithm, file] = rest;
      if (!algorithm || !file) throw new Error('Usage: hash <algo> <file>');
      const resolved = readFileOrFail(file, 'file');
      const bytes = fs.readFileSync(resolved);
      emit({
        algorithm,
        file: resolved,
        bytes: bytes.length,
        digest: api.hashHex(algorithm, bytes),
        vendored: api.vendoredAlgorithms().includes(algorithm)
          ? api.vendoredDigest(algorithm, bytes)
          : null,
      });
      return;
    }

    case 'evidence': {
      const [file] = rest;
      const resolved = readFileOrFail(file, 'file');
      const bytes = fs.readFileSync(resolved);
      const evidence = api.computeEvidence({
        body: bytes.toString('utf8'),
        attachments: [],
        config: {},
      });
      const named = {
        ...evidence,
        attachments: [{ filename: String(options.name || path.basename(resolved)), sha256: evidence.bodySha256 }],
      };
      emit({
        file: resolved,
        bytes: bytes.length,
        bodySha256: evidence.bodySha256,
        merkleRoot: evidence.merkleRoot,
        manifestSha256: evidence.manifestSha256,
        headerLines: evidence.headerLines,
        manifest: evidence.manifest,
        fileAttachmentView: named.attachments,
      });
      return;
    }

    case 'eml': {
      const [file] = rest;
      const resolved = readFileOrFail(file, 'file');
      const bytes = fs.readFileSync(resolved);
      const evidence = await api.emailEvidence(bytes, { filename: path.basename(resolved) });
      if (options.out && options.out !== true) {
        const target = path.resolve(String(options.out));
        fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
        emit({
          file: resolved,
          out: target,
          sourceSha256: evidence.source && evidence.source.hashes ? evidence.source.hashes.sha256 : null,
          attachments: Array.isArray(evidence.email && evidence.email.attachments)
            ? evidence.email.attachments.length
            : 0,
          emailMetadataSha256: evidence.hashes ? evidence.hashes.email_metadata_sha256 : null,
        });
        return;
      }
      emit(evidence);
      return;
    }

    case 'stamp-sent': {
      // Only this command needs the profile/MIME readers, so they are loaded here
      // rather than at startup.
      const tools = require('./tools/check-sent.cjs');
      const outDir = options.out && options.out !== true
        ? path.resolve(String(options.out))
        : path.join(__dirname, 'data', 'pending');

      let message;
      let source;
      if (options.file && options.file !== true) {
        source = readFileOrFail(options.file, '--file');
        message = fs.readFileSync(source, 'utf8');
      } else {
        const profile = options.profile && options.profile !== true
          ? path.resolve(String(options.profile))
          : tools.defaultProfile();
        if (!profile) throw new Error('No Thunderbird profile found; pass --profile <dir>.');
        const newest = tools.newestSent(tools.sentFiles(profile));
        if (!newest) throw new Error(`No non-empty Sent message under ${profile}.`);
        message = newest.message;
        source = newest.source;
      }

      // A timestamp turns whatever bytes it covers into "this existed at time T".
      // Doing that for evidence that does not verify would publish a defect as if
      // it were proven, so the proof is only created for an intact chain.
      const inspection = tools.inspectMessage(message);
      if (!inspection.ok) {
        emit({
          status: 'refused',
          reason: 'the evidence chain is broken, so nothing was timestamped',
          source,
          stamped: null,
          failures: inspection.checks
            .filter((check) => !check.ok)
            .map((check) => `${check.name}${check.detail ? `: ${check.detail}` : ''}`),
        });
        process.exitCode = 1;
        return;
      }

      // Re-read the manifest part itself instead of re-serialising the parsed
      // object: its sha256 has to equal X-PasevSU-Manifest-SHA256, and pretty
      // printing the object would silently change that hash.
      const parsed = tools.parseMessage(message);
      const manifestPart = tools
        .collectParts(parsed.headers, parsed.body)
        .find((part) => /^pasevsu_manifest\.json$/i.test(tools.partName(part)));
      if (!manifestPart) throw new Error('The chain verified but the manifest part vanished.');

      const evidenceId = String((inspection.manifest && inspection.manifest.evidence_id) || '');
      const base = (evidenceId || `msg-${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, '_');
      fs.mkdirSync(outDir, { recursive: true });
      const manifestPath = path.join(outDir, `${base}.manifest.json`);
      fs.writeFileSync(manifestPath, manifestPart.bytes);
      // The raw message is kept next to the proof so the chain can be re-checked
      // later; it is what the manifest's hashes point at.
      const messagePath = path.join(outDir, `${base}.eml`);
      fs.writeFileSync(messagePath, message, 'utf8');

      const proof = await api.otsStamp(manifestPath);
      const signed = inspection.manifest && inspection.manifest.signed_headers;
      emit({
        source,
        evidenceId: evidenceId || null,
        messageId: (signed && signed.message_id) || null,
        manifest: manifestPath,
        manifestSha256: api.sha256Hex(manifestPart.bytes),
        message: messagePath,
        messageSha256: api.sha256Hex(Buffer.from(message, 'utf8')),
        // The OTS adapter's own report is passed through untouched: its shape differs
        // between "stamped" and "pending", and inventing keys here would hide that.
        stamp: proof,
      });
      // A missing OTS tool is reported as "pending", never as a failure — the same
      // contract `stamp` follows.
      return;
    }

    case 'stamp': {
      const [file] = rest;
      const resolved = readFileOrFail(file, 'file');
      const result = await api.otsStamp(
        resolved,
        options.out && options.out !== true ? { outputPath: path.resolve(String(options.out)) } : {}
      );
      emit(result);
      if (result.status === 'pending') process.exitCode = 0;
      return;
    }

    case 'verify': {
      const [proof] = rest;
      const resolved = readFileOrFail(proof, 'proof');
      emit(await api.otsVerify(resolved));
      return;
    }

    case 'upgrade': {
      const [proof] = rest;
      const resolved = readFileOrFail(proof, 'proof');
      emit(await api.otsUpgrade(resolved));
      return;
    }

    case 'sign': {
      const [file] = rest;
      const resolved = readFileOrFail(file, 'file');
      const result = api.pgpSign(resolved, {
        keyId: options.key && options.key !== true ? String(options.key) : undefined,
        outputPath: options.out && options.out !== true ? path.resolve(String(options.out)) : undefined,
        force: options.force === true,
        digestAlgo: options.digest && options.digest !== true ? String(options.digest) : undefined,
      });
      emit(result);
      const failed = result.status === 'failed' || result.status === 'unavailable';
      if (failed) process.exitCode = 1;
      return;
    }

    case 'seal': {
      const [manifestFile] = rest;
      const resolved = readFileOrFail(manifestFile, 'manifest');

      const attachments = [];
      for (const entry of [].concat(options.attach || [])) {
        if (entry === true) throw new Error('--attach needs a file path, or name=path to rename it.');
        const raw = String(entry);
        const split = raw.indexOf('=');
        const name = split === -1 ? path.basename(raw) : raw.slice(0, split);
        const file = split === -1 ? raw : raw.slice(split + 1);
        attachments.push({ filename: name, data: fs.readFileSync(readFileOrFail(file, '--attach')) });
      }

      const report = await api.sealManifest(resolved, {
        body: options.body && options.body !== true
          ? fs.readFileSync(readFileOrFail(options.body, '--body'))
          : undefined,
        attachments,
        keyId: options.key && options.key !== true ? String(options.key) : undefined,
        sign: options['no-sign'] !== true,
        stamp: options['no-ots'] !== true,
        blake3: options.blake3 && options.blake3 !== true ? String(options.blake3) : null,
        digestAlgo: options.digest && options.digest !== true ? String(options.digest) : undefined,
      });
      emit(report);
      if (!report.ok) process.exitCode = 1;
      return;
    }

    case 'verify-sig': {
      const [file, signature] = rest;
      const resolvedFile = readFileOrFail(file, 'file');
      const resolvedSignature = readFileOrFail(signature, 'signature');
      emit(api.pgpVerify(resolvedFile, resolvedSignature));
      return;
    }

    case 'pgp-info': {
      const [file] = rest;
      const resolved = readFileOrFail(file, 'file');
      emit(api.pgpInspectMessage({ path: resolved }));
      return;
    }

    case 'pgp-check': {
      const [file] = rest;
      const resolved = readFileOrFail(file, 'file');
      const result = api.pgpCrossCheck(
        { path: resolved },
        { fingerprint: options.fingerprint && options.fingerprint !== true ? String(options.fingerprint) : '' }
      );
      emit(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }

    case 'package': {
      const [manifestFile] = rest;
      const resolved = readFileOrFail(manifestFile, 'manifest');
      const manifest = JSON.parse(fs.readFileSync(resolved, 'utf8'));
      const packageOptions = {
        manifestPath: resolved,
        bodyFilename: options['body-name'] && options['body-name'] !== true
          ? String(options['body-name'])
          : undefined,
        pgpFingerprint: options.fingerprint && options.fingerprint !== true
          ? String(options.fingerprint)
          : undefined,
        canary: options.canary && options.canary !== true ? String(options.canary) : undefined,
      };
      if (options.out && options.out !== true) {
        const written = api.writeEvidencePackage(String(options.out), manifest, packageOptions);
        emit({ ok: true, standard: 'PSEMP', out: written });
      } else {
        emit(api.buildEvidencePackage(manifest, packageOptions));
      }
      return;
    }

    case 'self-test': {
      const result = await api.selfTest();
      emit(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }

    default:
      throw new Error(`Unknown command: ${command}\n\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`psemp-gateway: ${error && error.message ? error.message : error}\n`);
  process.exitCode = 1;
});
