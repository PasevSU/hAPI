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
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const PACKAGES_DIR = path.join(__dirname, 'packages');
const MANIFEST_FILENAME = 'PasevSU_Manifest.json';
const FRAMEWORK = 'PasevSU';
const SCHEMA_VERSION = '1.0';

/*
 * The gateway's own build, reported separately from `X-PasevSU-Version`.
 *
 * `version` in the defaults is the config/format version a user sets, and the brief
 * fixes its default at "1.0" — so on its own it cannot distinguish two builds of the
 * same tooling. A recipient comparing two messages needs the build. Read from the
 * package manifest; the fallback keeps a copied-single-file api.js loadable.
 */
const BUILD_VERSION = (() => {
  try {
    return require('./package.json').version;
  } catch {
    return '0.0.0';
  }
})();

/** Defaults match thunderbird-extension/background.js, except `origin`. */
const DEFAULTS = Object.freeze({
  version: '1.0',
  framework: 'Forensic-Mail',
  origin: 'PSEMP-Gateway',
  organization: 'PasevSU',
  caseId: '',
  pgpFingerprint: '',
  // On by default so the marker is written without any per-message decision; the
  // extension's options page can turn it off and that stored value wins.
  enableOts: true,
  // Delivery receipt (MDN, RFC 8098). On by default for the same reason: asking for
  // a receipt is the standard behaviour, not a per-message choice. The gateway uses
  // the same switch and falls back to `receiptAddress` when the message carries no
  // `From` it can answer to.
  enableReceipt: true,
  receiptAddress: '',
});

const SETTINGS_FILENAME = 'settings.default.json';
const SETTINGS_PATH = path.join(__dirname, SETTINGS_FILENAME);
let settingsCache = null;

/**
 * Shared defaults, read from `settings.default.json` beside this file.
 *
 * The same six keys are mirrored in the Thunderbird extension, so keeping them in a
 * data file lets the two halves be diffed instead of hand-synchronised. A missing or
 * malformed file falls back to `DEFAULTS` — settings must never fail a send.
 * @param {string} [file] override, mainly for tests
 */
