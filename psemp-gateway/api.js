/*
 * PasevSU Forensic Mail Framework — PSEMP gateway API
 *
 * Node-side counterpart of the `thunderbird-extension/` MailExtension.
 *
 * The MailExtension can only do Web Crypto work (SHA-256, Merkle, manifest).
 * Real OpenPGP signatures and real OpenTimestamps proofs cannot be produced
 * inside a MailExtension, so the extension writes markers ("pending") and this
 * gateway performs the authoritative work on the composed message.
 *
 * Parity contract: every header name, header order, manifest field order and
 * Merkle step defined here is byte-for-byte the same as the extension's, so a
 * manifest built here verifies a manifest built there and vice versa.
 *
 * Vendored building blocks live in ./packages and are used as-is:
 *   01-core, 06-hash-crypto  -> CryptoJS bridge (cross-check of the native path)
 *   07-ots                   -> OpenTimestamps manager (needs npm opentimestamps)
 *   17-javascript-opentimestamps -> upstream OTS library source
 *   15-openpgpjs             -> upstream OpenPGP.js source (TS, needs a build)
 *   05-forensics/email-evidence-js-core -> EML evidence pipeline
 *
 * No third-party runtime dependency is required for the core path: SHA-256,
 * Merkle root, manifest and header injection run on node:crypto alone.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const PACKAGES_DIR = path.join(__dirname, 'packages');
const MANIFEST_FILENAME = 'PasevSU_Manifest.json';
const FRAMEWORK = 'PasevSU';
const SCHEMA_VERSION = '1.0';

/** Defaults match thunderbird-extension/background.js, except `origin`. */
const DEFAULTS = Object.freeze({
  version: '1.0',
  framework: 'Forensic-Mail',
  origin: 'PSEMP-Gateway',
  organization: 'PasevSU',
  pgpFingerprint: '',
  enableOts: false,
});

/** Header names, in injection order. `X-PasevSU-OTS` is a marker during compose. */
const HEADER_NAMES = Object.freeze({
  version: 'X-PasevSU-Version',
  framework: 'X-PasevSU-Framework',
  origin: 'X-PasevSU-Origin',
  organization: 'X-PasevSU-Organization',
  evidenceId: 'X-PasevSU-Evidence-ID',
  bodySha256: 'X-PasevSU-Body-SHA256',
  attachmentsSha256: 'X-PasevSU-Attachments-SHA256',
  manifestSha256: 'X-PasevSU-Manifest-SHA256',
  merkleRoot: 'X-PasevSU-Merkle-Root',
  pgpFingerprint: 'X-PasevSU-PGP-Fingerprint',
  ots: 'X-PasevSU-OTS',
});

/* ------------------------------------------------------------------ *
 * Hashing
 * ------------------------------------------------------------------ */

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('Expected a string, Buffer, ArrayBuffer or typed array.');
}

/** Node digest names accepted by {@link hashHex}. */
const ALGORITHMS = Object.freeze({
  sha256: 'sha256',
  sha384: 'sha384',
  sha512: 'sha512',
  sha224: 'sha224',
  sha3: 'sha3-512',
  'sha3-256': 'sha3-256',
  'sha3-512': 'sha3-512',
  ripemd160: 'ripemd160',
});

/**
 * Hash arbitrary data and return a lowercase hex digest.
 * @param {string} algorithm One of {@link ALGORITHMS}.
 * @param {string|Buffer|Uint8Array|ArrayBuffer} data
 * @returns {string}
 */
function hashHex(algorithm, data) {
  const key = String(algorithm).toLowerCase();
  const nodeName = ALGORITHMS[key];
  if (!nodeName) {
    throw new Error(
      `Unsupported algorithm "${algorithm}". Use one of: ${Object.keys(ALGORITHMS).join(', ')}.`
    );
  }
  return crypto.createHash(nodeName).update(toBuffer(data)).digest('hex');
}

/** SHA-256 as lowercase hex. The primary digest of the framework. */
function sha256Hex(data) {
  return hashHex('sha256', data);
}

/* ------------------------------------------------------------------ *
 * Vendored CryptoJS bridge (01-core + 06-hash-crypto)
 *
 * Used to prove the vendored hash group loads and agrees with node:crypto.
 * Loading is done in a vm context exactly like packages/06-hash-crypto/cli.js.
 * ------------------------------------------------------------------ */

