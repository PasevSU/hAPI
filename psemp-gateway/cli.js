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
 *   node psemp-gateway/cli.js sign <file> [--key <keyid>] [--out <file.asc>]
 *   node psemp-gateway/cli.js verify-sig <file> <file.asc>
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
  stamp <file> [--out proof.ots]        OpenTimestamps proof (degrades to pending)
  verify <proof.ots>                    verify an OpenTimestamps proof
  upgrade <proof.ots>                   upgrade a pending proof
  sign <file> [--key id] [--out .asc]   detached OpenPGP signature (needs gpg)
  verify-sig <file> <file.asc>          verify a detached OpenPGP signature
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
      emit(
        api.pgpSign(resolved, {
          keyId: options.key && options.key !== true ? String(options.key) : undefined,
          outputPath: options.out && options.out !== true ? path.resolve(String(options.out)) : undefined,
        })
      );
      return;
    }

    case 'verify-sig': {
      const [file, signature] = rest;
      const resolvedFile = readFileOrFail(file, 'file');
      const resolvedSignature = readFileOrFail(signature, 'signature');
      emit(api.pgpVerify(resolvedFile, resolvedSignature));
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