function loadSettings(file = SETTINGS_PATH) {
  if (file === SETTINGS_PATH && settingsCache) return settingsCache;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    parsed = {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
  const settings = Object.freeze(Object.assign({}, parsed));
  if (file === SETTINGS_PATH) settingsCache = settings;
  return settings;
}

/** Header names, in injection order. `X-PasevSU-OTS` is a marker during compose. */
const HEADER_NAMES = Object.freeze({
  version: 'X-PasevSU-Version',
  build: 'X-PasevSU-Build',
  framework: 'X-PasevSU-Framework',
  origin: 'X-PasevSU-Origin',
  organization: 'X-PasevSU-Organization',
  war: 'X-PasevSU-WAR',
  evidenceId: 'X-PasevSU-Evidence-ID',
  caseId: 'X-PasevSU-Case-ID',
  bodySha256: 'X-PasevSU-Body-SHA256',
  attachmentsCount: 'X-PasevSU-Attachments-Count',
  attachmentsSha256: 'X-PasevSU-Attachments-SHA256',
  attachmentsError: 'X-PasevSU-Attachments-Error',
  manifestSha256: 'X-PasevSU-Manifest-SHA256',
  merkleRoot: 'X-PasevSU-Merkle-Root',
  pgpFingerprint: 'X-PasevSU-PGP-Fingerprint',
  ots: 'X-PasevSU-OTS',
  receipt: 'X-PasevSU-Receipt',
  messageId: 'X-PasevSU-Message-ID',
  sha256Block: 'X-PasevSU-Sha256',
  criptoEngine: 'X-PasevSU-Cripto-Engine',
  criptoTitle: 'X-PasevSU-Cripto-title',
  created: 'X-PasevSU-Created',
  expires: 'X-PasevSU-Expires',
  nonce: 'X-PasevSU-Nonce',
  sequence: 'X-PasevSU-Sequence',
  canary: 'X-PasevSU-Canary',
  headersSha256: 'X-PasevSU-Headers-SHA256',
});

/** Standard MDN header (RFC 8098), sent with `X-PasevSU-Receipt: requested`. */
const MDN_HEADER = 'Disposition-Notification-To';

/* ------------------------------------------------------------------ *
 * The war marker — mandatory on every message
 *
 * `{{ PasevSU-WAR }}` closes the Subject, the same marker closes a plain-text
 * notice in the body, and `X-PasevSU-WAR` restates what the marker points at:
 * which signature proves the sender, and that forwarding is forbidden.
 *
 * Two carriers are platform-bound. Thunderbird's Compose API refuses any custom
 * header name that does not start with `X-`/`List-`, and a rejected
 * `setComposeDetails()` aborts the send, so the MailExtension ships
 * `X-PasevSU-WAR`. A field may only be claimed by a component that composes the
 * message itself — this gateway — which therefore emits both `PasevSU-WAR:` and the
 * `X-` twin, exactly as it already does for `Message-ID`.
 *
 * The text is a requirement, not a claim: the extension does not sign anything
 * (Thunderbird's built-in OpenPGP does, per identity), so it names the signature
 * that proves the message instead of asserting that one is attached.
 * ------------------------------------------------------------------ */

/** Subject suffix and body sentinel. Never configurable — see PROTOCOL.md §4a. */
const WAR_MARKER = '{{ PasevSU-WAR }}';

/** Address whose registered OpenPGP key is the only accepted proof of origin. */
const WAR_SIGNER = 'pasevdenislav@gmail.com';

/** Signature standard the marker refers to. */
const WAR_STANDARD = 'OpenPGP/MIME signed message (RFC 4880 and 3156)';

/*
 * The three sentences below are the whole statement, and they are the CONTRACT.
 * thunderbird-extension/background.js must produce byte-identical values for
 * WAR_HEADER_TEXT, WAR_NOTICE_TEXT and WAR_NOTICE_HTML —
 * test/extension-arming.cjs fails otherwise.
 */
const WAR_NO_SIGNATURE =
  `An email that does not carry the ${WAR_STANDARD} signature made with the PGP `
  + `key registered to ${WAR_SIGNER} is not ours.`;
const WAR_PROOF =
  'Only that signature proves our identity and preserves the integrity of the message.';
const WAR_FORBIDDEN = 'FORWARDING THIS EMAIL IS STRICTLY FORBIDDEN.';

/** Value of `X-PasevSU-WAR` (and of the unprefixed twin). ASCII-only by contract. */
const WAR_HEADER_TEXT =
  `${WAR_NO_SIGNATURE} ${WAR_PROOF} FORWARDING THIS EMAIL IS STRICTLY FORBIDDEN `
  + `AND IS STATED EXPLICITLY IN THE EMAIL BODY. ${WAR_MARKER}`;

/**
 * Exact suffix of every outgoing plain-text body.
 *
 * A verifier reproduces `X-PasevSU-Body-SHA256` by removing this whole constant with
 * `endsWith`, never by searching for a substring — the marker alone is not a safe cut
 * point, because an authored body is allowed to contain the marker too.
 */
const WAR_NOTICE_TEXT =
  `\n\n${WAR_MARKER}\n${WAR_NO_SIGNATURE}\n${WAR_PROOF}\n${WAR_FORBIDDEN}\n`;

/** The same wording for an HTML composer; markup only, never different claims. */
const WAR_NOTICE_HTML =
  '<div class="pasevsu-war" data-pasevsu-war="1" style="margin-top:16px;'
  + 'padding-top:8px;border-top:1px solid #999;font-size:smaller">'
  + `<p><strong>${WAR_MARKER}</strong></p>`
  + `<p>An email that does not carry the ${WAR_STANDARD} signature made with the `
  + `PGP key registered to <a href="mailto:${WAR_SIGNER}">${WAR_SIGNER}</a> is not `
  + `ours. ${WAR_PROOF}</p>`
  + `<p><strong>${WAR_FORBIDDEN}</strong></p></div>`;

/**
 * Make sure the Subject ends with {@link WAR_MARKER}.
 *
 * Idempotent: Thunderbird can fire `onBeforeSend` more than once for one message,
 * and two markers would be visible to the recipient. The trailing whitespace of the
 * authored Subject is trimmed first because the compose code collapses runs of
 * 74+ whitespace characters on the way out.
 *
 * @param {string} subject
 * @returns {string}
 */
function appendWarMarker(subject) {
  const current = typeof subject === 'string' ? subject : '';
  if (current.includes(WAR_MARKER)) return current;
  const trimmed = current.replace(/\s+$/, '');
  return trimmed ? `${trimmed} ${WAR_MARKER}` : WAR_MARKER;
}

/**
 * Pick the body field an outgoing notice may be written into.
 *
 * Thunderbird deletes whichever property does not match the compose format before
 * applying the change (`delete details.body` for a text composer,
 * `delete details.plainTextBody` for an HTML one), so writing into the wrong field
 * means the notice silently never lands in the message.
 *
 * @param {{isPlainText?: boolean, body?: string, plainTextBody?: string}} details
 * @returns {'body'|'plainTextBody'|''}
 */
function warBodyField(details) {
  const order = details.isPlainText === true ? ['plainTextBody', 'body'] : ['body', 'plainTextBody'];
  return order.find((field) => typeof details[field] === 'string') || '';
}

/**
 * Append the notice, or `null` when the body already carries it.
 *
 * The marker is the sentinel — it is always part of the notice — so a second pass
 * returns `null` instead of stacking a second footer. Which flavour to append follows
 * `isPlainText`/the field rather than the field alone: a plain-text composer must
 * never receive HTML tags in its text.
 *
 * @param {{isPlainText?: boolean, body?: string, plainTextBody?: string}} details
 * @param {'body'|'plainTextBody'} field
 * @returns {string|null}
 */
function withWarNotice(details, field) {
  const value = details[field];
  if (typeof value !== 'string' || value.includes(WAR_MARKER)) return null;
  const plain = details.isPlainText === true || field === 'plainTextBody';
  return plain ? `${value}${WAR_NOTICE_TEXT}` : `${value}${WAR_NOTICE_HTML}`;
}

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
  const merged = Object.assign({}, DEFAULTS, loadSettings(), config || {});
  merged.version = sanitizeHeaderValue(merged.version) || DEFAULTS.version;
  merged.framework = sanitizeHeaderValue(merged.framework) || DEFAULTS.framework;
  merged.origin = sanitizeHeaderValue(merged.origin) || DEFAULTS.origin;
  merged.organization = sanitizeHeaderValue(merged.organization) || DEFAULTS.organization;
  merged.pgpFingerprint = normalizeFingerprint(merged.pgpFingerprint);
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
  bodySha3,
  attachmentEntries = [],
  merkle = '',
  evidenceId,
  timestamp,
  blake3 = null,
  replay = null,
  signedHeaders = null,
  provenance = null,
} = {}) {
  const resolved = resolveConfig(config);
  // Key order is a contract: `thunderbird-extension/background.js` writes the same
  // shape with SHA3-512/BLAKE3 left null, because Web Crypto cannot compute them.
  // The gateway recomputes those slots here, so one manifest shape serves both.
  // Everything from `algorithms` down was APPENDED in PSEMP 1.1 (see PROTOCOL.md §5);
  // appending keeps every hash the extension already published recomputable.
  return {
    framework: FRAMEWORK,
    version: resolved.version,
    message_sha256: bodyHash,
    message_sha3_512: bodySha3 === undefined ? null : bodySha3,
    attachments: attachmentEntries.map((entry) => ({
      filename: entry.filename,
      sha256: entry.sha256,
      sha3_512: entry.sha3_512 === undefined ? null : entry.sha3_512,
      blake3: entry.blake3 === undefined ? blake3 : entry.blake3,
    })),
    merkle_root: merkle,
    timestamp: timestamp || new Date().toISOString(),
    evidence_id: evidenceId,
    algorithms: buildAlgorithms(),
    provenance:
      provenance ||
      buildProvenance({
        recipient: replay && replay.recipient,
        evidenceId,
        issuedAt: replay && replay.issued_at,
        organization: resolved.organization,
      }),
    signed_headers: signedHeaders || null,
    replay: replay || null,
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
 * Crypto engine and the digest block
 *
 * A MailExtension cannot read `gpg` or `ots`, but it CAN compute two extra headers that
 * make the evidence self-describing in the header slice alone: one folded block that
 * names every digested byte, and a keyed copy of that same block.
 *
 * The 25-digit engine code is DERIVED, never random: the extension and the gateway must
 * arrive at the same number from the same evidence, and a recipient must be able to
 * recompute it from the Merkle root they already have.
 * ------------------------------------------------------------------ */

const ENGINE_LABEL = 'PasevSU-Cripto-Engine:v1';
const CRYPTO_TITLE_LABEL = 'PasevSU-Cripto-title:v1';
const ENGINE_DIGITS = 25;

/** Derive the 25-digit crypto-engine code from the evidence. */
function cryptoEngineCode({ merkleRoot = '', bodySha256 = '' } = {}) {
  const seed = sha256Hex(`${ENGINE_LABEL}|${merkleRoot}|${bodySha256}`);
  // 96 bits (24 hex chars) reduced mod 10^25 always lands inside 25 digits.
  const value = BigInt(`0x${seed.slice(0, 24)}`) % 10n ** BigInt(ENGINE_DIGITS);
  return value.toString().padStart(ENGINE_DIGITS, '0');
}

/**
 * The block the `X-PasevSU-Sha256` header carries: the body, EVERY attachment, then the
 * timestamp. Order is a contract — the encrypted title is built from exactly this text.
 */
function buildDigestBlock({ bodySha256 = '', attachmentEntries = [], timestamp = '' } = {}) {
  const rows = [`body - ${bodySha256}`];
  for (const entry of attachmentEntries) {
    rows.push(`${headerToken(entry.filename)} - ${entry.sha256}`);
  }
  rows.push(`timestep - ${timestamp}`);
  return rows;
}

/**
 * Join block rows into ONE header value.
 *
 * Single line is a hard contract, not a shortcut: Thunderbird's `customHeaders` carries
 * `Name: value` strings and the `header-injection-safety` self-test rejects CR/LF, so a
 * literal folded block would be undefined behaviour. `,` is the row separator the
 * `X-PasevSU-Attachments-SHA256` list already uses, and `headerToken` escapes `,` and `=`
 * out of file names, so the rows stay unambiguous.
 */
function joinBlock(rows) {
  return rows.join(',');
}

/** Inverse of {@link joinBlock}. */
function parseBlock(value) {
  return String(value == null ? '' : value)
    .split(',')
    .map((row) => row.trim())
    .filter(Boolean);
}

function keyFromCode(label, code) {
  return Buffer.from(sha256Hex(`${label}|key|${code}`), 'hex');
}

function ivFromCode(label, code, merkleRoot) {
  return Buffer.from(sha256Hex(`${label}|iv|${code}|${merkleRoot}`), 'hex').subarray(0, 12);
}

/**
 * Encrypt the digest block with the engine code (AES-256-GCM).
 *
 * The code travels in the message, so this is not secrecy against the recipient — it
 * keeps file names and digests out of plaintext header scanners while staying
 * recoverable by anyone who holds the message. Deterministic, so both engines agree.
 */
function encryptDigestBlock(code, rows, { merkleRoot = '' } = {}) {
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFromCode(CRYPTO_TITLE_LABEL, code), ivFromCode(CRYPTO_TITLE_LABEL, code, merkleRoot));
  const body = Buffer.concat([cipher.update(rows.join('\n'), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const b64u = (buffer) => Buffer.from(buffer).toString('base64url');
  return `gcm1.${b64u(ivFromCode(CRYPTO_TITLE_LABEL, code, merkleRoot))}.${b64u(tag)}.${b64u(body)}`;
}

/** Reverse {@link encryptDigestBlock}. Throws on a wrong code or a tampered token. */
function decryptDigestBlock(code, token, { merkleRoot: _merkleRoot = '' } = {}) {
  const parts = String(token == null ? '' : token).split('.');
  if (parts.length !== 4 || parts[0] !== 'gcm1') throw new Error('not a PasevSU gcm1 title');
  const decoder = crypto.createDecipheriv('aes-256-gcm', keyFromCode(CRYPTO_TITLE_LABEL, code), Buffer.from(parts[1], 'base64url'));
  decoder.setAuthTag(Buffer.from(parts[2], 'base64url'));
  const body = Buffer.concat([decoder.update(Buffer.from(parts[3], 'base64url')), decoder.final()]);
  return String(body).split('\n');
}

/**
 * A long Message-ID carrying non-standard (but RFC 5322 dot-atom legal) characters
 * `+ _ ~`, so a PasevSU message is trivially recognisable in any mail store.
 */
function buildMessageId({ evidenceId = '', timestamp = '' } = {}) {
  const stamp = String(timestamp || '').replace(/[^0-9]/g, '').slice(0, 14).padEnd(14, '0');
  const seed = sha256Hex(`${ENGINE_LABEL}|msgid|${evidenceId}|${stamp}`);
  const slug = (offset, length) => seed.slice(offset, offset + length);
  const local = `PasevSU.${stamp}.${evidenceId || slug(0, 8)}+${slug(8, 6)}_${slug(14, 6)}~${slug(20, 6)}.${slug(26, 6)}`;
  return `<${local}@forensic.evidence.pasevsu>`;
}

/* ------------------------------------------------------------------ *
 * PSEMP v1.1 — replay defence, cryptographic time, watermark and canary
 *
 * Four properties a mail signature alone cannot give you, all computable at compose
 * time (so both engines agree and nothing is added after the manifest is hashed):
 *
 *   1. NONCE + SEQUENCE  — a message that was already accepted cannot be accepted
 *      again. 128 bits of randomness make guessing hopeless; a per-sender monotonic
 *      sequence makes a DELIBERATE rollback visible even if a nonce is re-used.
 *   2. FRESHNESS WINDOW  — `issued_at` .. `expires_at` bounds how long the message is
 *      a fresh claim. Expiry weakens NOTHING that proves integrity: the Merkle root,
 *      the PGP signature and the OTS proof stay valid forever. It only says "this
 *      copy is no longer a currently-issued statement".
 *   3. RECIPIENT BINDING — the manifest names the mailbox this copy was produced for,
 *      so a captured copy replayed to a different recipient is detectable, and a leak
 *      can be traced to the copy it came from.
 *   4. SIGNED METADATA   — `signed_headers` hashes Subject/From/To/Date/Message-ID and
 *      the attachment set. A signature over the body alone lets someone re-send the
 *      same signed body under a new subject or with a file swapped.
 * ------------------------------------------------------------------ */

const REPLAY_DEFAULTS = Object.freeze({
  // One hour: long enough for any sane queue, short enough that a captured copy
  // stops being a currently-issued statement the same working day.
  maxAgeSeconds: 3600,
  // Tolerated clock disagreement. Also caps how far in the FUTURE `issued_at` may
  // sit, which is otherwise a trivial way to extend the freshness window.
  maxSkewSeconds: 60,
  // Nonces remembered in one process before the oldest are dropped.
  windowSize: 4096,
});

/** The algorithms this build actually uses, recorded so a package is readable later. */
function buildAlgorithms() {
  return {
    body: 'SHA-256',
    extra: ['SHA3-512', 'BLAKE3'],
    merkle: 'SHA-256',
    engine: 'AES-256-GCM',
    signature: 'OpenPGP',
    timestamp: 'OpenTimestamps',
  };
}

/**
 * Boundary watermark: the recipient, the issue time and the message id written INSIDE
 * the hashed manifest (not only in the visible headers), so a leaked copy still names
 * the envelope it was minted for even if the headers were stripped in transit.
 */
function buildProvenance({ recipient = '', messageId = '', evidenceId = '', issuedAt = '', organization = '' } = {}) {
  return {
    framework: FRAMEWORK,
    standard: 'PSEMP',
    organization: sanitizeHeaderValue(organization),
    evidence_id: sanitizeHeaderValue(evidenceId),
    recipient: sanitizeHeaderValue(recipient),
    message_id: sanitizeHeaderValue(messageId),
    issued_at: sanitizeHeaderValue(issuedAt),
  };
}

/** Render an address value — string, object, or list — as header text. */
function addressText(value) {
  if (!value) return '';
  if (typeof value === 'string') return sanitizeHeaderValue(value);
  if (Array.isArray(value)) return value.map(addressText).filter(Boolean).join(', ');
  return sanitizeHeaderValue(value.email || value.id || '');
}

/** Normalise a `to` value — string, array, or address objects — into a string list. */
function normalizeRecipients(to) {
  return (Array.isArray(to) ? to : String(to == null ? '' : to).split(','))
    .map((value) => {
      if (value && typeof value === 'object') return sanitizeHeaderValue(value.email || value.id || '');
      return sanitizeHeaderValue(value);
    })
    .filter(Boolean);
}

/**
 * Hash the metadata a signature must cover as well as the body.
 *
 * `attachments_sha256` hashes the sorted `[filename, sha256]` pairs, so attachment
 * ORDER never changes the result but a renamed or swapped file always does.
 * `headers_sha256` covers the whole record and therefore does NOT cover itself.
 */
function buildSignedHeaders({
  subject = '',
  from = '',
  to = [],
  date = '',
  messageId = '',
  attachmentEntries = [],
} = {}) {
  const files = (attachmentEntries || [])
    .map((entry) => [
      String(entry && entry.filename == null ? '' : entry.filename),
      String(entry && entry.sha256 == null ? '' : entry.sha256),
    ])
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  const record = {
    subject: sanitizeHeaderValue(subject),
    from: addressText(from),
    to: normalizeRecipients(to),
    date: sanitizeHeaderValue(date),
    message_id: sanitizeHeaderValue(messageId),
    attachments_sha256: sha256Hex(JSON.stringify(files)),
  };
  const digest = sha256Hex(JSON.stringify(record));
  return Object.assign({}, record, { headers_sha256: digest });
}

/**
 * Canary token in the `PASEVSU-YYYY-MM-DD-XXXXXXXX` shape.
 *
 * Derived, never random: the same nonce and sequence always give the same token, so
 * it survives a re-computation, and nobody can predict the next one from today's.
 * It replaces the "decoy file" idea — the same leak-tracing effect without putting
 * fabricated documents into evidence.
 */
function buildCanary({ issuedAt = '', sequence = 0, organization = '', nonce = '' } = {}) {
  const day = sanitizeHeaderValue(issuedAt).slice(0, 10) || new Date().toISOString().slice(0, 10);
  const seed = sha256Hex(`PasevSU-Canary:v1|${sanitizeHeaderValue(organization)}|${day}|${sequence}|${nonce}`);
  return `PASEVSU-${day}-${seed.slice(0, 8).toUpperCase()}`;
}

/**
 * The replay record that travels in the manifest and in the `X-PasevSU-Nonce`,
 * `-Created`, `-Expires` and `-Sequence` headers.
 *
 * `expires_at` is derived from `issued_at` + `maxAgeSeconds`, so a reader can check
 * the deadline without trusting the sender's clock twice.
 */
function buildReplay({ nonce, sequence = 0, issuedAt, recipient = '', maxAgeSeconds } = {}) {
  const parsed = Date.parse(issuedAt || '');
  const stamp = Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
  const ttl = Number.isFinite(Number(maxAgeSeconds)) ? Number(maxAgeSeconds) : REPLAY_DEFAULTS.maxAgeSeconds;
  const expires = new Date(Date.parse(stamp) + Math.max(0, ttl) * 1000).toISOString();
  const value = sanitizeHeaderValue(nonce) || crypto.randomUUID().replace(/-/g, '');
  return {
    nonce: value,
    sequence: Number.isFinite(Number(sequence)) ? Number(sequence) : 0,
    issued_at: stamp,
    expires_at: expires,
    recipient: sanitizeHeaderValue(recipient),
    single_use: true,
  };
}

/**
 * The seen-nonce store that makes replay detection possible.
 *
 * A nonce is only ever "already seen" relative to a store, so the store is an explicit
 * argument rather than hidden state: one guard per receiving process, optionally
 * backed by a JSON file so a restart does not forget every nonce it accepted.
 */
class ReplayGuard {
  constructor(options = {}) {
    this.limits = Object.assign({}, REPLAY_DEFAULTS, options.limits || {});
    this.storePath = options.storePath ? path.resolve(String(options.storePath)) : '';
    this.seen = new Map();
    this.persist = options.persist !== false;
    this.load();
  }

  /** Read the JSON store, ignoring a missing or unreadable file. */
  load() {
    if (!this.storePath) return this;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      const entries = parsed && typeof parsed === 'object' ? parsed.seen || parsed : {};
      for (const [key, value] of Object.entries(entries)) {
        if (value && typeof value === 'object') this.seen.set(key, value);
      }
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        // A corrupt store must not silently accept everything: start empty and say so.
        this.loadError = error.message || String(error);
      }
    }
    return this;
  }

  /** Write the JSON store; a failure is reported, never thrown into a send path. */
  save() {
    if (!this.storePath || !this.persist) return this;
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      const temporary = `${this.storePath}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, seen: Object.fromEntries(this.seen) }, null, 2)}\n`, 'utf8');
      fs.renameSync(temporary, this.storePath);
      this.saveError = '';
    } catch (error) {
      this.saveError = error && error.message ? error.message : String(error);
    }
    return this;
  }

  /** Nonces are compared case-insensitively; they are hex or uuid-shaped. */
  key(nonce) {
    return sanitizeHeaderValue(nonce).toLowerCase();
  }

  /** Drop entries past retention and enforce the window size. */
  prune(now = Date.now()) {
    const retention = this.limits.maxAgeSeconds * 4 * 1000;
    for (const [key, value] of this.seen) {
      const at = Date.parse(value && value.seen_at);
      if (Number.isFinite(at) && now - at > retention) this.seen.delete(key);
    }
    while (this.seen.size > this.limits.windowSize) {
      const oldest = this.seen.keys().next();
      if (oldest.done) break;
      this.seen.delete(oldest.value);
    }
    return this;
  }

  /**
   * Record and classify one nonce.
   * @returns {{ok: boolean, verdict: string, detail: string}}
   */
  check(nonce, options = {}) {
    const limits = Object.assign({}, this.limits, options.limits || {});
    const now = options.now == null ? Date.now() : Number(options.now);
    const key = this.key(nonce);
    if (!key) {
      return { ok: false, verdict: 'unknown', detail: 'the evidence carries no nonce' };
    }

    // Freshness first: a stale or future-dated copy is refused before it can poison
    // the store with a nonce that was never legitimately issued now.
    const issued = Date.parse(options.issuedAt || '');
    if (Number.isFinite(issued)) {
      if (issued - now > limits.maxSkewSeconds * 1000) {
        return { ok: false, verdict: 'future-dated', detail: `issued_at is ${Math.round((issued - now) / 1000)}s ahead of the verifier clock` };
      }
      const age = now - issued;
      if (age > limits.maxAgeSeconds * 1000) {
        return { ok: false, verdict: 'expired', detail: `issued ${Math.round(age / 1000)}s ago, window is ${limits.maxAgeSeconds}s` };
      }
    }

    const previous = this.seen.get(key);
    if (previous) {
      const sameRecipient =
        sanitizeHeaderValue(previous.recipient).toLowerCase() ===
        sanitizeHeaderValue(options.recipient).toLowerCase();
      return {
        ok: false,
        verdict: 'replay',
        detail: `nonce first seen at ${previous.seen_at}${sameRecipient ? ' for the same recipient' : ' for a DIFFERENT recipient'}`,
      };
    }

    this.seen.set(key, {
      seen_at: new Date(now).toISOString(),
      issued_at: sanitizeHeaderValue(options.issuedAt),
      expires_at: sanitizeHeaderValue(options.expiresAt),
      recipient: sanitizeHeaderValue(options.recipient),
      evidence_id: sanitizeHeaderValue(options.evidenceId),
    });
    this.prune(now);
    this.save();
    return { ok: true, verdict: 'first-use', detail: 'nonce not present in the store' };
  }
}