const VENDORED_SOURCES = Object.freeze({
  md5: 'md5.js',
  sha1: 'sha1.js',
  sha224: 'sha224.js',
  sha256: 'sha256.js',
  sha384: 'sha384.js',
  sha512: 'sha512.js',
  sha3: 'sha3.js',
  ripemd160: 'ripemd160.js',
});

/** Algorithms that need `x64-core.js` loaded first. */
const NEEDS_X64 = new Set(['sha384', 'sha512', 'sha3']);

/** Algorithms that need another algorithm file loaded first. */
const VENDORED_DEPS = { sha224: ['sha256'], sha384: ['sha512'] };

const vendoredCache = new Map();

function loadVendoredCryptoJs(algorithm) {
  if (vendoredCache.has(algorithm)) return vendoredCache.get(algorithm);
  if (!VENDORED_SOURCES[algorithm]) {
    throw new Error(
      `Vendored CryptoJS has no "${algorithm}". Available: ${Object.keys(VENDORED_SOURCES).join(', ')}.`
    );
  }
  const context = vm.createContext({ Math, Uint32Array });
  context.crypto = crypto.webcrypto;
  const run = (file) => vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

  run(path.join(PACKAGES_DIR, '01-core', 'core.js'));
  if (NEEDS_X64.has(algorithm)) run(path.join(PACKAGES_DIR, '06-hash-crypto', 'x64-core.js'));
  for (const dep of VENDORED_DEPS[algorithm] || []) {
    run(path.join(PACKAGES_DIR, '06-hash-crypto', VENDORED_SOURCES[dep]));
  }
  run(path.join(PACKAGES_DIR, '06-hash-crypto', VENDORED_SOURCES[algorithm]));

  const CryptoJS = context.CryptoJS;
  if (!CryptoJS) throw new Error('Vendored core.js did not expose CryptoJS.');
  vendoredCache.set(algorithm, CryptoJS);
  return CryptoJS;
}

/**
 * Hash with the vendored CryptoJS group instead of node:crypto.
 * @param {string} algorithm md5|sha1|sha224|sha256|sha384|sha512|sha3|ripemd160
 * @param {string|Buffer|Uint8Array} data
 * @returns {string} lowercase hex
 */
function vendoredDigest(algorithm, data) {
  const key = String(algorithm).toLowerCase();
  const CryptoJS = loadVendoredCryptoJs(key);
  const helper = CryptoJS[key.toUpperCase()];
  if (typeof helper !== 'function') {
    throw new Error(`Vendored CryptoJS did not expose ${key.toUpperCase()}.`);
  }
  let message;
  if (typeof data === 'string') {
    message = data;
  } else {
    const bytes = toBuffer(data);
    const words = [];
    for (let i = 0; i < bytes.length; i += 1) {
      words[i >>> 2] = (words[i >>> 2] || 0) | (bytes[i] << ((3 - (i % 4)) * 8));
    }
    message = CryptoJS.lib.WordArray.create(words, bytes.length);
  }
  return helper(message).toString();
}

/** Algorithm names the vendored hash group exposes. */
function vendoredAlgorithms() {
  return Object.keys(VENDORED_SOURCES);
}

/**
 * Keccak-512 — the pre-standard SHA-3 that the vendored CryptoJS group ships as
 * `CryptoJS.SHA3`. This is NOT NIST SHA3-512: the padding differs, so the two
 * produce different digests. Use {@link hashHex}`('sha3', …)` for NIST SHA3-512
 * and this only when a Keccak-512 digest is explicitly required (legacy data).
 */
function keccak512Hex(data) {
  return vendoredDigest('sha3', data);
}

/* ------------------------------------------------------------------ *
 * Merkle root — identical to the extension's implementation
 * ------------------------------------------------------------------ */

/**
 * Merkle root over hex leaf digests.
 *
 * The leaves are sorted as hex strings ascending. A single leaf is the root.
 * Otherwise adjacent pairs are concatenated as UTF-8 text and SHA-256'd, the
 * last odd leaf is duplicated, and the level is repeated until one remains.
 *
 * @param {string[]} leaves hex digests
 * @returns {string} hex root, or '' when there are no leaves
 */
function merkleRoot(leaves) {
  const sorted = [...(leaves || [])].filter((leaf) => typeof leaf === 'string' && leaf).sort();
  if (sorted.length === 0) return '';
  let level = sorted;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      next.push(sha256Hex(left + right));
    }
    level = next;
  }
  return level[0];
}

/* ------------------------------------------------------------------ *
 * Header sanitation and tokens
 * ------------------------------------------------------------------ */

/** Strip CR/LF so a config value can never inject a bogus header line. */
function sanitizeHeaderValue(value) {
  return String(value == null ? '' : value)
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/** Filename safe for the comma-separated `name=hash` header list. */
function headerToken(value) {
  return sanitizeHeaderValue(value).replace(/[,=]/g, '_');
}

/* ------------------------------------------------------------------ *
 * Manifest
 * ------------------------------------------------------------------ */

/** Normalise caller-supplied config over {@link DEFAULTS}. */
function resolveConfig(config) {
  const merged = Object.assign({}, DEFAULTS, config || {});
  merged.version = sanitizeHeaderValue(merged.version) || DEFAULTS.version;
  merged.framework = sanitizeHeaderValue(merged.framework) || DEFAULTS.framework;
  merged.origin = sanitizeHeaderValue(merged.origin) || DEFAULTS.origin;
  merged.organization = sanitizeHeaderValue(merged.organization) || DEFAULTS.organization;
  merged.pgpFingerprint = sanitizeHeaderValue(merged.pgpFingerprint);
  merged.enableOts = merged.enableOts === true || merged.enableOts === 'true';
  return merged;
}

/**
 * Build the manifest object.
 *
 * Field order is part of the contract: `JSON.stringify(manifest, null, 2)` over
 * this exact key order is what gets hashed into `X-PasevSU-Manifest-SHA256`.
 *
 * The manifest is intentionally NOT part of the Merkle set — that covers the
 * original body plus the original attachments only.
 */
function buildManifest({
  config,
  bodyHash,
  attachmentEntries = [],
  merkle = '',
  evidenceId,
  timestamp,
  blake3 = null,
} = {}) {
  const resolved = resolveConfig(config);
  return {
    framework: FRAMEWORK,
    version: resolved.version,
    message_sha256: bodyHash,
    attachments: attachmentEntries.map((entry) => ({
      filename: entry.filename,
      sha256: entry.sha256,
      blake3: entry.blake3 === undefined ? blake3 : entry.blake3,
    })),
    merkle_root: merkle,
    timestamp: timestamp || new Date().toISOString(),
    evidence_id: evidenceId,
  };
}

/** Serialise a manifest exactly as the extension does. */
function serializeManifest(manifest) {
  return JSON.stringify(manifest, null, 2);
}

/** SHA-256 of the serialised manifest text. */
function manifestSha256(manifestText) {
  return sha256Hex(typeof manifestText === 'string' ? manifestText : serializeManifest(manifestText));
}

/* ------------------------------------------------------------------ *
 * Header construction
 * ------------------------------------------------------------------ */

/**
 * Build the `Name: value` header lines, in injection order.
 * @returns {string[]}
 */
function buildHeaderLines({
  config,
  evidenceId,
  bodyHash,
  attachmentEntries = [],
  merkle = '',
  manifestHash = '',
} = {}) {
  const resolved = resolveConfig(config);
  const lines = [];
  lines.push(`${HEADER_NAMES.version}: ${resolved.version}`);
  lines.push(`${HEADER_NAMES.framework}: ${resolved.framework}`);
  lines.push(`${HEADER_NAMES.origin}: ${resolved.origin}`);
  lines.push(`${HEADER_NAMES.organization}: ${resolved.organization}`);
  lines.push(`${HEADER_NAMES.evidenceId}: ${sanitizeHeaderValue(evidenceId)}`);
  lines.push(`${HEADER_NAMES.bodySha256}: ${bodyHash}`);
  if (attachmentEntries.length > 0) {
    const list = attachmentEntries
      .map((entry) => `${headerToken(entry.filename)}=${entry.sha256}`)
      .join(',');
    lines.push(`${HEADER_NAMES.attachmentsSha256}: ${list}`);
  }
  lines.push(`${HEADER_NAMES.manifestSha256}: ${manifestHash}`);
  lines.push(`${HEADER_NAMES.merkleRoot}: ${merkle}`);
  if (resolved.pgpFingerprint) {
    lines.push(`${HEADER_NAMES.pgpFingerprint}: ${resolved.pgpFingerprint}`);
  }
  if (resolved.enableOts) {
    // Marker only. Real proofs are written by stamp() further down the chain.
    lines.push(`${HEADER_NAMES.ots}: pending`);
  }
  return lines;
}

/**
 * Compute the full evidence bundle from an explicit body and attachment list.
 *
 * Each attachment is hashed inside its own try/catch: one unreadable attachment
 * is reported in `skipped` and never aborts the run.
 *
 * @param {{body?: string, attachments?: Array<{name?: string, data?: *, error?: string}>,
 *          config?: object, evidenceId?: string, timestamp?: string}} input
 */
function computeEvidence({ body = '', attachments = [], config, evidenceId, timestamp } = {}) {
  const resolved = resolveConfig(config);
  const bodyText = typeof body === 'string' ? body : String(body == null ? '' : body);
  const bodyHash = sha256Hex(bodyText);

  const entries = [];
  const skipped = [];
  for (const attachment of attachments || []) {
    const filename = sanitizeHeaderValue((attachment && attachment.name) || 'attachment');
    if (!attachment || attachment.error) {
      skipped.push({ filename, reason: attachment && attachment.error ? attachment.error : 'UNREADABLE' });
      continue;
    }
    try {
      entries.push({ filename, sha256: sha256Hex(attachment.data) });
    } catch (error) {
      skipped.push({ filename, reason: error && error.message ? error.message : String(error) });
    }
  }

  const leaves = [bodyHash, ...entries.map((entry) => entry.sha256)];
  const merkle = merkleRoot(leaves);

  const id = sanitizeHeaderValue(evidenceId) || crypto.randomUUID();
  const manifest = buildManifest({
    config: resolved,
    bodyHash,
    attachmentEntries: entries,
    merkle,
    evidenceId: id,
    timestamp,
  });
  const manifestText = serializeManifest(manifest);
  const manifestHash = manifestSha256(manifestText);

  const headerLines = buildHeaderLines({
    config: resolved,
    evidenceId: id,
    bodyHash,
    attachmentEntries: entries,
    merkle,
    manifestHash,
  });

  return {
    config: resolved,
    evidenceId: id,
    bodySha256: bodyHash,
    attachments: entries,
    skipped,
    merkleRoot: merkle,
    manifest,
    manifestText,
    manifestFilename: MANIFEST_FILENAME,
    manifestSha256: manifestHash,
    headerLines,
    headers: headerLines.map((line) => {
      const index = line.indexOf(':');
      return { name: line.slice(0, index).trim(), value: line.slice(index + 1).trim() };
    }),
  };
}

/**
 * Re-stamp an existing compose payload the way the MailExtension does.
 * Existing `customHeaders` are preserved; new PasevSU lines are appended.
 *
 * @param {{body?: string, plainTextBody?: string, isPlainText?: boolean,
 *          customHeaders?: string[]}} details
 * @param {{config?: object, attachments?: Array<{name?: string, data?: *}>}} [options]
 * @returns {{details: object, evidence: object}}
 */
function applyToComposeDetails(details, options = {}) {
  const source = Object.assign({}, details || {});
  let body = source.isPlainText ? source.body : source.plainTextBody;
  if (!body) body = source.body || source.plainTextBody || '';
  const evidence = computeEvidence({
    body,
    attachments: options.attachments || [],
    config: options.config,
  });
  source.customHeaders = [...(source.customHeaders || []), ...evidence.headerLines];
  return { details: source, evidence };
}

/* ------------------------------------------------------------------ *
 * Verification helpers
 * ------------------------------------------------------------------ */

/**
 * Recompute the manifest hash and compare it with a claimed value.
 * @returns {{ok: boolean, expected: string, actual: string}}
 */
function verifyManifest(manifestText, expectedSha256) {
  const actual = manifestSha256(manifestText);
  return {
    ok: typeof expectedSha256 === 'string' && expectedSha256.toLowerCase() === actual,
    expected: expectedSha256 || '',
    actual,
  };
}

/**
 * Verify a manifest against the body/attachment bytes it claims to describe.
 * @returns {{ok: boolean, checks: Array<{name: string, ok: boolean, detail?: string}>}}
 */
function verifyEvidence(manifest, { body = '', attachments = [] } = {}) {
  const checks = [];
  const bodyHash = sha256Hex(typeof body === 'string' ? body : String(body == null ? '' : body));
  checks.push({
    name: 'body-sha256',
    ok: bodyHash === manifest.message_sha256,
    detail: `manifest=${manifest.message_sha256} actual=${bodyHash}`,
  });

  const claimed = Array.isArray(manifest.attachments) ? manifest.attachments : [];
  const actualLeaves = [bodyHash];
  for (const entry of claimed) {
    const match = (attachments || []).find(
      (candidate) => sanitizeHeaderValue(candidate.name) === entry.filename
    );
    if (!match) {
      checks.push({ name: `attachment:${entry.filename}`, ok: false, detail: 'not provided' });
      actualLeaves.push(entry.sha256);
      continue;
    }
    const actual = sha256Hex(match.data);
    actualLeaves.push(actual);
    checks.push({
      name: `attachment:${entry.filename}`,
      ok: actual === entry.sha256,
      detail: `manifest=${entry.sha256} actual=${actual}`,
    });
  }

  // The root is recomputed from the bytes actually supplied, so a tampered body or
  // attachment breaks the root itself — not merely one per-leaf comparison.
  const root = merkleRoot(actualLeaves);
  checks.push({
    name: 'merkle-root',
    ok: root === manifest.merkle_root,
    detail: `manifest=${manifest.merkle_root} actual=${root}`,
  });

  // Separately prove the manifest is internally consistent: its own claimed leaves
  // must hash to the root it declares, even if no bytes were supplied.
  const claimedRoot = merkleRoot([manifest.message_sha256, ...claimed.map((entry) => entry.sha256)]);
  checks.push({
    name: 'merkle-consistency',
    ok: claimedRoot === manifest.merkle_root,
    detail: `manifest=${manifest.merkle_root} claimed=${claimedRoot}`,
  });

  return { ok: checks.every((check) => check.ok), checks };
}

/* ------------------------------------------------------------------ *
 * OpenTimestamps adapter (07-ots + 17-javascript-opentimestamps)
 *
 * 07-ots needs the npm package `opentimestamps`. When it is absent the adapter
 * degrades to the same "pending" marker the MailExtension writes, so the send
 * chain never breaks. The pure SHA-256 sidecar helper has no such dependency.
 * ------------------------------------------------------------------ */

const otsRequire = createRequire(path.join(PACKAGES_DIR, '07-ots', 'package.json'));
let otsManagerPromise = null;

function loadOtsManager() {
  if (!otsManagerPromise) {
    otsManagerPromise = import(
      require('node:url').pathToFileURL(path.join(PACKAGES_DIR, '07-ots', 'ots-manager.js')).href
    ).catch((error) => {
      otsManagerPromise = null;
      throw error;
    });
  }
  return otsManagerPromise;
}

/** Whether the npm `opentimestamps` runtime is resolvable from the 07-ots group. */
function otsStatus() {
  try {
    const entry = otsRequire.resolve('opentimestamps');
    return { available: true, entry, reason: null };
  } catch (error) {
    return {
      available: false,
      entry: null,
      reason: 'OTS_RUNTIME_MISSING',
      detail: 'npm package "opentimestamps" is not installed for psemp-gateway/packages/07-ots.',
    };
  }
}

/** Write `<file>.sha256` sidecar (pure node:crypto, always available). */
async function otsSidecar(file) {
  const manager = await loadOtsManager();
  return manager.createSha256File(file);
}

/**
 * Stamp a file with OpenTimestamps. Degrades to a pending marker when the
 * runtime is missing, never throws for that reason.
 */
async function otsStamp(file, options = {}) {
  const status = otsStatus();
  if (!status.available) {
    return {
      status: 'pending',
      reason: status.reason,
      detail: status.detail,
      file: path.resolve(file),
      hash: fs.existsSync(file) ? sha256Hex(fs.readFileSync(file)) : null,
    };
  }
  const manager = await loadOtsManager();
  return manager.createTimestamp(file, options);
}

/** Verify an `.ots` proof. */
async function otsVerify(otsPath, options = {}) {
  const status = otsStatus();
  if (!status.available) {
    return { status: 'pending', verified: false, reason: status.reason, detail: status.detail, path: otsPath };
  }
  const manager = await loadOtsManager();
  return manager.verifyTimestamp(otsPath, options);
}

/** Upgrade a pending `.ots` proof with later Bitcoin attestations. */
async function otsUpgrade(otsPath, options = {}) {
  const status = otsStatus();
  if (!status.available) {
    return { status: 'pending', verified: false, reason: status.reason, detail: status.detail, path: otsPath };
  }
  const manager = await loadOtsManager();
  return manager.upgradeTimestamp(otsPath, options);
}

/* ------------------------------------------------------------------ *
 * OpenPGP adapter (15-openpgpjs)
 *
 * OpenPGP.js is vendored as TypeScript source and needs a build step, so the
 * gateway shells out to a real gpg binary when one is present and reports
 * "unavailable" otherwise. It never fabricates a signature.
 * ------------------------------------------------------------------ */

let gpgCache;

function findExecutable(name) {
  const extensions = process.platform === 'win32' ? ['.exe', ''] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, name + extension);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch (error) {
        // Not here; keep looking.
      }
    }
  }
  return null;
}