/**
 * Replay-check a manifest (or any evidence object carrying a `replay` block).
 *
 * Pass the SAME guard across messages — a fresh guard per call can only ever answer
 * "first use", which is exactly the bug this protects against.
 */
function verifyReplay(manifest, options = {}) {
  const guard = options.guard || new ReplayGuard(options);
  const replay = (manifest && manifest.replay) || {};
  const result = guard.check(replay.nonce || options.nonce, {
    issuedAt: replay.issued_at || options.issuedAt,
    expiresAt: replay.expires_at || options.expiresAt,
    recipient: replay.recipient || options.recipient,
    evidenceId: (manifest && manifest.evidence_id) || options.evidenceId,
    limits: options.limits,
    now: options.now,
  });
  return Object.assign({ nonce: replay.nonce || '', issued_at: replay.issued_at || '' }, result);
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
  timestamp = '',
  replay = null,
  signedHeaders = null,
} = {}) {
  const resolved = resolveConfig(config);
  const lines = [];
  lines.push(`${HEADER_NAMES.version}: ${resolved.version}`);
  lines.push(`${HEADER_NAMES.build}: ${BUILD_VERSION}`);
  lines.push(`${HEADER_NAMES.framework}: ${resolved.framework}`);
  lines.push(`${HEADER_NAMES.origin}: ${resolved.origin}`);
  lines.push(`${HEADER_NAMES.organization}: ${resolved.organization}`);
  // The war line sits with the identity block, not at the end: it is part of who
  // sent the message. Both spellings, same twin rule as Message-ID below.
  lines.push(`PasevSU-WAR: ${WAR_HEADER_TEXT}`);
  lines.push(`${HEADER_NAMES.war}: ${WAR_HEADER_TEXT}`);
  lines.push(`${HEADER_NAMES.evidenceId}: ${sanitizeHeaderValue(evidenceId)}`);
  if (resolved.caseId) {
    lines.push(`${HEADER_NAMES.caseId}: ${sanitizeHeaderValue(resolved.caseId)}`);
  }
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
  // Appended (never interleaved) so the established header order above stays a contract.
  const stamp = timestamp || new Date().toISOString();
  const messageId = buildMessageId({ evidenceId, timestamp: stamp });
  // The gateway composes the whole message, so it can write the real field as well.
  // It has no transport of its own (§2), so the line lives in the bundle, not on the
  // wire. The extension cannot write it at all: ComposeDetails.customHeaders rejects
  // any name that does not start with X-, and a rejected setComposeDetails() aborts
  // the send with no dialog. So both engines emit the X- twin, and only this one
  // promotes it to the unprefixed field.
  lines.push(`Message-ID: ${messageId}`);
  lines.push(`${HEADER_NAMES.messageId}: ${messageId}`);
  const block = buildDigestBlock({ bodySha256: bodyHash, attachmentEntries, timestamp: stamp });
  lines.push(`${HEADER_NAMES.sha256Block}: ${joinBlock(block)}`);
  const engine = cryptoEngineCode({ merkleRoot: merkle, bodySha256: bodyHash });
  lines.push(`${HEADER_NAMES.criptoEngine}: ${engine}`);
  lines.push(`${HEADER_NAMES.criptoTitle}: ${encryptDigestBlock(engine, block, { merkleRoot: merkle })}`);

  /*
   * PSEMP 1.1 — appended after the established block, so the 18-line order above is
   * untouched. These four carry the replay defence, the freshness deadline, the
   * per-sender sequence and the leak-tracing canary; `Headers-SHA256` is the digest of
   * the metadata a signature must also cover (Subject/From/To/Date/Message-ID/files).
   */
  const record = replay || buildReplay({ issuedAt: stamp });
  const metadata = signedHeaders || buildSignedHeaders({ date: stamp, messageId, attachmentEntries });
  lines.push(`${HEADER_NAMES.created}: ${record.issued_at}`);
  lines.push(`${HEADER_NAMES.expires}: ${record.expires_at}`);
  lines.push(`${HEADER_NAMES.nonce}: ${record.nonce}`);
  lines.push(`${HEADER_NAMES.sequence}: ${record.sequence}`);
  lines.push(
    `${HEADER_NAMES.canary}: ${buildCanary({
      issuedAt: record.issued_at,
      sequence: record.sequence,
      organization: resolved.organization,
      nonce: record.nonce,
    })}`
  );
  lines.push(`${HEADER_NAMES.headersSha256}: ${metadata.headers_sha256}`);
  return lines;
}