/** Detect a usable `gpg` binary. */
function pgpStatus() {
  if (gpgCache) return gpgCache;
  const executable = findExecutable('gpg') || findExecutable('gpg2');
  if (!executable) {
    gpgCache = {
      available: false,
      executable: null,
      reason: 'GPG_NOT_FOUND',
      detail: 'No gpg/gpg2 binary on PATH. Install GnuPG or run OpenPGP.js after building packages/15-openpgpjs.',
    };
    return gpgCache;
  }
  const probe = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  gpgCache = {
    available: probe.status === 0,
    executable,
    version: probe.status === 0 ? String(probe.stdout).split(/\r?\n/)[0] : null,
    reason: probe.status === 0 ? null : 'GPG_PROBE_FAILED',
  };
  return gpgCache;
}

function gpgRun(args) {
  const status = pgpStatus();
  if (!status.available) return { status: 'unavailable', reason: status.reason, detail: status.detail };
  const result = spawnSync(status.executable, args, { encoding: 'utf8' });
  return {
    status: result.status === 0 ? 'ok' : 'failed',
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    executable: status.executable,
  };
}

/**
 * Detached-sign a file. Writes `<file>.asc` next to it unless `outputPath` is given.
 * @returns {{status: string, signaturePath?: string, reason?: string}}
 */
function pgpSign(file, { keyId, outputPath, armor = true } = {}) {
  const status = pgpStatus();
  if (!status.available) return { status: 'unavailable', reason: status.reason, detail: status.detail };
  const input = path.resolve(file);
  const target = path.resolve(outputPath || `${input}.asc`);
  const args = ['--batch', '--yes', '--detach-sign'];
  if (armor) args.push('--armor');
  if (keyId) args.push('--local-user', String(keyId));
  args.push('--output', target, input);
  const result = gpgRun(args);
  if (result.status !== 'ok') return result;
  return { status: 'ok', signaturePath: target, executable: result.executable };
}

/** Verify a detached signature against its file. */
function pgpVerify(file, signaturePath) {
  const status = pgpStatus();
  if (!status.available) return { status: 'unavailable', reason: status.reason, detail: status.detail };
  const result = gpgRun(['--batch', '--verify', path.resolve(signaturePath), path.resolve(file)]);
  return { ...result, verified: result.status === 'ok' };
}

/* ------------------------------------------------------------------ *
 * EML evidence (05-forensics/email-evidence-js-core)
 * ------------------------------------------------------------------ */

let emailCorePromise = null;

function loadEmailCore() {
  if (!emailCorePromise) {
    const url = require('node:url').pathToFileURL(
      path.join(PACKAGES_DIR, '05-forensics', 'email-evidence-js-core', 'src', 'email', 'index.js')
    ).href;
    emailCorePromise = import(url).catch((error) => {
      emailCorePromise = null;
      throw error;
    });
  }
  return emailCorePromise;
}