/**
 * Compute the full evidence bundle from an explicit body and attachment list.
 *
 * Each attachment is hashed inside its own try/catch: one unreadable attachment
 * is reported in `skipped` and never aborts the run.
 *
 * @param {{body?: string, attachments?: Array<{name?: string, data?: *, error?: string}>,
 *          config?: object, evidenceId?: string, timestamp?: string,
 *          signature?: string|Buffer|{path: string}}} input
 *        `signature` is the raw message that carries the OpenPGP signature Thunderbird
 *        applied. When `config.pgpFingerprint` is empty it fills the claim from the
 *        signer the message actually proves, so an empty option still yields a
 *        verifiable header instead of none.
 */
function computeEvidence({
  body = '',
  attachments = [],
  config,
  evidenceId,
  timestamp,
  signature,
  recipient,
  subject = '',
  from = '',
  to = [],
  date = '',
  nonce,
  sequence = 0,
  maxAgeSeconds,
} = {}) {
  const resolved = resolveConfig(config);
  if (!resolved.pgpFingerprint && signature != null) {
    resolved.pgpFingerprint = pgpResolvedFingerprint(signature);
  }
  const bodyText = typeof body === 'string' ? body : String(body == null ? '' : body);
  const bodyHash = sha256Hex(bodyText);
  // SHA3-512 rides alongside SHA-256 as the second, stronger digest. It is not
  // Merkle input (the extension computes the root and cannot produce SHA3), so it
  // strengthens the record without changing the chain the extension already proved.
  const bodySha3 = hashHex('sha3-512', bodyText);

  const entries = [];
  const skipped = [];
  for (const attachment of attachments || []) {
    const filename = sanitizeHeaderValue((attachment && attachment.name) || 'attachment');
    if (!attachment || attachment.error) {
      skipped.push({ filename, reason: attachment && attachment.error ? attachment.error : 'UNREADABLE' });
      continue;
    }
    try {
      const data = toBuffer(attachment.data);
      entries.push({ filename, sha256: sha256Hex(data), sha3_512: hashHex('sha3-512', data) });
    } catch (error) {
      skipped.push({ filename, reason: error && error.message ? error.message : String(error) });
    }
  }

  const leaves = [bodyHash, ...entries.map((entry) => entry.sha256)];
  const merkle = merkleRoot(leaves);

  const id = sanitizeHeaderValue(evidenceId) || crypto.randomUUID();
  const stamp = timestamp || new Date().toISOString();
  // The recipient this copy is minted for: an explicit `recipient` wins, otherwise the
  // first addressee. Either way the manifest names it, so a replayed copy shows a
  // recipient that does not match the envelope it arrived in.
  const primaryRecipient = sanitizeHeaderValue(recipient) || normalizeRecipients(to)[0] || '';
  const replay = buildReplay({
    nonce,
    sequence,
    issuedAt: stamp,
    recipient: primaryRecipient,
    maxAgeSeconds,
  });
  const messageId = buildMessageId({ evidenceId: id, timestamp: stamp });
  const signedHeaders = buildSignedHeaders({
    subject,
    from,
    to,
    date: date || stamp,
    messageId,
    attachmentEntries: entries,
  });
  const provenance = buildProvenance({
    recipient: replay.recipient,
    messageId,
    evidenceId: id,
    issuedAt: replay.issued_at,
    organization: resolved.organization,
  });
  const manifest = buildManifest({
    config: resolved,
    bodyHash,
    bodySha3,
    attachmentEntries: entries,
    merkle,
    evidenceId: id,
    timestamp: stamp,
    replay,
    signedHeaders,
    provenance,
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
    timestamp: stamp,
    replay,
    signedHeaders,
  });
  const digestBlock = buildDigestBlock({ bodySha256: bodyHash, attachmentEntries: entries, timestamp: stamp });

  return {
    config: resolved,
    evidenceId: id,
    timestamp: stamp,
    bodySha256: bodyHash,
    bodySha3_512: bodySha3,
    attachments: entries,
    skipped,
    digestBlock,
    cryptoEngine: cryptoEngineCode({ merkleRoot: merkle, bodySha256: bodyHash }),
    merkleRoot: merkle,
    manifest,
    manifestText,
    manifestFilename: MANIFEST_FILENAME,
    manifestSha256: manifestHash,
    // PSEMP 1.1 additions, surfaced so a caller does not have to re-derive them.
    messageId,
    nonce: replay.nonce,
    sequence: replay.sequence,
    issuedAt: replay.issued_at,
    expiresAt: replay.expires_at,
    recipient: replay.recipient,
    canary: buildCanary({
      issuedAt: replay.issued_at,
      sequence: replay.sequence,
      organization: resolved.organization,
      nonce: replay.nonce,
    }),
    replay,
    signedHeaders,
    provenance,
    headerLines,
    headers: headerLines.map((line) => {
      const index = line.indexOf(':');
      return { name: line.slice(0, index).trim(), value: line.slice(index + 1).trim() };
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Sealing (the step a MailExtension cannot perform)
 *
 * A Thunderbird MailExtension can hash with Web Crypto and attach a manifest, but it
 * cannot run `gpg` or `ots` and Web Crypto has no SHA3-512. `seal` closes that gap on
 * the gateway side: it fills the slots the extension left null, then writes a real
 * detached signature (`.asc`) and a real OpenTimestamps proof (`.ots`) over the
 * SEALED text — not over the text the extension wrote.
 *
 * The Merkle root is deliberately NOT recomputed: it is built from SHA-256 leaves
 * only, so filling SHA3-512 leaves the root in the message header valid. A stronger
 * second digest must never invalidate the chain the recipient already has.
 * ------------------------------------------------------------------ */

/**
 * Fill the SHA3-512 slots and attach signature + timestamp proofs.
 *
 * Refuses to seal when the supplied bytes do not match the manifest: sealing a
 * manifest that describes different bytes would turn a mismatch into a certificate.
 *
 * @param {string} manifestPath The `PasevSU_Manifest.json` written by the extension.
 * @param {{body?: string|Buffer, attachments?: Array<{filename: string, data?: *}>,
 *          keyId?: string, sign?: boolean, stamp?: boolean, blake3?: string|null}} [options]
 * @returns {Promise<object>} a report; tooling that is missing is reported, not thrown.
 */
async function sealManifest(manifestPath, options = {}) {
  const target = path.resolve(manifestPath);
  if (!fs.existsSync(target)) throw new Error(`Manifest not found: ${target}`);
  const raw = fs.readFileSync(target, 'utf8');
  let claimed;
  try {
    claimed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path.basename(target)} is not valid JSON: ${error.message}`, { cause: error });
  }
  if (!claimed || typeof claimed !== 'object' || !claimed.framework || !claimed.evidence_id) {
    throw new Error(`${path.basename(target)} is not a PasevSU manifest (framework/evidence_id missing).`);
  }

  const report = {
    ok: false,
    status: 'mismatch',
    manifest: target,
    evidenceId: claimed.evidence_id,
    merkleRoot: claimed.merkle_root,
    filled: [],
    confirmed: [],
    unsealedFiles: [],
    mismatches: [],
    signature: null,
    timestamp: null,
    claimedManifestSha256: manifestSha256(raw),
    sealedManifestSha256: '',
  };

  if (options.body !== undefined && options.body !== null) {
    const actual = sha256Hex(options.body);
    if (actual !== claimed.message_sha256) {
      report.mismatches.push({
        target: 'body',
        claimed: claimed.message_sha256,
        actual,
        detail: 'The manifest describes different bytes. Refusing to seal it.',
      });
      return report;
    }
    const sha3 = hashHex('sha3-512', options.body);
    if (claimed.message_sha3_512 === sha3) {
      report.confirmed.push('message_sha3_512');
    } else {
      claimed.message_sha3_512 = sha3;
      report.filled.push('message_sha3_512');
    }
  }

  const supplied = new Map();
  for (const attachment of options.attachments || []) {
    if (!attachment || attachment.data === undefined || attachment.data === null) continue;
    supplied.set(sanitizeHeaderValue(attachment.filename), attachment.data);
  }

  claimed.attachments = (Array.isArray(claimed.attachments) ? claimed.attachments : []).map((entry) => {
    const name = sanitizeHeaderValue(entry && entry.filename);
    const data = supplied.get(name);
    if (data === undefined) {
      report.unsealedFiles.push(name);
      return entry;
    }
    const actual = sha256Hex(data);
    if (actual !== entry.sha256) {
      report.mismatches.push({ target: name, claimed: entry.sha256, actual });
      return entry;
    }
    const sha3 = hashHex('sha3-512', data);
    if (options.blake3) entry.blake3 = String(options.blake3);
    if (entry.sha3_512 === sha3) {
      report.confirmed.push(`${name}:sha3_512`);
      return entry;
    }
    entry.sha3_512 = sha3;
    report.filled.push(`${name}:sha3_512`);
    return entry;
  });

  if (report.mismatches.length > 0) return report;

  const sealedText = `${serializeManifest(claimed)}\n`;
  const changed = sealedText !== raw;
  if (changed) fs.writeFileSync(target, sealedText, 'utf8');
  report.changed = changed;
  report.sealedManifestSha256 = manifestSha256(sealedText);
  report.status = 'sealed';

  const signaturePath = `${target}.asc`;
  const proofPath = `${target}.ots`;
  // A proof written over the previous text describes a hash that no longer exists, so
  // a re-seal must never leave it in place at the live path. The signature can simply be
  // replaced (gpg --yes); the timestamp cannot, because a proof is append-only, so the
  // superseded one is moved aside rather than destroyed.
  let supersededProof = null;
  if (changed && fs.existsSync(proofPath)) {
    supersededProof = `${proofPath}.superseded`;
    fs.renameSync(proofPath, supersededProof);
  }
  report.supersededProof = supersededProof;

  if (options.sign === false) {
    report.signature = { status: 'skipped', reason: 'DISABLED' };
  } else if (!changed && fs.existsSync(signaturePath)) {
    // Second run over identical bytes: prove the existing proof still holds.
    const verified = pgpVerify(target, signaturePath);
    report.signature = verified.verified
      ? { status: 'ok', reason: 'ALREADY_SIGNED', signaturePath, verified: true, ...probeSignatureDigest(signaturePath) }
      : { status: 'failed', reason: 'STALE_SIGNATURE', signaturePath, detail: verified.stderr, verified: false };
  } else {
    report.signature = pgpSign(target, { keyId: options.keyId, digestAlgo: options.digestAlgo });
  }

  if (options.stamp === false) {
    report.timestamp = { status: 'skipped', reason: 'DISABLED' };
  } else if (!changed && fs.existsSync(proofPath)) {
    report.timestamp = { status: 'ok', reason: 'ALREADY_STAMPED', otsPath: proofPath };
  } else {
    report.timestamp = await otsStamp(target);
  }

  const signed = report.signature && report.signature.status === 'ok';
  const stamped = report.timestamp && report.timestamp.status === 'ok';
  report.ok = true;
  report.status = signed && stamped ? 'sealed' : 'sealed-partial';
  report.signaturePath = signed ? report.signature.signaturePath || signaturePath : null;
  report.proofPath = stamped ? report.timestamp.otsPath || proofPath : null;
  report.artifacts = [target, report.signaturePath, report.proofPath].filter(Boolean);
  return report;
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
    // Metadata travels into `signed_headers` so the digest covers Subject/From/To/Date
    // and the Message-ID as well as the body — a signature over the body alone would
    // let a recipient re-send it under a new subject.
    subject: appendWarMarker(source.subject),
    from: source.from,
    to: source.to || source.recipients,
    date: source.date,
    recipient: options.recipient,
    nonce: options.nonce,
    sequence: options.sequence,
  });
  source.customHeaders = [...(source.customHeaders || []), ...evidence.headerLines];
  /*
   * Mandatory on every message: the Subject ends with the marker and the body carries
   * the notice. Both are idempotent, so a second pass over the same details adds
   * nothing. The marker is applied here (not after the opt-in tag) because it must
   * remain the last thing on the Subject line.
   */
  source.subject = appendWarMarker(source.subject);
  const warField = warBodyField(source);
  const warBody = warField ? withWarNotice(source, warField) : null;
  if (warBody !== null) source[warField] = warBody;
  // Opt-in only: rewriting the Subject is visible to every recipient and breaks mail
  // threading, so the tag is never applied unless asked for explicitly (PROTOCOL.md §9).
  // It is inserted BEFORE the marker for the same reason stated above.
  if (options.tagSubject) {
    source.subject = tagSubject(source.subject, evidence.bodySha256);
  }
  return { details: source, evidence };
}

/**
 * Add the short digest tag to a Subject line, e.g. `Case 2026 [34AEF2D1]`.
 * Idempotent: running it twice does not stack tags, and the tag never lands after
 * the mandatory {@link WAR_MARKER} — the marker stays last.
 */
function tagSubject(subject, digest, length = 8) {
  const tag = `[${String(digest || '').slice(0, length).toUpperCase()}]`;
  const text = sanitizeHeaderValue(subject);
  if (!tag || tag === '[]') return text;
  if (text.includes(tag)) return text;
  if (text.includes(WAR_MARKER)) return text.replace(WAR_MARKER, `${tag} ${WAR_MARKER}`);
  return `${text} ${tag}`.trim();
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
function verifyEvidence(manifest, { body = '', attachments = [], ...options } = {}) {
  const checks = [];
  const bodyHash = sha256Hex(typeof body === 'string' ? body : String(body == null ? '' : body));
  checks.push({
    name: 'body-sha256',
    ok: bodyHash === manifest.message_sha256,
    detail: `manifest=${manifest.message_sha256} actual=${bodyHash}`,
  });

  // SHA3-512 is optional (the extension leaves it null), but when a manifest claims
  // it, the claim must match the bytes — a filled-in slot that is wrong is worse
  // than an empty one.
  if (typeof manifest.message_sha3_512 === 'string' && manifest.message_sha3_512) {
    const actual = hashHex('sha3-512', typeof body === 'string' ? body : String(body == null ? '' : body));
    checks.push({
      name: 'body-sha3-512',
      ok: actual === manifest.message_sha3_512,
      detail: `manifest=${manifest.message_sha3_512} actual=${actual}`,
    });
  }

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
    if (typeof entry.sha3_512 === 'string' && entry.sha3_512) {
      const actualSha3 = hashHex('sha3-512', match.data);
      checks.push({
        name: `attachment-sha3:${entry.filename}`,
        ok: actualSha3 === entry.sha3_512,
        detail: `manifest=${entry.sha3_512} actual=${actualSha3}`,
      });
    }
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

  /*
   * PSEMP 1.1 — the metadata digest. Checked against ITSELF first, so an edited
   * `signed_headers` block cannot verify even when the bytes still match; when the
   * caller supplies the live metadata it is compared with reality as well.
   */
  const signed = manifest.signed_headers;
  if (signed && typeof signed === 'object') {
    const { headers_sha256: declared, ...record } = signed;
    const recomputed = sha256Hex(JSON.stringify(record));
    checks.push({
      name: 'headers-sha256',
      ok: recomputed === declared,
      detail: `manifest=${declared} recomputed=${recomputed}`,
    });
    if (options.subject !== undefined || options.messageId !== undefined || options.from !== undefined) {
      const live = buildSignedHeaders({
        subject: options.subject === undefined ? record.subject : options.subject,
        from: options.from === undefined ? record.from : options.from,
        to: options.to === undefined ? record.to : options.to,
        date: options.date === undefined ? record.date : options.date,
        messageId: options.messageId === undefined ? record.message_id : options.messageId,
        attachmentEntries: claimed.map((entry) => ({ filename: entry.filename, sha256: entry.sha256 })),
      });
      checks.push({
        name: 'headers-match-message',
        ok: live.headers_sha256 === declared,
        detail: `manifest=${declared} live=${live.headers_sha256}`,
      });
      // A subject or recipient that does not match the manifest means the message was
      // re-sent under different metadata — exactly the forwarding attack the digest exists for.
      checks.push({
        name: 'subject-match',
        ok: sanitizeHeaderValue(live.subject) === sanitizeHeaderValue(record.subject),
        detail: `manifest=${record.subject} live=${live.subject}`,
      });
    }
  }

  // Replay needs a shared store to be meaningful, so it only runs when one is passed.
  if (manifest.replay && typeof manifest.replay === 'object') {
    const issued = Date.parse(manifest.replay.issued_at);
    const expires = Date.parse(manifest.replay.expires_at);
    checks.push({
      name: 'replay-window-consistent',
      ok: Number.isFinite(issued) && Number.isFinite(expires) && expires > issued,
      detail: `issued_at=${manifest.replay.issued_at} expires_at=${manifest.replay.expires_at}`,
    });
    if (options.replayGuard) {
      const verdict = verifyReplay(manifest, {
        guard: options.replayGuard,
        now: options.now,
        limits: options.limits,
      });
      checks.push({
        name: `replay:${verdict.verdict}`,
        ok: verdict.ok,
        detail: verdict.detail,
      });
    }
  }

  return { ok: checks.every((check) => check.ok), checks };
}

/* ------------------------------------------------------------------ *
 * Self-describing evidence package (PROTOCOL.md §12)
 *
 * One JSON file that answers "what is this, how was it made, how do I check it"
 * without needing this codebase. Nothing in it is a new claim: every hash is copied
 * from the manifest, so the package can be rebuilt from the manifest alone and a
 * mismatch is visible rather than hidden.
 * ------------------------------------------------------------------ */

const PACKAGE_FILENAME = 'PasevSU_Package.json';

/** Hash a sidecar (`.asc`, `.ots`) so the package names it precisely, or report absence. */
function describeSidecar(filePath, role) {
  const filename = path.basename(filePath);
  try {
    const bytes = fs.readFileSync(filePath);
    return { role, filename, sha256: sha256Hex(bytes), bytes: bytes.length, present: true };
  } catch {
    return { role, filename, sha256: null, bytes: 0, present: false };
  }
}

/**
 * Build the self-describing package from an evidence bundle or a bare manifest.
 *
 * @param {object} evidence `computeEvidence()` output, or a manifest object.
 * @param {{manifestPath?: string, bodyFilename?: string, pgpFingerprint?: string}} [options]
 *        `manifestPath` lets the package record the real `.asc`/`.ots` digests.
 * @returns {object} the package, ready for `JSON.stringify(pkg, null, 2)`
 */
function buildEvidencePackage(evidence, options = {}) {
  const source = evidence && typeof evidence === 'object' ? evidence : {};
  const manifest = source.manifest && typeof source.manifest === 'object' ? source.manifest : source;
  const replay = manifest.replay && typeof manifest.replay === 'object' ? manifest.replay : {};
  const provenance = manifest.provenance && typeof manifest.provenance === 'object' ? manifest.provenance : {};
  const manifestText = source.manifestText || serializeManifest(manifest);
  const manifestDigest = source.manifestSha256 || manifestSha256(manifestText);

  const files = [
    {
      role: 'manifest',
      filename: MANIFEST_FILENAME,
      sha256: manifestDigest,
      sha3_512: null,
      note: 'hashes and links every other file listed here',
    },
    {
      role: 'body',
      filename: sanitizeHeaderValue(options.bodyFilename) || 'message.txt',
      sha256: manifest.message_sha256 || '',
      sha3_512: manifest.message_sha3_512 || null,
    },
  ];
  for (const entry of Array.isArray(manifest.attachments) ? manifest.attachments : []) {
    files.push({
      role: 'attachment',
      filename: entry.filename,
      sha256: entry.sha256,
      sha3_512: entry.sha3_512 || null,
      blake3: entry.blake3 || null,
    });
  }

  const manifestPath = options.manifestPath ? path.resolve(String(options.manifestPath)) : '';
  const sidecar = manifestPath ? `${manifestPath}.asc` : `${MANIFEST_FILENAME}.asc`;
  const proof = manifestPath ? `${manifestPath}.ots` : `${MANIFEST_FILENAME}.ots`;

  // The canary is derived, never stored in the manifest: a bare manifest still
  // carries every input, so recompute it instead of reporting an empty field.
  const canary = sanitizeHeaderValue(options.canary)
    || sanitizeHeaderValue(source.canary)
    || (replay.nonce
      ? buildCanary({
        issuedAt: replay.issued_at || manifest.timestamp,
        sequence: replay.sequence,
        organization: provenance.organization,
        nonce: replay.nonce,
      })
      : '');

  return {
    package: 'PasevSU_Evidence_Package',
    standard: 'PSEMP',
    version: manifest.version || DEFAULTS.version,
    generated_at: new Date().toISOString(),
    algorithms: buildAlgorithms(),
    evidence: {
      evidence_id: manifest.evidence_id || '',
      message_sha256: manifest.message_sha256 || '',
      message_sha3_512: manifest.message_sha3_512 || null,
      merkle_root: manifest.merkle_root || '',
      canary,
      sequence: replay.sequence === undefined ? null : replay.sequence,
      nonce: replay.nonce || '',
      recipient: replay.recipient || provenance.recipient || '',
      issued_at: replay.issued_at || manifest.timestamp || '',
      expires_at: replay.expires_at || '',
      single_use: replay.single_use === true,
    },
    provenance,
    signed_headers: manifest.signed_headers || null,
    files,
    signature: {
      algorithm: 'OpenPGP',
      fingerprint: normalizeFingerprint(options.pgpFingerprint || ''),
      detached: describeSidecar(sidecar, 'signature'),
      note: 'A MailExtension cannot run gpg. The signature is written by psemp-gateway seal.',
    },
    timestamp: {
      algorithm: 'OpenTimestamps',
      proof: describeSidecar(proof, 'timestamp'),
      note: 'A MailExtension cannot run ots. The proof is written by psemp-gateway stamp/seal.',
    },
    verify: [
      'sha256(PasevSU_Manifest.json) must equal files[role=manifest].sha256',
      'recompute SHA-256 of the body and of every attachment; each must equal its file entry',
      'sort the hex leaves (body first, then attachments) and rebuild the Merkle root; it must equal evidence.merkle_root',
      'gpg --verify PasevSU_Manifest.json.asc PasevSU_Manifest.json',
      'ots verify PasevSU_Manifest.json.ots',
      'refuse the message again if evidence.nonce was already accepted (replay defence)',
      'compare evidence.recipient and signed_headers.to with the envelope the message arrived in',
    ],
  };
}

/** Serialise a package exactly as `buildEvidencePackage` shaped it. */
function serializePackage(pkg) {
  return JSON.stringify(pkg, null, 2);
}

/** Write the package next to a manifest; returns the path written. */
function writeEvidencePackage(targetPath, evidence, options = {}) {
  const target = path.resolve(String(targetPath || PACKAGE_FILENAME));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${serializePackage(buildEvidencePackage(evidence, options))}\n`, 'utf8');
  return target;
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
  } catch {
    // The self-contained UMD bundle shipped beside ots-manager.js is a complete
    // runtime (v0.4.9), so a missing npm package is not a limitation.
    try {
      const entry = otsRequire.resolve('./opentimestamps.min.js');
      return { available: true, entry, reason: null, vendored: true };
    } catch {
      return {
        available: false,
        entry: null,
        reason: 'OTS_RUNTIME_MISSING',
        detail:
          'Neither the npm package "opentimestamps" nor the vendored opentimestamps.min.js ' +
          'is present in psemp-gateway/packages/07-ots.',
      };
    }
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
 *
 * Thunderbird signs with the key configured in its own account settings. A
 * MailExtension cannot read that keyring — there is no WebExtension API for the
 * configured fingerprint — so `X-PasevSU-PGP-Fingerprint` is a CLAIM made by the
 * sender and the headers stay outside the signed MIME entity. The helpers below
 * close that gap on the receiving side: `pgpInspectMessage` reports who actually
 * signed, `pgpCrossCheck` compares that with the claim, and `pgpSign` refuses to
 * add a second signature to a message Thunderbird already signed.
 * ------------------------------------------------------------------ */

let gpgCache;
let gpgCacheKey;

function findExecutable(name) {
  const extensions = process.platform === 'win32' ? ['.exe', ''] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, name + extension);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null;
}

/**
 * The environment the cached answer was computed from.
 *
 * A bare memo would pin the first answer for the life of the process, so a gateway
 * that starts before GnuPG is installed would report GPG_NOT_FOUND forever, and a
 * caller that extends PATH would still be told there is no gpg. Keying the cache on
 * PATH keeps the saving without keeping the staleness.
 */
function pgpCacheKey() {
  return `${process.env.PATH || ''}\u0000${process.env.PATHEXT || ''}`;
}

/** Detect a usable `gpg` binary. */
function pgpStatus() {
  const key = pgpCacheKey();
  if (gpgCache && gpgCacheKey === key) return gpgCache;
  const executable = findExecutable('gpg') || findExecutable('gpg2');
  if (!executable) {
    gpgCache = {
      available: false,
      executable: null,
      reason: 'GPG_NOT_FOUND',
      detail: 'No gpg/gpg2 binary on PATH. Install GnuPG or run OpenPGP.js after building packages/15-openpgpjs.',
    };
    gpgCacheKey = key;
    return gpgCache;
  }
  const probe = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  gpgCache = {
    available: probe.status === 0,
    executable,
    version: probe.status === 0 ? String(probe.stdout).split(/\r?\n/)[0] : null,
    reason: probe.status === 0 ? null : 'GPG_PROBE_FAILED',
  };
  gpgCacheKey = key;
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

const PGP_MARKERS = Object.freeze({
  clearsigned: '-----BEGIN PGP SIGNED MESSAGE-----',
  signature: '-----BEGIN PGP SIGNATURE-----',
  signatureEnd: '-----END PGP SIGNATURE-----',
});

/** Message text or bytes, or `{ path }` to read a file from disk. */
function toEvidenceBuffer(input) {
  if (input && typeof input === 'object' && !Buffer.isBuffer(input) && typeof input.path === 'string') {
    return fs.readFileSync(input.path);
  }
  return Buffer.from(toBuffer(input));
}

/**
 * Find the OpenPGP signature a mail client (usually Thunderbird) already applied.
 * Pure text inspection, so it works with no gpg binary present.
 *
 * Formats: `pgp-mime` (multipart/signed + application/pgp-signature),
 * `inline` (clearsigned), `armored-only` (a detached block pasted in the body).
 */
function detectPgpSignature(input) {
  const text = toEvidenceBuffer(input).toString('latin1');
  const multipartSigned = /content-type:\s*multipart\/signed/i.test(text);
  const signaturePart = /content-type:\s*application\/pgp-signature/i.test(text);
  const clearsigned = text.includes(PGP_MARKERS.clearsigned);
  const armored = text.includes(PGP_MARKERS.signature);

  let format = null;
  if (multipartSigned && signaturePart) format = 'pgp-mime';
  else if (clearsigned) format = 'inline';
  else if (armored) format = 'armored-only';

  return {
    signed: format !== null,
    format,
    multipartSigned,
    signaturePart,
    clearsigned,
    armored,
  };
}

/** Cut the armored signature block, or base64-decode the PGP/MIME signature part. */
function extractPgpSignatureBlock(input) {
  const text = toEvidenceBuffer(input).toString('latin1');
  const start = text.indexOf(PGP_MARKERS.signature);
  if (start !== -1) {
    const end = text.indexOf(PGP_MARKERS.signatureEnd, start);
    const slice = end === -1 ? text.slice(start) : text.slice(start, end + PGP_MARKERS.signatureEnd.length);
    return { kind: 'armored', data: `${slice}\n` };
  }

  const partAt = text.search(/content-type:\s*application\/pgp-signature/i);
  if (partAt === -1) return null;
  // Real messages end their headers with CRLF; a bare "\n\n" search misses them.
  const separator = /\r?\n\r?\n/g;
  separator.lastIndex = partAt;
  const match = separator.exec(text);
  if (!match) return null;
  const remainder = text.slice(match.index + match[0].length);
  const boundaryAt = remainder.search(/^--/m);
  const body = (boundaryAt === -1 ? remainder : remainder.slice(0, boundaryAt)).replace(/\s+/g, '');
  if (!body) return null;
  const decoded = Buffer.from(body, 'base64');
  if (!decoded.length) return null;
  return { kind: 'binary', data: decoded };
}

/** Base64 payload of an armored block, minus the header, the CRC line and the footer. */
function armorPayloadToBytes(armored) {
  const text = String(armored);
  const start = text.indexOf(PGP_MARKERS.signature);
  const from = start === -1 ? 0 : start + PGP_MARKERS.signature.length;
  const end = text.indexOf(PGP_MARKERS.signatureEnd, from);
  const body = text.slice(from, end === -1 ? undefined : end);
  const base64 = body
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('=') && !/^[A-Za-z-]+:/.test(line))
    .join('');
  return Buffer.from(base64, 'base64');
}

/** Split an OpenPGP message into packets, old and new format headers both accepted. */
function readPgpPackets(bytes) {
  const packets = [];
  let offset = 0;
  while (offset < bytes.length) {
    const header = bytes[offset];
    if (!(header & 0x80)) break;
    let tag;
    let length;
    let cursor;
    if (header & 0x40) {
      tag = header & 0x3f;
      cursor = offset + 1;
      if (cursor >= bytes.length) break;
      const first = bytes[cursor];
      cursor += 1;
      if (first < 192) {
        length = first;
      } else if (first < 224) {
        if (cursor >= bytes.length) break;
        length = ((first - 192) << 8) + bytes[cursor] + 192;
        cursor += 1;
      } else if (first === 255) {
        if (cursor + 4 > bytes.length) break;
        length = bytes.readUInt32BE(cursor);
        cursor += 4;
      } else {
        // Partial body lengths only appear on large literal data, never on a signature.
        break;
      }
    } else {
      tag = (header >> 2) & 0x0f;
      const lengthType = header & 0x03;
      cursor = offset + 1;
      if (lengthType === 0) {
        if (cursor >= bytes.length) break;
        length = bytes[cursor];
        cursor += 1;
      } else if (lengthType === 1) {
        if (cursor + 2 > bytes.length) break;
        length = bytes.readUInt16BE(cursor);
        cursor += 2;
      } else if (lengthType === 2) {
        if (cursor + 4 > bytes.length) break;
        length = bytes.readUInt32BE(cursor);
        cursor += 4;
      } else {
        length = bytes.length - cursor;
      }
    }
    if (cursor + length > bytes.length) break;
    packets.push({ tag, body: bytes.subarray(cursor, cursor + length) });
    offset = cursor + length;
  }
  return packets;
}

/** Issuer key ID (type 16) and issuer fingerprint (type 33) live in the subpackets. */
function parseSignatureSubpackets(bytes, start, end) {
  const found = { issuerFingerprint: null, issuerKeyId: null };
  let offset = start;
  while (offset < end && offset < bytes.length) {
    const first = bytes[offset];
    let length;
    let cursor = offset + 1;
    if (first < 192) {
      length = first;
    } else if (first < 255) {
      if (cursor >= bytes.length) break;
      length = ((first - 192) << 8) + bytes[cursor] + 192;
      cursor += 1;
    } else {
      if (cursor + 4 > bytes.length) break;
      length = bytes.readUInt32BE(cursor);
      cursor += 4;
    }
    if (!length || cursor + length > bytes.length || cursor + length > end) break;
    const type = bytes[cursor] & 0x7f;
    const body = bytes.subarray(cursor + 1, cursor + length);
    if (type === 33 && body.length >= 21) {
      found.issuerFingerprint = body.subarray(1).toString('hex').toUpperCase();
    } else if (type === 16 && body.length >= 8) {
      found.issuerKeyId = body.subarray(0, 8).toString('hex').toUpperCase();
    }
    offset = cursor + length;
  }
  return found;
}

/**
 * Read the signer straight out of an OpenPGP signature packet.
 *
 * This is the reason a fingerprint is available on a machine where Thunderbird
 * signs outgoing mail but no gpg binary is installed: the issuer fingerprint and
 * key ID are plain subpacket fields, not something that needs a keyring.
 * @param {Buffer|string} signatureData raw signature bytes, or an armored block
 */
function parseOpenPgpSignatures(signatureData) {
  const bytes = Buffer.isBuffer(signatureData) ? signatureData : armorPayloadToBytes(signatureData);
  const signatures = [];
  for (const packet of readPgpPackets(bytes)) {
    if (packet.tag !== 2) continue;
    const body = packet.body;
    const version = body[0];
    const signature = { version, sigType: null, issuerFingerprint: null, issuerKeyId: null };
    if (version === 3) {
      if (body.length >= 15) {
        signature.sigType = body[2];
        signature.issuerKeyId = body.subarray(7, 15).toString('hex').toUpperCase();
      }
    } else if (version === 4 || version === 5) {
      if (body.length >= 6) {
        signature.sigType = body[1];
        signature.pubAlg = body[2];
        signature.hashAlg = body[3];
        const hashedLength = body.readUInt16BE(4);
        const hashedStart = 6;
        const hashedEnd = hashedStart + hashedLength;
        if (hashedEnd + 2 <= body.length) {
          Object.assign(signature, parseSignatureSubpackets(body, hashedStart, hashedEnd));
          const unhashedLength = body.readUInt16BE(hashedEnd);
          const unhashedStart = hashedEnd + 2;
          const unhashedEnd = Math.min(body.length, unhashedStart + unhashedLength);
          const unhashed = parseSignatureSubpackets(body, unhashedStart, unhashedEnd);
          signature.issuerFingerprint = signature.issuerFingerprint || unhashed.issuerFingerprint;
          signature.issuerKeyId = signature.issuerKeyId || unhashed.issuerKeyId;
        }
      }
    }
    signatures.push(signature);
  }
  return signatures;
}

/**
 * Report the signer of a message Thunderbird signed. The issuer fingerprint comes
 * out of the signature packet itself; gpg is only consulted when the packet does
 * not carry one. A fingerprint is never guessed.
 */
function pgpInspectMessage(input) {
  const detection = detectPgpSignature(input);
  const base = { ...detection, issuerFingerprint: null, issuerKeyId: null, signerSource: null, reason: null };
  if (!detection.signed) return { ...base, reason: 'NO_SIGNATURE' };

  const block = extractPgpSignatureBlock(input);
  if (!block) return { ...base, reason: 'SIGNATURE_BLOCK_UNREADABLE' };

  // Preferred: read the issuer out of the signature packet. No subprocess, no temp
  // files, and it works on a machine that has Thunderbird but no gpg binary.
  const signatures = parseOpenPgpSignatures(block.data);
  const signer = signatures.find((entry) => entry.issuerFingerprint || entry.issuerKeyId);
  if (signer) {
    return {
      ...base,
      issuerFingerprint: signer.issuerFingerprint,
      issuerKeyId: signer.issuerKeyId,
      signerSource: 'signature-packet',
      reason: null,
    };
  }

  const status = pgpStatus();
  if (!status.available) {
    return {
      ...base,
      reason: signatures.length ? 'NO_ISSUER_IN_SIGNATURE' : status.reason,
      detail: signatures.length ? 'the signature packet carries no issuer subpacket' : status.detail,
    };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psemp-pgp-'));
  try {
    const file = path.join(dir, block.kind === 'armored' ? 'signature.asc' : 'signature.pgp');
    fs.writeFileSync(file, block.data);
    const result = gpgRun(['--batch', '--list-packets', file]);
    if (result.status !== 'ok') {
      return { ...base, reason: 'GPG_LIST_PACKETS_FAILED', detail: result.stderr || result.status };
    }
    const fingerprint = /issuer fpr v\d+\s+([0-9A-Fa-f]+)/.exec(result.stdout);
    const keyId = /issuer key ID\s+([0-9A-Fa-f]+)/.exec(result.stdout);
    return {
      ...base,
      issuerFingerprint: fingerprint ? fingerprint[1].toUpperCase() : null,
      issuerKeyId: keyId ? keyId[1].toUpperCase() : null,
      signerSource: 'gpg --list-packets',
      reason: fingerprint || keyId ? null : 'NO_ISSUER_IN_SIGNATURE',
    };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // A leftover temp directory is not worth failing a verification for.
    }
  }
}

/** `0x` prefix, spaces and colons are all noise when comparing fingerprints. */
function normalizeFingerprint(value) {
  return String(value == null ? '' : value)
    .replace(/[\s:]/g, '')
    .replace(/^0x/i, '')
    .toUpperCase();
}

/**
 * Compare the `X-PasevSU-PGP-Fingerprint` claim with the signer Thunderbird
 * actually used. A short key ID matches the tail of the full fingerprint, which
 * is the same rule gpg itself uses to display keys.
 */
function pgpCrossCheck(input, { fingerprint = '', keyId = '' } = {}) {
  const info = pgpInspectMessage(input);
  const checks = [
    {
      name: 'signature-present',
      ok: info.signed,
      detail: info.signed ? info.format : 'no OpenPGP signature found in the message',
    },
  ];
  if (!info.signed) return { ok: false, checks, info };

  const claimed = normalizeFingerprint(fingerprint || keyId);
  const detected = normalizeFingerprint(info.issuerFingerprint || info.issuerKeyId);

  if (!detected) {
    checks.push({
      name: 'fingerprint-verifiable',
      ok: false,
      detail: `signature present but the signer is not readable (${info.reason || 'UNKNOWN'})`,
    });
  } else if (!claimed) {
    checks.push({
      name: 'fingerprint-claimed',
      ok: false,
      detail: `no X-PasevSU-PGP-Fingerprint claim to compare; signer is ${detected}`,
    });
  } else {
    const match = detected === claimed || detected.endsWith(claimed) || claimed.endsWith(detected);
    checks.push({
      name: 'fingerprint-match',
      ok: match,
      detail: `claim=${claimed} signer=${detected}`,
    });
  }

  return { ok: checks.every((check) => check.ok), checks, info };
}

/**
 * The fingerprint to emit when the sender left `pgpFingerprint` empty.
 *
 * Thunderbird signs outgoing mail with the key configured in the account, and a
 * MailExtension cannot read that keyring — no WebExtension API exposes it. So the
 * only trustworthy source is the signature on the delivered message: this reads the
 * issuer straight out of the OpenPGP packet instead of trusting a claim.
 * @returns {string} normalised fingerprint, or '' when nothing is readable.
 */
function pgpResolvedFingerprint(input) {
  const info = pgpInspectMessage(input);
  if (!info.signed) return '';
  return normalizeFingerprint(info.issuerFingerprint || info.issuerKeyId);
}

const DIGEST_NAMES = Object.freeze({
  1: 'MD5',
  2: 'SHA-1',
  3: 'RIPEMD-160',
  8: 'SHA-256',
  9: 'SHA-384',
  10: 'SHA-512',
  11: 'SHA-224',
});

/**
 * Read the digest algorithm gpg ACTUALLY used, rather than claiming one.
 *
 * Signing strength comes from the key and the digest gpg picks for it, so a report
 * must state the digest found in the signature packet, never the one requested.
 * A wrong name is not a stronger name: gpg answers `--digest-algo SHA-512` with
 * "selected digest algorithm is invalid" (exit 2) because it spells digests without
 * punctuation, and a failed sign leaves the manifest unsigned.
 */
function probeSignatureDigest(signaturePath) {
  const listing = gpgRun(['--batch', '--list-packets', path.resolve(signaturePath)]);
  if (listing.status !== 'ok') {
    return { digestAlgo: null, digestSource: 'unavailable', digestDetail: listing.reason || listing.stderr };
  }
  const match = /digest algo (\d+)/.exec(listing.stdout);
  if (!match) return { digestAlgo: null, digestSource: 'unparsed' };
  const id = Number(match[1]);
  return { digestAlgo: DIGEST_NAMES[id] || `alg-${id}`, digestId: id, digestSource: 'gpg --list-packets' };
}

/**
 * gpg's own digest names, which carry no punctuation.
 *
 * Measured against gpg 2.5.24: SHA512, SHA384, SHA256, SHA224, SHA1, MD5 and
 * RIPEMD160 sign; SHA-512 (hyphenated), SHA3-256, SHA3-512 and SHAKE256 are all
 * rejected. SHA3 has no OpenPGP signature packet yet, so the manifest's SHA3-512
 * rides alongside the signature as a second content digest instead of inside it.
 */
const GPG_DIGEST_ALGO = Object.freeze({
  MD5: 'MD5',
  SHA1: 'SHA1',
  'SHA-1': 'SHA1',
  RIPEMD160: 'RIPEMD160',
  'RIPEMD-160': 'RIPEMD160',
  SHA224: 'SHA224',
  'SHA-224': 'SHA224',
  SHA256: 'SHA256',
  'SHA-256': 'SHA256',
  SHA384: 'SHA384',
  'SHA-384': 'SHA384',
  SHA512: 'SHA512',
  'SHA-512': 'SHA512',
});

/** `{ name }` for gpg, or `{ error }` when no signature packet can carry it. */
function normalizeDigestAlgo(requested) {
  if (requested === undefined || requested === null || requested === '') return { name: 'SHA512', requested: null };
  const key = String(requested).trim().toUpperCase();
  const name = GPG_DIGEST_ALGO[key];
  if (!name) return { error: 'UNSUPPORTED_DIGEST', requested: String(requested) };
  return { name, requested: String(requested) };
}

/**
 * Detached-sign a file. Writes `<file>.asc` next to it unless `outputPath` is given.
 *
 * The digest defaults to SHA-512, the strongest gpg can put in an OpenPGP signature
 * today, spelled the way gpg accepts it. `digestAlgo` may override it with any name
 * in GPG_DIGEST_ALGO; anything else is refused up front instead of failing in gpg.
 * The returned `digestAlgo` is read back out of the signature, so it is the truth on
 * the wire rather than an echo of the request.
 *
 * Refuses to sign something that already carries an OpenPGP signature: Thunderbird
 * signs with the key configured in the account, and a second signature stacked on
 * top makes both harder to verify. Pass `force: true` to sign regardless.
 * @returns {{status: string, signaturePath?: string, digestAlgo?: string|null,
 *   digestSource?: string, reason?: string}}
 */
function pgpSign(file, { keyId, outputPath, armor = true, force = false, digestAlgo } = {}) {
  const input = path.resolve(file);
  const existing = force ? null : detectPgpSignature({ path: input });
  if (existing && existing.signed) {
    return {
      status: 'skipped',
      reason: 'ALREADY_SIGNED',
      format: existing.format,
      input,
      detail:
        'The message already carries an OpenPGP signature, normally the one Thunderbird added. ' +
        'Signing again would stack a second signature; pass force:true to sign anyway.',
    };
  }

  const digest = normalizeDigestAlgo(digestAlgo);
  if (digest.error) {
    return {
      status: 'failed',
      reason: digest.error,
      detail:
        `No OpenPGP signature packet can carry ${digest.requested}. ` +
        `Supported: ${Object.keys(GPG_DIGEST_ALGO).filter((name) => !name.includes('-')).join(', ')}.`,
    };
  }
  const status = pgpStatus();
  if (!status.available) return { status: 'unavailable', reason: status.reason, detail: status.detail };
  const target = path.resolve(outputPath || `${input}.asc`);
  const args = ['--batch', '--yes', '--detach-sign'];
  if (armor) args.push('--armor');
  args.push('--digest-algo', digest.name);
  if (keyId) args.push('--local-user', String(keyId));
  args.push('--output', target, input);
  const result = gpgRun(args);
  if (result.status !== 'ok') return result;
  const probed = probeSignatureDigest(target);
  return {
    status: 'ok',
    signaturePath: target,
    executable: result.executable,
    digestRequested: digest.requested || digest.name,
    ...probed,
  };
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
    // The gateway computes the SHA3-512 slots a MailExtension cannot, so the contract
    // is that both digest sets are present and both cover the same bytes.
    assert(
      evidence.manifest.message_sha3_512 === hashHex('sha3-512', 'Hello evidence'),
      'the gateway must fill the body SHA3-512 slot'
    );
    assert(
      evidence.manifest.attachments[0].sha3_512 === hashHex('sha3-512', 'attached bytes'),
      'the gateway must fill the attachment SHA3-512 slot'
    );
    assert(evidence.manifest.attachments[0].blake3 === null, 'BLAKE3 stays null without an implementation');
    const expectedManifest = [
      '{',
      '  "framework": "PasevSU",',
      '  "version": "1.0",',
      `  "message_sha256": "${evidence.bodySha256}",`,
      `  "message_sha3_512": "${evidence.manifest.message_sha3_512}",`,
      '  "attachments": [',
      '    {',
      '      "filename": "note.txt",',
      `      "sha256": "${evidence.attachments[0].sha256}",`,
      `      "sha3_512": "${evidence.manifest.attachments[0].sha3_512}",`,
      '      "blake3": null',
      '    }',
      '  ],',
      `  "merkle_root": "${evidence.merkleRoot}",`,
      '  "timestamp": "2026-01-01T00:00:00.000Z",',
      '  "evidence_id": "11111111-2222-4333-8444-555555555555"',
    ].join('\n');
    // The PSEMP v1.1 block is APPENDED after evidence_id, so the text above stays the
    // literal contract and the tail is asserted in place rather than re-typed by hand.
    const tail = JSON.stringify(
      {
        algorithms: evidence.manifest.algorithms,
        provenance: evidence.manifest.provenance,
        signed_headers: evidence.manifest.signed_headers,
        replay: evidence.manifest.replay,
      },
      null,
      2
    )
      .split('\n')
      .slice(1, -1)
      .join('\n');
    assert(
      evidence.manifestText === `${expectedManifest},\n${tail}\n}`,
      'manifest serialisation drifted from the extension contract'
    );
    // Key ORDER is the real contract between the two engines, so pin it explicitly.
    assert(
      JSON.stringify(Object.keys(evidence.manifest)) ===
        JSON.stringify([
          'framework',
          'version',
          'message_sha256',
          'message_sha3_512',
          'attachments',
          'merkle_root',
          'timestamp',
          'evidence_id',
          'algorithms',
          'provenance',
          'signed_headers',
          'replay',
        ]),
      'manifest key order is the cross-engine contract'
    );
    assert(verifyManifest(evidence.manifestText, evidence.manifestSha256).ok, 'manifest hash must verify');
    const names = evidence.headers.map((header) => header.name);
    assert(names.includes('X-PasevSU-OTS'), 'enableOts must add the pending marker');
    assert(names.includes('X-PasevSU-PGP-Fingerprint'), 'non-empty fingerprint must be emitted');
    // Build sits at #2, so everything after it shifts by one. Pin the exact prefix
    // rather than one magic index: the order IS the cross-engine contract. The
    // gateway adds the real (unprefixed) PasevSU-WAR field, so it appears here too.
    assert(
      JSON.stringify(names.slice(0, 9)) ===
        JSON.stringify([
          'X-PasevSU-Version',
          'X-PasevSU-Build',
          'X-PasevSU-Framework',
          'X-PasevSU-Origin',
          'X-PasevSU-Organization',
          'PasevSU-WAR',
          'X-PasevSU-WAR',
          'X-PasevSU-Evidence-ID',
          'X-PasevSU-Body-SHA256',
        ]),
      'header order changed'
    );
    return `${names.length} headers`;
  });

  record('war-marker-and-notice', () => {
    // "винаги да се вписва": the Subject marker and the body notice are unconditional,
    // and both are idempotent because onBeforeSend can fire more than once.
    const { details } = applyToComposeDetails(
      { subject: 'Case 2026', body: 'plain body', isPlainText: true, plainTextBody: 'plain body', customHeaders: [] },
      { config: { enableOts: false } }
    );
    const marked = `Case 2026 ${WAR_MARKER}`;
    assert(details.subject === marked, `Subject must end with the marker: ${details.subject}`);
    // A plain-text composer gets the text notice in its text field — never HTML tags.
    assert(details.plainTextBody.endsWith(WAR_NOTICE_TEXT), 'the notice must close the plain-text body');
    assert(!details.plainTextBody.includes('<div'), 'a plain-text body must not receive HTML');
    assert(
      details.plainTextBody.split(WAR_MARKER).length - 1 === 1,
      'the marker must appear exactly once in a plain-text body (inside the notice)'
    );
    assert(
      details.customHeaders.filter((line) => line.startsWith(`${HEADER_NAMES.war}:`)).length === 1,
      'exactly one war header per message'
    );
    const again = applyToComposeDetails(details, { config: { enableOts: false } });
    assert(again.details.subject === marked, 'a second pass must not stack markers');
    assert(again.details.plainTextBody === details.plainTextBody, 'a second pass must not stack notices');
    // The opt-in tag must never land after the marker.
    const tagged = applyToComposeDetails(
      { subject: 'Case', body: 'b', isPlainText: true },
      { config: { enableOts: false }, tagSubject: true }
    );
    assert(tagged.details.subject.endsWith(WAR_MARKER), 'the marker must stay last after the opt-in tag');
    // Composing the message allows the real field; the X- twin must accompany it.
    const lines = buildHeaderLines({ config: {}, evidenceId: '11111111-2222-4333-8444-555555555555' });
    assert(lines.some((line) => line.startsWith('PasevSU-WAR: ')), 'the gateway must emit the unprefixed field');
    assert(
      lines.some((line) => line.startsWith(`${HEADER_NAMES.war}: `)),
      'the gateway must also emit the X- twin the extension ships'
    );
    for (const line of lines) {
      assert(!/[^\x20-\x7E]/.test(line), `war headers must stay ASCII to survive every transport: ${line}`);
    }
    return `${WAR_SIGNER} / ${WAR_STANDARD}`;
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

  record('digest-block-and-crypto-engine', () => {
    // The requested shape: one readable block with the body digest, one row per
    // file and the instant the seal was taken, plus the same block encrypted under
    // a 25-digit code derived from the seal itself.
    const evidence = computeEvidence({
      body: 'Hello evidence',
      attachments: [
        { name: 'note.txt', data: Buffer.from('attached bytes', 'utf8') },
        { name: 'index,odd.txt', data: Buffer.from('odd bytes', 'utf8') },
      ],
      config: { version: '1.0' },
      evidenceId: '11111111-2222-4333-8444-555555555555',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const byName = new Map(evidence.headers.map((header) => [header.name, header.value]));

    const block = byName.get(HEADER_NAMES.sha256Block);
    assert(typeof block === 'string', 'the readable block must be emitted');
    const rows = block.split(',');
    assert(rows.length === 4, `expected body + 2 files + timestep, got ${rows.length} rows`);
    assert(rows[0] === `body - ${evidence.bodySha256}`, 'the first row must be the body digest');
    assert(rows[1] === `note.txt - ${evidence.attachments[0].sha256}`, 'one row per readable file');
    // A comma in a file name is escaped, otherwise the row count lies.
    assert(
      rows[2] === `index_odd.txt - ${evidence.attachments[1].sha256}`,
      'a comma in a file name must not split the row'
    );
    assert(rows[3] === 'timestep - 2026-01-01T00:00:00.000Z', 'the last row must be the timestep');

    const engine = byName.get(HEADER_NAMES.criptoEngine);
    assert(/^[0-9]{25}$/.test(engine), `engine code must be 25 digits: ${engine}`);
    assert(
      engine === cryptoEngineCode({ merkleRoot: evidence.merkleRoot, bodySha256: evidence.bodySha256 }),
      'a recipient must be able to derive the code from the seal they already hold'
    );

    const title = byName.get(HEADER_NAMES.criptoTitle);
    assert(/^gcm1\./.test(title), 'the encrypted title must use the gcm1 wire format');
    assert(
      decryptDigestBlock(engine, title, { merkleRoot: evidence.merkleRoot }).join(',') === block,
      'the title must open to exactly the readable block'
    );
    const wrong = engine === '0000000000000000000000000' ? '1111111111111111111111111' : '0000000000000000000000000';
    let refused = false;
    try {
      decryptDigestBlock(wrong, title, { merkleRoot: evidence.merkleRoot });
    } catch {
      refused = true;
    }
    assert(refused, 'a foreign code must not open the title');

    // Composing the message allows the real field; the X- twin is what a MailExtension can emit.
    const messageId = byName.get('Message-ID');
    assert(messageId === byName.get(HEADER_NAMES.messageId), 'the real and X- Message-ID must agree');
    assert(messageId.length > 90, `message id must be long, got ${messageId.length}`);
    assert(/[+_~]/.test(messageId), 'message id must carry non-standard characters');
    return `engine ${engine}`;
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
  MDN_HEADER,
  MANIFEST_FILENAME,
  WAR_MARKER,
  WAR_SIGNER,
  WAR_STANDARD,
  WAR_HEADER_TEXT,
  WAR_NOTICE_TEXT,
  WAR_NOTICE_HTML,
  appendWarMarker,
  warBodyField,
  withWarNotice,
  ALGORITHMS,
  PACKAGES_DIR,
  SETTINGS_PATH,
  loadSettings,
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
  buildDigestBlock,
  buildMessageId,
  cryptoEngineCode,
  encryptDigestBlock,
  decryptDigestBlock,
  joinBlock,
  parseBlock,
  computeEvidence,
  applyToComposeDetails,
  sealManifest,
  verifyManifest,
  verifyEvidence,
  // PSEMP 1.1: replay, cryptographic time, watermark, canary, metadata digest
  REPLAY_DEFAULTS,
  ReplayGuard,
  buildAlgorithms,
  buildProvenance,
  buildSignedHeaders,
  buildCanary,
  buildReplay,
  verifyReplay,
  tagSubject,
  normalizeRecipients,
  addressText,
  // self-describing package
  PACKAGE_FILENAME,
  buildEvidencePackage,
  serializePackage,
  writeEvidencePackage,
  // adapters
  otsStatus,
  otsSidecar,
  otsStamp,
  otsVerify,
  otsUpgrade,
  pgpStatus,
  pgpSign,
  pgpVerify,
  probeSignatureDigest,
  normalizeDigestAlgo,
  detectPgpSignature,
  extractPgpSignatureBlock,
  pgpInspectMessage,
  parseOpenPgpSignatures,
  pgpCrossCheck,
  pgpResolvedFingerprint,
  normalizeFingerprint,
  emailEvidence,
  // diagnostics
  selfTest,
};