/**
 * Parse an RFC822 message into the vendored evidence-object structure.
 * @param {string|Buffer} bytes
 */
async function emailEvidence(bytes, options = {}) {
  const core = await loadEmailCore();
  return core.buildEmailEvidence(toBuffer(bytes), options);
}

/* ------------------------------------------------------------------ *
 * Self-test
 * ------------------------------------------------------------------ */

/** Known-answer vectors, used by `selfTest()` and the CLI. */
const VECTORS = Object.freeze({
  sha256: ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  sha512: [
    'abc',
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
  ],
  sha3: [
    '',
    'a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26',
  ],
  sha224: ['abc', '23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7'],
  sha384: [
    'abc',
    'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
  ],
  ripemd160: ['abc', '8eb208f7e05d987a9b044a8e98c6b087f15a0bfc'],
});

/**
 * Run the gateway's own checks. Returns `{ ok, checks }` and never throws.
 */
async function selfTest() {
  const checks = [];
  const record = (name, fn) => {
    try {
      const detail = fn();
      checks.push({ name, ok: true, detail: detail === undefined ? null : detail });
    } catch (error) {
      checks.push({ name, ok: false, detail: error && error.message ? error.message : String(error) });
    }
  };
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  for (const [algorithm, [input, expected]] of Object.entries(VECTORS)) {
    record(`native:${algorithm}`, () => {
      const actual = hashHex(algorithm, input);
      assert(actual === expected, `${algorithm} known-answer failed: ${actual}`);
      return actual.slice(0, 16);
    });
  }

  record('vendored-parity', () => {
    // `sha3` is deliberately excluded: the vendored CryptoJS group implements
    // Keccak-512, while node:crypto implements NIST SHA3-512. See keccak512Hex.
    const sample = Buffer.from('PasevSU forensic mail — known answer 0123456789', 'utf8');
    const pairs = { sha256: 'sha256', sha512: 'sha512', sha224: 'sha224', sha384: 'sha384' };
    for (const [vendoredName, nativeName] of Object.entries(pairs)) {
      const fromVendored = vendoredDigest(vendoredName, sample);
      const fromNative = hashHex(nativeName, sample);
      assert(fromVendored === fromNative, `${vendoredName} mismatch: ${fromVendored} != ${fromNative}`);
    }
    return 'sha256/sha512/sha224/sha384 agree';
  });

  record('vendored-keccak512', () => {
    const expected =
      '0eab42de4c3ceb9235fc91acffe746b29c29a8c366b7c60e4e67c466f36a4304c00fa9caf9d87976ba469bcbe06713b435f091ef2769fb160cdab33d3670680e';
    const actual = keccak512Hex('');
    assert(actual === expected, `Keccak-512 known-answer failed: ${actual}`);
    assert(
      actual !== hashHex('sha3', ''),
      'Keccak-512 must not be conflated with NIST SHA3-512'
    );
    return actual.slice(0, 16);
  });

  record('merkle-single-leaf', () => {
    const leaf = sha256Hex('only child');
    assert(merkleRoot([leaf]) === leaf, 'single leaf must be its own root');
    return leaf.slice(0, 16);
  });

  record('merkle-order-independent', () => {
    const leaves = [sha256Hex('a'), sha256Hex('b'), sha256Hex('c'), sha256Hex('d'), sha256Hex('e')];
    const forward = merkleRoot(leaves);
    const backward = merkleRoot([...leaves].reverse());
    assert(forward === backward, 'root must not depend on input order');
    assert(forward.length === 64, 'root must be a sha256 hex digest');
    return forward.slice(0, 16);
  });

  record('merkle-empty', () => {
    assert(merkleRoot([]) === '', 'no leaves must give an empty root');
  });

  record('manifest-and-headers', () => {
    const evidence = computeEvidence({
      body: 'Hello evidence',
      attachments: [
        { name: 'note.txt', data: Buffer.from('attached bytes', 'utf8') },
        { name: 'broken.bin', error: 'UNREADABLE' },
      ],
      config: { version: '1.0', pgpFingerprint: 'ABCDEF0123456789', enableOts: true },
      evidenceId: '11111111-2222-4333-8444-555555555555',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    assert(evidence.attachments.length === 1, 'one readable attachment expected');
    assert(evidence.skipped.length === 1, 'unreadable attachment must be skipped, not fatal');
    assert(evidence.manifest.evidence_id === evidence.evidenceId, 'header and manifest Evidence-ID must match');
    const expectedManifest = [
      '{',
      '  "framework": "PasevSU",',
      '  "version": "1.0",',
      `  "message_sha256": "${evidence.bodySha256}",`,
      '  "attachments": [',
      '    {',
      '      "filename": "note.txt",',
      `      "sha256": "${evidence.attachments[0].sha256}",`,
      '      "blake3": null',
      '    }',
      '  ],',
      `  "merkle_root": "${evidence.merkleRoot}",`,
      '  "timestamp": "2026-01-01T00:00:00.000Z",',
      '  "evidence_id": "11111111-2222-4333-8444-555555555555"',
      '}',
    ].join('\n');
    assert(evidence.manifestText === expectedManifest, 'manifest serialisation drifted from the extension contract');
    assert(verifyManifest(evidence.manifestText, evidence.manifestSha256).ok, 'manifest hash must verify');
    const names = evidence.headers.map((header) => header.name);
    assert(names.includes('X-PasevSU-OTS'), 'enableOts must add the pending marker');
    assert(names.includes('X-PasevSU-PGP-Fingerprint'), 'non-empty fingerprint must be emitted');
    assert(evidence.headers[5].name === 'X-PasevSU-Body-SHA256', 'header order changed');
    return `${names.length} headers`;
  });

  record('headers-preserve-existing', () => {
    const { details, evidence } = applyToComposeDetails(
      { body: 'x', isPlainText: true, customHeaders: ['X-Keep-Me: 1'] },
      { config: { enableOts: false } }
    );
    assert(details.customHeaders[0] === 'X-Keep-Me: 1', 'existing header was dropped');
    assert(
      details.customHeaders.length === evidence.headerLines.length + 1,
      'appended header count mismatch'
    );
    assert(!details.customHeaders.some((line) => line.startsWith('X-PasevSU-OTS')), 'OTS marker must stay off by default');
  });

  record('header-injection-safety', () => {
    const { details } = applyToComposeDetails(
      { body: 'x', isPlainText: true },
      { config: { version: '1.0\r\nX-Evil: yes', organization: 'a\nb' } }
    );
    for (const line of details.customHeaders) {
      assert(!/[\r\n]/.test(line), `header line must not contain CR/LF: ${line}`);
    }
  });

  record('ots-adapter', () => {
    const status = otsStatus();
    assert(typeof status.available === 'boolean', 'otsStatus must report availability');
    return status.available ? 'runtime present' : status.reason;
  });

  record('pgp-adapter', () => {
    const status = pgpStatus();
    assert(typeof status.available === 'boolean', 'pgpStatus must report availability');
    return status.available ? status.version : status.reason;
  });

  await (async () => {
    try {
      const sample = Buffer.from(
        [
          'From: alice@example.org',
          'To: bob@example.org',
          'Subject: PSEMP self-test',
          'Date: Thu, 01 Jan 2026 00:00:00 +0000',
          'Message-ID: <selftest@example.org>',
          'Content-Type: text/plain; charset=utf-8',
          '',
          'Body bytes for the evidence pipeline.',
          '',
        ].join('\r\n'),
        'utf8'
      );
      const evidence = await emailEvidence(sample, { filename: 'selftest.eml' });
      checks.push({
        name: 'email-evidence-core',
        ok: Boolean(evidence && evidence.email && evidence.source),
        detail: evidence && evidence.source ? `source sha256 ${String(evidence.source.hashes.sha256).slice(0, 16)}` : null,
      });
    } catch (error) {
      checks.push({
        name: 'email-evidence-core',
        ok: false,
        detail: error && error.message ? error.message : String(error),
      });
    }
  })();

  return { ok: checks.every((check) => check.ok), checks };
}

module.exports = {
  // constants
  DEFAULTS,
  FRAMEWORK,
  SCHEMA_VERSION,
  HEADER_NAMES,
  MANIFEST_FILENAME,
  ALGORITHMS,
  PACKAGES_DIR,
  VECTORS,
  // hashing
  sha256Hex,
  hashHex,
  vendoredDigest,
  vendoredAlgorithms,
  keccak512Hex,
  merkleRoot,
  sanitizeHeaderValue,
  // manifest + headers
  resolveConfig,
  buildManifest,
  serializeManifest,
  manifestSha256,
  buildHeaderLines,
  computeEvidence,
  applyToComposeDetails,
  verifyManifest,
  verifyEvidence,
  // adapters
  otsStatus,
  otsSidecar,
  otsStamp,
  otsVerify,
  otsUpgrade,
  pgpStatus,
  pgpSign,
  pgpVerify,
  emailEvidence,
  // diagnostics
  selfTest,
};
