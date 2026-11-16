/*
 * PasevSU Forensic Mail Framework — Thunderbird MailExtension
 *
 * Injects forensic/cryptographic headers and a PasevSU_Manifest.json attachment
 * into EVERY outgoing email, transparently on send (no per-message opt-in).
 *
 * This is a Thunderbird MailExtension. It uses only WebExtension APIs and the
 * Web Crypto API — no require(), no Node modules.
 *
 * What this extension CAN do (in-browser):
 *   - SHA-256 of the body and of each attachment (Web Crypto).
 *   - Merkle root over the sorted leaf hashes.
 *   - Build and attach PasevSU_Manifest.json, plus its SHA-256.
 *   - Generate a per-message Evidence-ID (UUID v4) and a long Message-ID.
 *   - Sign the ENVELOPE, not just the body: Subject, From, To, Date, Message-ID
 *     and the attachment set go into manifest.signed_headers, published as
 *     X-PasevSU-Headers-SHA256. Rewriting any of them breaks the seal.
 *   - Replay defence, always on: a 128-bit nonce, a per-sender monotonic
 *     sequence, a Created/Expires freshness window and recipient binding, all
 *     recorded in manifest.replay. REPLAY_DEFAULTS is deliberately NOT a user
 *     setting — an optional anti-replay check is off in the messages that matter.
 *   - A derived canary token (X-PasevSU-Canary) naming this copy, so a leaked
 *     print or export traces back to the transmission it came from.
 *   - The readable digest block plus a 25-digit derived crypto-engine code and
 *     its AES-256-GCM twin (X-PasevSU-Cripto-title).
 *
 * What it CANNOT do (documented, done by the SMTP gateway / CLI):
 *   - Real OpenPGP signatures (.asc) and OpenTimestamps (.ots) cannot be
 *     produced inside a MailExtension; X-PasevSU-OTS is a "pending" marker only.
 *     `psemp-gateway seal` replaces that marker with a real .asc + .ots pair.
 *   - SHA3-512 and BLAKE3 are not available in Web Crypto; the manifest records
 *     "sha3_512": null and "blake3": null so the gateway can fill them in.
 *   - No nonce STORE: this can publish nonce/sequence, but enforcing single-use
 *     needs a store that outlives the compose window. `psemp-gateway` owns it.
 *   - No confidentiality. Encryption is Thunderbird's OpenPGP, not ours; the
 *     crypto engine below is obfuscation for header scanners, never secrecy.
 *
 * Specification: ../psemp-gateway/PROTOCOL.md
 */

const DEFAULTS = {
  version: "1.0",
  framework: "Forensic-Mail",
  origin: "Thunderbird",
  organization: "PasevSU",
  pgpFingerprint: "",
  // On by default: every message is marked for the gateway so nothing has to be
  // remembered per message. Untick it in the options page to stop marking.
  enableOts: true,
  // Delivery receipt (MDN). On by default for the same reason — a receipt is asked
  // for on every message instead of per message. The address is the identity the
  // message is sent from; `receiptAddress` is only the fallback for when
  // Thunderbird does not fill `details.from`.
  enableReceipt: true,
  receiptAddress: "",
};

const MANIFEST_FILENAME = "PasevSU_Manifest.json";

/*
 * The war notice — mandatory on EVERY message, never a per-message choice. Three
 * places carry it, and all three are unconditional:
 *   1. the Subject always ends with WAR_MARKER,
 *   2. the body always ends with the notice that speaks the prohibition out loud,
 *   3. the header always explains what the marker means.
 *
 * The header is `X-PasevSU-WAR` and not `PasevSU-WAR` because Thunderbird's
 * ComposeDetails.customHeaders rejects a name that does not start with "X-" or
 * "List-", and a rejected setComposeDetails() aborts the send with no dialog at all.
 * psemp-gateway speaks raw SMTP, so it writes the unprefixed `PasevSU-WAR:` as well —
 * the same twin arrangement `Message-ID` already has.
 *
 * The wording is a REQUIREMENT, not a claim that a signature exists: this add-on
 * cannot sign, Thunderbird's built-in OpenPGP does that per identity. Saying "this
 * message is signed" would be false whenever the sender has signing switched off,
 * and a forensic header that can be false is worth nothing.
 */
const WAR_MARKER = "{{ PasevSU-WAR }}";
const WAR_SIGNER = "pasevdenislav@gmail.com";
const WAR_STANDARD = "OpenPGP/MIME signed message (RFC 4880 and 3156)";

/*
 * The three sentences below are the whole statement, and they are the CONTRACT.
 * psemp-gateway/api.js must produce byte-identical values for WAR_HEADER_TEXT,
 * WAR_NOTICE_TEXT and WAR_NOTICE_HTML — tests/extension-arming.cjs fails otherwise.
 * Keeping them as separate sentences means the plain-text notice and the HTML
 * notice can never drift apart in wording, only in markup.
 */
const WAR_NO_SIGNATURE =
  `An email that does not carry the ${WAR_STANDARD} signature made with the PGP ` +
  `key registered to ${WAR_SIGNER} is not ours.`;
const WAR_PROOF =
  `Only that signature proves our identity and preserves the integrity of the message.`;
const WAR_FORBIDDEN = `FORWARDING THIS EMAIL IS STRICTLY FORBIDDEN.`;

/* One line, no CR/LF, ASCII only: it has to survive every transport unchanged. */
const WAR_HEADER_TEXT =
  `${WAR_NO_SIGNATURE} ${WAR_PROOF} FORWARDING THIS EMAIL IS STRICTLY FORBIDDEN ` +
  `AND IS STATED EXPLICITLY IN THE EMAIL BODY. ${WAR_MARKER}`;

/*
 * Exact suffix of every outgoing plain-text body. A verifier reproduces
 * X-PasevSU-Body-SHA256 by removing this whole constant with `endsWith`, never by
 * searching for a substring — the marker alone is not a safe cut point, because an
 * authored body is allowed to contain the marker too.
 */
const WAR_NOTICE_TEXT =
  `\n\n${WAR_MARKER}\n${WAR_NO_SIGNATURE}\n${WAR_PROOF}\n${WAR_FORBIDDEN}\n`;

/* Same wording, markup only: same signer as a mailto link, same prohibition. */
const WAR_NOTICE_HTML =
  `<div class="pasevsu-war" data-pasevsu-war="1" style="margin-top:16px;` +
  `padding-top:8px;border-top:1px solid #999;font-size:smaller">` +
  `<p><strong>${WAR_MARKER}</strong></p>` +
  `<p>An email that does not carry the ${WAR_STANDARD} signature made with the ` +
  `PGP key registered to <a href="mailto:${WAR_SIGNER}">${WAR_SIGNER}</a> is not ` +
  `ours. ${WAR_PROOF}</p>` +
  `<p><strong>${WAR_FORBIDDEN}</strong></p></div>`;

function hexFromBuffer(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(data) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return hexFromBuffer(digest);
}

function uuidV4() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for contexts without crypto.randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Strip CR/LF so a config value can never inject a bogus header line.
function sanitizeHeaderValue(value) {
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

// Filename safe for the comma-separated `name=hash` attachment header list.
function headerToken(value) {
  return sanitizeHeaderValue(value).replace(/[,=]/g, "_");
}

// gpg prints fingerprints as uppercase hex with no separators, so a fingerprint
// copied out of Thunderbird's key properties still compares equal.
function normalizeFingerprint(value) {
  return String(value == null ? "" : value)
    .replace(/[\s:]/g, "")
    .replace(/^0x/i, "")
    .toUpperCase();
}

/*
 * Merkle root over a list of hex-encoded leaf digests.
 *  1. Sort the hex strings ascending.
 *  2. If one leaf, that leaf is the root.
 *  3. Otherwise repeatedly concatenate adjacent hex pairs (as UTF-8 text) and
 *     SHA-256 them, duplicating the last odd leaf, until one digest remains.
 */
async function merkleRoot(hexLeaves) {
  const sorted = [...hexLeaves].sort();
  if (sorted.length === 0) {
    return "";
  }
  let level = sorted;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      next.push(await sha256Hex(new TextEncoder().encode(left + right)));
    }
    level = next;
  }
  return level[0];
}

/*
 * Crypto engine + digest block.
 *
 * Two headers make the evidence self-describing without the manifest:
 *   X-PasevSU-Sha256        one row per digested object: body, every file, timestamp
 *   X-PasevSU-Cripto-Engine the 25-digit key that encrypts those rows
 *   X-PasevSU-Cripto-title  the same rows, AES-256-GCM encrypted under that key
 *
 * The code is DERIVED from the evidence, never random: the gateway must arrive at the
 * same number, and a recipient must be able to recompute it from the Merkle root they
 * already hold. Web Crypto has no big-integer API, so the reduction uses BigInt, which
 * Thunderbird ESR 115 supports.
 */
const ENGINE_LABEL = "PasevSU-Cripto-Engine:v1";
const CRYPTO_TITLE_LABEL = "PasevSU-Cripto-title:v1";
const ENGINE_DIGITS = 25;

async function sha256Bytes(text) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  );
}

async function cryptoEngineCode(merkleRootHex, bodyHashHex) {
  const seed = await sha256Hex(
    new TextEncoder().encode(`${ENGINE_LABEL}|${merkleRootHex}|${bodyHashHex}`)
  );
  // 96 bits (24 hex chars) reduced mod 10^25 always lands inside 25 digits.
  const value = BigInt(`0x${seed.slice(0, 24)}`) % 10n ** BigInt(ENGINE_DIGITS);
  return value.toString().padStart(ENGINE_DIGITS, "0");
}

function buildDigestBlock(bodyHash, attachmentEntries, timestamp) {
  const rows = [`body - ${bodyHash}`];
  for (const entry of attachmentEntries) {
    rows.push(`${headerToken(entry.filename)} - ${entry.sha256}`);
  }
  rows.push(`timestep - ${timestamp}`);
  return rows;
}

/*
 * Rows are joined with "," and stay on ONE line: customHeaders carries
 * `{ name, value }` and every value goes through sanitizeHeaderValue(), which strips
 * CR/LF. `headerToken` already escapes "," and "=" out of file names, so the rows stay
 * unambiguous — the same convention X-PasevSU-Attachments-SHA256 uses.
 */
function joinBlock(rows) {
  return rows.join(",");
}

const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Padding-free base64url, written out rather than delegating to btoa(): the manual
// form needs no host global, so the same code runs in Thunderbird and in the vm
// harness, and it matches Node's Buffer#toString("base64url") byte for byte.
function base64UrlFromBytes(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += B64URL_ALPHABET[(triple >> 18) & 63];
    out += B64URL_ALPHABET[(triple >> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL_ALPHABET[(triple >> 6) & 63];
    if (i + 2 < bytes.length) out += B64URL_ALPHABET[triple & 63];
  }
  return out;
}

/*
 * AES-256-GCM under the engine code. Deterministic (the IV is derived, not random) so
 * the gateway produces byte-identical output for the same evidence and so the same
 * message seals the same way twice. Web Crypto returns ciphertext||tag; the tag is
 * split off to match the Node implementation in psemp-gateway/api.js.
 */
async function encryptDigestBlock(code, rows, merkleRootHex) {
  const keyBytes = await sha256Bytes(`${CRYPTO_TITLE_LABEL}|key|${code}`);
  const iv = (await sha256Bytes(`${CRYPTO_TITLE_LABEL}|iv|${code}|${merkleRootHex}`)).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key,
      new TextEncoder().encode(rows.join("\n"))
    )
  );
  const tag = sealed.slice(sealed.length - 16);
  const body = sealed.slice(0, sealed.length - 16);
  return `gcm1.${base64UrlFromBytes(iv)}.${base64UrlFromBytes(tag)}.${base64UrlFromBytes(body)}`;
}

/*
 * A long Message-ID with non-standard (but RFC 5322 dot-atom legal) characters
 * `+ _ ~`, so a PasevSU message is trivially recognisable in any mail store.
 */
async function buildMessageId(evidenceId, timestamp) {
  const stamp = String(timestamp || "")
    .replace(/[^0-9]/g, "")
    .slice(0, 14)
    .padEnd(14, "0");
  const seed = await sha256Hex(
    new TextEncoder().encode(`${ENGINE_LABEL}|msgid|${evidenceId}|${stamp}`)
  );
  const slug = (offset, length) => seed.slice(offset, offset + length);
  const local = `PasevSU.${stamp}.${evidenceId}+${slug(8, 6)}_${slug(14, 6)}~${slug(20, 6)}.${slug(26, 6)}`;
  return `<${local}@forensic.evidence.pasevsu>`;
}

/*
 * PSEMP v1.1 — replay defence, cryptographic time, watermark and canary.
 *
 * Mirrors `psemp-gateway/api.js` step for step: the canary, the metadata digest and
 * the provenance block must come out IDENTICAL in both engines, otherwise a message
 * checked by the gateway would not match the manifest the extension wrote. The nonce
 * is the one intentional difference — it is fresh per message and never recomputed.
 *
 * Everything here is Web Crypto only; a MailExtension has no Node modules and no
 * filesystem, so the seen-nonce store lives in the gateway (which has both).
 */
async function sha256Text(text) {
  return sha256Hex(new TextEncoder().encode(text));
}

// Kept out of DEFAULTS on purpose: these are protocol limits, not user settings, so
// they must never appear on the options page or in the settings-parity contract.
const REPLAY_DEFAULTS = {
  maxAgeSeconds: 3600,
  maxSkewSeconds: 60,
  windowSize: 4096,
};

// Same literals as the gateway so `algorithms` reads the same in both manifests.
// SHA3-512 / BLAKE3 are listed as the gateway's sealing step — Web Crypto has
// neither, so this extension states them and the gateway fills them in.
function buildAlgorithms() {
  return {
    body: "SHA-256",
    extra: ["SHA3-512", "BLAKE3"],
    merkle: "SHA-256",
    engine: "AES-256-GCM",
    signature: "OpenPGP",
    timestamp: "OpenTimestamps",
  };
}

function buildProvenance({ recipient, messageId, evidenceId, issuedAt, organization }) {
  return {
    framework: "PasevSU",
    standard: "PSEMP",
    organization: sanitizeHeaderValue(organization),
    evidence_id: sanitizeHeaderValue(evidenceId),
    recipient: sanitizeHeaderValue(recipient),
    message_id: sanitizeHeaderValue(messageId),
    issued_at: sanitizeHeaderValue(issuedAt),
  };
}

// An address may arrive as a string, an object, or a list of either.
function addressText(value) {
  if (!value) return "";
  if (typeof value === "string") return sanitizeHeaderValue(value);
  if (Array.isArray(value)) return value.map(addressText).filter(Boolean).join(", ");
  return sanitizeHeaderValue(value.email || value.id || "");
}

function normalizeRecipients(to) {
  return (Array.isArray(to) ? to : String(to == null ? "" : to).split(","))
    .map((value) => {
      if (value && typeof value === "object") {
        return sanitizeHeaderValue(value.email || value.id || "");
      }
      return sanitizeHeaderValue(value);
    })
    .filter(Boolean);
}

/*
 * The metadata a signature must cover as well as the body — subject, from, to, date,
 * the Message-ID and the attachment digest. `attachments_sha256` hashes the sorted
 * `[filename, sha256]` pairs, so attachment ORDER never changes the result but a
 * renamed or swapped file always does. `headers_sha256` covers the whole record and
 * therefore does not cover itself.
 */
async function buildSignedHeaders({ subject, from, to, date, messageId, attachmentEntries }) {
  const files = (attachmentEntries || [])
    .map((entry) => [
      String(entry && entry.filename == null ? "" : entry.filename),
      String(entry && entry.sha256 == null ? "" : entry.sha256),
    ])
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  const record = {
    subject: sanitizeHeaderValue(subject),
    from: addressText(from),
    to: normalizeRecipients(to),
    date: sanitizeHeaderValue(date),
    message_id: sanitizeHeaderValue(messageId),
    attachments_sha256: await sha256Text(JSON.stringify(files)),
  };
  return Object.assign({}, record, { headers_sha256: await sha256Text(JSON.stringify(record)) });
}

/*
 * Canary in the `PASEVSU-YYYY-MM-DD-XXXXXXXX` shape. Derived, never random: the same
 * nonce and sequence always give the same token, so it survives re-computation, and
 * nobody can predict tomorrow's from today's. This is the leak-tracing device the
 * brief described as "decoy files", without putting fabricated documents into evidence.
 */
async function buildCanary({ issuedAt, sequence, organization, nonce }) {
  const day =
    sanitizeHeaderValue(issuedAt).slice(0, 10) || new Date().toISOString().slice(0, 10);
  const seed = await sha256Text(
    `PasevSU-Canary:v1|${sanitizeHeaderValue(organization)}|${day}|${sequence}|${nonce}`
  );
  return `PASEVSU-${day}-${seed.slice(0, 8).toUpperCase()}`;
}

// `expires_at` is derived from `issued_at`, so a reader can check the deadline
// without trusting the sender's clock twice.
function buildReplay({ nonce, sequence, issuedAt, recipient, maxAgeSeconds }) {
  const parsed = Date.parse(issuedAt || "");
  const stamp = Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
  const ttl = Number.isFinite(Number(maxAgeSeconds))
    ? Number(maxAgeSeconds)
    : REPLAY_DEFAULTS.maxAgeSeconds;
  const expires = new Date(Date.parse(stamp) + Math.max(0, ttl) * 1000).toISOString();
  return {
    nonce: sanitizeHeaderValue(nonce) || uuidV4().replace(/-/g, ""),
    sequence: Number.isFinite(Number(sequence)) ? Number(sequence) : 0,
    issued_at: stamp,
    expires_at: expires,
    recipient: sanitizeHeaderValue(recipient),
    single_use: true,
  };
}

/*
 * Per-sender monotonic counter, kept apart from the options defaults on purpose: it is
 * bookkeeping, not a setting, so it must not appear on the options page or in the
 * settings-parity contract. A missing or unwritable store just yields 1.
 */
async function nextSequence() {
  try {
    const stored = await browser.storage.local.get({ sequence: 0 });
    const next = (Number(stored && stored.sequence) || 0) + 1;
    await browser.storage.local.set({ sequence: next });
    return next;
  } catch {
    return 1;
  }
}

async function computeAttachmentHashes(attachments) {
  const entries = [];
  const failures = [];
  for (const att of attachments || []) {
    const name = sanitizeHeaderValue((att && att.name) || "attachment");
    try {
      if (!att || typeof att.id !== "number") {
        throw new Error("no attachment id");
      }
      const file = await browser.compose.getAttachmentFile(att.id);
      const buffer = await file.arrayBuffer();
      const hash = await sha256Hex(buffer);
      const filename = sanitizeHeaderValue(att.name || file.name || "attachment");
      entries.push({ filename, sha256: hash });
    } catch (err) {
      // One unreadable attachment must not abort the whole send — but it must not
      // disappear from the evidence chain either: a file the user attached and the
      // recipient receives, with no hash and no mention, is worse than an honest
      // "this one could not be read". The failure is published in
      // X-PasevSU-Attachments-Error and recorded for the options page.
      const reason = sanitizeHeaderValue((err && err.message) || err);
      failures.push({ filename: name, reason });
      console.warn("[PasevSU] skipped attachment (could not read/hash):", name, err);
    }
  }
  return { entries, failures };
}

async function buildManifest(
  config,
  evidenceId,
  bodyHash,
  attachmentEntries,
  merkle,
  timestamp,
  extra
) {
  const context = extra || {};
  const manifest = {
    framework: "PasevSU",
    version: sanitizeHeaderValue(config.version),
    message_sha256: bodyHash,
    // Web Crypto has no SHA3-512, so the MailExtension cannot fill these in; the
    // gateway (`psemp-gateway seal`) recomputes and seals them. The keys are always
    // present so the manifest has one shape whichever component built it.
    message_sha3_512: null,
    attachments: attachmentEntries.map((a) => ({
      filename: a.filename,
      sha256: a.sha256,
      sha3_512: null, // gateway fills
      blake3: null, // gateway fills
    })),
    merkle_root: merkle,
    timestamp: timestamp || new Date().toISOString(),
    evidence_id: evidenceId,
    /*
     * Appended after evidence_id so the established key order above stays put. These
     * four are NOT Merkle input: the root the headers already published covers the
     * body and the original attachments only, and adding a leaf now would invalidate
     * it. They are covered instead by X-PasevSU-Manifest-SHA256, which is computed
     * over this whole document.
     */
    algorithms: buildAlgorithms(),
    provenance: context.provenance,
    signed_headers: context.signedHeaders,
    replay: context.replay,
  };
  return JSON.stringify(manifest, null, 2);
}

/*
 * Thunderbird >= 100 types ComposeDetails.customHeaders as an array of
 * `{ name, value }` objects, NOT as "Name: value" strings. Handing back a string
 * makes setComposeDetails() fail schema validation, and the send is aborted with
 * no dialog — the compose window simply stays open. So a header may only ever be
 * produced through buildHeader().
 */
function buildHeader(name, value) {
  return { name, value: sanitizeHeaderValue(value) };
}

/*
 * The Subject always ends with the marker. Idempotent: onBeforeSend can fire more
 * than once for one message, and a stacked marker would be visible to the recipient.
 * Exactly one space before it and never a run of them — MsgComposeCommands collapses
 * runs of 74+ whitespace characters while it normalises the Subject on the way out.
 */
function appendWarMarker(subject) {
  const current = typeof subject === "string" ? subject : "";
  if (current.includes(WAR_MARKER)) {
    return current;
  }
  const trimmed = current.replace(/\s+$/, "");
  return trimmed ? `${trimmed} ${WAR_MARKER}` : WAR_MARKER;
}

/*
 * Which body field an outgoing notice may be written into. Thunderbird deletes the
 * property that does not match the compose format before applying the change
 * (`delete details.body` for a text composer, `delete details.plainTextBody` for an
 * HTML one — ext-compose.js), so writing into the wrong field means the notice is
 * silently dropped and the header's claim that the prohibition is stated in the
 * email would be a lie.
 */
function warBodyField(details) {
  const order = details.isPlainText === true ? ["plainTextBody", "body"] : ["body", "plainTextBody"];
  return order.find((field) => typeof details[field] === "string") || "";
}

/*
 * Append the notice, or return null when the body already carries it. The marker is
 * the sentinel — it is always part of the notice — so a second pass returns null
 * instead of stacking a second footer. The flavour follows isPlainText/the field:
 * a plain-text composer must never receive HTML tags in its text.
 */
function withWarNotice(details, field) {
  const value = details[field];
  if (typeof value !== "string" || value.includes(WAR_MARKER)) {
    return null;
  }
  const plain = details.isPlainText === true || field === "plainTextBody";
  return plain ? `${value}${WAR_NOTICE_TEXT}` : `${value}${WAR_NOTICE_HTML}`;
}

// An MDN address may arrive as "Name <a@b>" or as { email } / { id }.
function addressOf(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return sanitizeHeaderValue(value);
  }
  return sanitizeHeaderValue(value.email || value.id || "");
}

/*
 * Where a delivery receipt should go: the identity the message is actually sent
 * from wins, because that is the mailbox the recipient's client will answer. The
 * configured `receiptAddress` is the fallback for a snapshot that has no `from`.
 */
function resolveReceiptAddress(config, details) {
  return addressOf(details.from) || addressOf(config.receiptAddress);
}

async function buildHeaders(config, evidenceId, bodyHash, attachmentEntries, merkle, manifestHash, extra) {
  const context = extra || {};
  const headers = [];
  headers.push(buildHeader("X-PasevSU-Version", config.version));
  headers.push(buildHeader("X-PasevSU-Framework", config.framework));
  headers.push(buildHeader("X-PasevSU-Origin", config.origin));
  headers.push(buildHeader("X-PasevSU-Organization", config.organization));
  // Mandatory identity + no-forwarding statement. Always present, never a setting:
  // "винаги да се вписва" — a message without it is not a PasevSU message.
  headers.push(buildHeader("X-PasevSU-WAR", WAR_HEADER_TEXT));
  headers.push(buildHeader("X-PasevSU-Evidence-ID", evidenceId));
  headers.push(buildHeader("X-PasevSU-Body-SHA256", bodyHash));

  // The count is always present, so "this message carried no files" is a signed
  // claim rather than an absence. A reader who sees no attachment list and no
  // count cannot tell an unfixed add-on from a message that genuinely had no
  // files; with the count they can (reported defect: "the attachment hashes are
  // missing" was unanswerable from the headers alone).
  headers.push(buildHeader("X-PasevSU-Attachments-Count", String(attachmentEntries.length)));

  if (attachmentEntries.length > 0) {
    const list = attachmentEntries
      .map((a) => `${headerToken(a.filename)}=${a.sha256}`)
      .join(",");
    headers.push(buildHeader("X-PasevSU-Attachments-SHA256", list));
    // One header per file as well: a long comma list is truncated or folded by
    // some clients and mail gates, and a folded list loses its tail silently.
    attachmentEntries.forEach((entry, index) => {
      headers.push(
        buildHeader(
          `X-PasevSU-Attachment-${index + 1}`,
          `${headerToken(entry.filename)}=${entry.sha256}`
        )
      );
    });
  } else if ((context.failures || []).length > 0) {
    // Files were attached but none could be read. Say so instead of publishing a
    // chain that looks complete.
    const list = context.failures
      .map((f) => `${headerToken(f.filename)}=${headerToken(f.reason)}`)
      .join(",");
    headers.push(buildHeader("X-PasevSU-Attachments-Error", list));
  }

  headers.push(buildHeader("X-PasevSU-Manifest-SHA256", manifestHash));
  headers.push(buildHeader("X-PasevSU-Merkle-Root", merkle));
  if (config.pgpFingerprint) {
    // A claim: the MailExtension cannot read Thunderbird's own keyring, so this is
    // what the sender says Thunderbird signs with. `psemp-gateway pgp-check`
    // compares it with the signer actually found in the delivered message.
    headers.push(
      buildHeader("X-PasevSU-PGP-Fingerprint", normalizeFingerprint(config.pgpFingerprint))
    );
  }
  if (config.enableOts) {
    // Marker only: real OpenTimestamps must be applied by the SMTP gateway / CLI.
    headers.push(buildHeader("X-PasevSU-OTS", "pending"));
  }
  if (config.enableReceipt && context.receiptTo) {
    // Standard MDN request (RFC 8098) plus our own marker, so a recipient can tell
    // a PasevSU message from any other message asking for a receipt.
    headers.push(buildHeader("X-PasevSU-Receipt", "requested"));
    headers.push(buildHeader("Disposition-Notification-To", context.receiptTo));
  }

  /*
   * Appended, never interleaved: the established header order above is a contract
   * that options.js, the README table and psemp-gateway test against.
   *
   * Two copies of the same digest block are emitted on purpose. `X-PasevSU-Sha256`
   * is the readable one; `X-PasevSU-Cripto-title` is the same rows encrypted under
   * the 25-digit engine code, so file names and digests stay out of plaintext header
   * scanners while remaining recoverable by anyone who holds the message.
   */
  const timestamp = context.timestamp || new Date().toISOString();
  const block = buildDigestBlock(bodyHash, attachmentEntries, timestamp);
  const engine = await cryptoEngineCode(merkle, bodyHash);
  // X- prefixed on purpose: Thunderbird's ComposeDetails.customHeaders rejects a
  // name that does not start with "X-", and a rejected setComposeDetails() aborts
  // the send with no dialog at all. The real `Message-ID:` field is written by
  // psemp-gateway, which speaks raw SMTP and may set any legal field name.
  headers.push(
    buildHeader(
      "X-PasevSU-Message-ID",
      context.messageId || (await buildMessageId(evidenceId, timestamp))
    )
  );
  headers.push(buildHeader("X-PasevSU-Sha256", joinBlock(block)));
  headers.push(buildHeader("X-PasevSU-Cripto-Engine", engine));
  headers.push(buildHeader("X-PasevSU-Cripto-title", await encryptDigestBlock(engine, block, merkle)));

  /*
   * Replay defence and cryptographic time, in the same append-only position the
   * gateway uses. `Nonce` is single-use and `Sequence` is monotonic per sender, so a
   * captured message cannot be re-injected as a fresh one; `Created`/`Expires` bound
   * how long a copy counts as a currently-issued statement (they say nothing about
   * integrity — the Merkle root and the eventual PGP seal never expire).
   */
  if (context.replay) {
    headers.push(buildHeader("X-PasevSU-Created", context.replay.issued_at));
    headers.push(buildHeader("X-PasevSU-Expires", context.replay.expires_at));
    headers.push(buildHeader("X-PasevSU-Nonce", context.replay.nonce));
    headers.push(buildHeader("X-PasevSU-Sequence", String(context.replay.sequence)));
  }
  if (context.canary) {
    headers.push(buildHeader("X-PasevSU-Canary", context.canary));
  }
  if (context.signedHeaders) {
    headers.push(buildHeader("X-PasevSU-Headers-SHA256", context.signedHeaders.headers_sha256));
  }
  return headers;
}

/*
 * Append without dropping any existing entry. Only our OWN earlier copies are
 * removed, so a listener that fires twice cannot produce a duplicated header
 * (Thunderbird rejects duplicates, and that would abort the send again).
 */
function mergeCustomHeaders(existing, incoming) {
  const ours = new Set(incoming.map((h) => h.name.toLowerCase()));
  const kept = (existing || []).filter((entry) => {
    const name = entry && typeof entry === "object" ? entry.name : String(entry).split(":")[0];
    return !ours.has(String(name || "").trim().toLowerCase());
  });
  return [...kept, ...incoming];
}

/*
 * The files the user attached. ComposeDetails.attachments is an INPUT-ONLY
 * property — the docs say "Only used in the begin* functions. Attachments to add
 * to the message." — so the `details` handed to onBeforeSend, itself a
 * getComposeDetails() snapshot, reports an EMPTY list even when the message
 * carries files. listAttachments() is the call that answers the question.
 *
 * Measured on a real send: with the snapshot alone the manifest named zero
 * attachments, X-PasevSU-Attachments-SHA256 was never written, and every other
 * check still passed — the file was in the message but outside the evidence
 * chain. The snapshot stays as a fallback so the harness and older Thunderbird
 * builds keep working.
 */
async function listComposeAttachments(tab, details) {
  let listed = [];
  try {
    if (tab && typeof tab.id === "number" && browser.compose.listAttachments) {
      listed = await browser.compose.listAttachments(tab.id);
    }
  } catch (err) {
    console.error("[PasevSU] could not enumerate attachments:", err);
  }
  // Second ask: a fresh getComposeDetails() on the compose tab. listAttachments()
  // is preferred because the send snapshot is stale, but if it is unavailable or
  // throws, asking the tab again beats trusting the snapshot.
  if (listed.length === 0 && tab && typeof tab.id === "number" && browser.compose.getComposeDetails) {
    try {
      const fresh = await browser.compose.getComposeDetails(tab.id);
      if (fresh && Array.isArray(fresh.attachments) && fresh.attachments.length > 0) {
        listed = fresh.attachments;
      }
    } catch (err) {
      console.error("[PasevSU] could not re-read the compose tab:", err);
    }
  }
  const source = listed.length > 0 ? listed : Array.isArray(details.attachments) ? details.attachments : [];
  // Our own manifest is added on the way out; if onBeforeSend fires a second time
  // it must not be hashed as if the user had attached it.
  return source.filter((att) => att && att.name !== MANIFEST_FILENAME);
}

async function handleBeforeSend(tab, details) {
  try {
    const config = Object.assign({}, DEFAULTS, await browser.storage.local.get(DEFAULTS));

    // Body selection: prefer the plain-text variant. Fall back gracefully.
    let body = details.isPlainText ? details.body : details.plainTextBody;
    if (!body) {
      body = details.body || details.plainTextBody || "";
    }

    const bodyHash = await sha256Hex(new TextEncoder().encode(body));

    /*
     * The war notice is appended AFTER the digest is taken, so
     * X-PasevSU-Body-SHA256 keeps meaning "the body the sender wrote" and a fixed,
     * generated footer can never move the evidence chain. The notice itself is
     * constant text delimited by the marker, so a verifier removes it before
     * recomputing the digest. The Subject marker, in contrast, IS part of the signed
     * metadata below: it travels on the wire, so `headers_sha256` must cover it or
     * every delivered message would look tampered.
     */
    const warSubject = appendWarMarker(details.subject);
    const warField = warBodyField(details);
    const warBody = warField ? withWarNotice(details, warField) : null;

    const existingAttachments = await listComposeAttachments(tab, details);
    const { entries: attachmentEntries, failures: attachmentFailures } =
      await computeAttachmentHashes(existingAttachments);

    // Merkle leaves = body hash + each attachment hash.
    const leaves = [bodyHash, ...attachmentEntries.map((a) => a.sha256)];
    const merkle = await merkleRoot(leaves);

    const evidenceId = uuidV4();
    // One timestamp for the manifest AND the header block, so `timestep` in the
    // digest block and `timestamp` in PasevSU_Manifest.json always agree.
    const stamp = new Date().toISOString();

    /*
     * Replay defence, cryptographic time, watermark and canary are all minted HERE,
     * before the manifest is serialised, because the manifest's SHA-256 is published
     * in X-PasevSU-Manifest-SHA256. Sealing these in afterwards (a gateway-side
     * amendment) would change the manifest and break that hash — so everything that
     * travels in the manifest has to exist at compose time.
     */
    const sequence = await nextSequence();
    const nonce = uuidV4().replace(/-/g, "");
    const messageId = await buildMessageId(evidenceId, stamp);
    const recipients = normalizeRecipients(details.to || details.recipients);
    // Bound to the primary recipient: a copy re-sent to someone else no longer
    // matches the envelope the manifest names.
    const primaryRecipient = recipients[0] || addressText(details.from);
    const replay = buildReplay({
      nonce,
      sequence,
      issuedAt: stamp,
      recipient: primaryRecipient,
    });
    const canary = await buildCanary({
      issuedAt: stamp,
      sequence,
      organization: config.organization,
      nonce,
    });
    const signedHeaders = await buildSignedHeaders({
      subject: warSubject,
      from: details.from,
      to: details.to || details.recipients,
      date: details.date,
      messageId,
      attachmentEntries,
    });
    const provenance = buildProvenance({
      recipient: primaryRecipient,
      messageId,
      evidenceId,
      issuedAt: stamp,
      organization: config.organization,
    });

    const manifestText = await buildManifest(
      config,
      evidenceId,
      bodyHash,
      attachmentEntries,
      merkle,
      stamp,
      { provenance, signedHeaders, replay }
    );
    const manifestHash = await sha256Hex(new TextEncoder().encode(manifestText));

    // Attach the manifest. ComposeDetails.attachments is documented as "Only used
    // in the begin* functions", so pushing an entry into details here is silently
    // dropped — addAttachment() is the call that is honoured on the way out. The
    // manifest itself is intentionally NOT part of the attachment hash list or the
    // Merkle root (those cover the original body + files).
    try {
      await browser.compose.addAttachment(tab.id, {
        file: new File([manifestText], MANIFEST_FILENAME, { type: "application/json" }),
      });
    } catch (err) {
      // A missing manifest must not stop the message, but it must not pass in
      // silence either: the options page reports this.
      await Promise.resolve()
        .then(() =>
          browser.storage.local.set({
            psempManifestError: String((err && err.message) || err),
          })
        )
        .catch(() => {});
      console.error("[PasevSU] manifest could not be attached:", err);
    }

    // Where the delivery receipt goes. `enableReceipt` is on by default, so the only
    // thing that can suppress the header is a message with no resolvable address.
    // The stored value is a CODE ("no-address"), not a sentence: the options page
    // owns the words and can show them in the user's language.
    const receiptTo = config.enableReceipt ? resolveReceiptAddress(config, details) : "";
    const receiptProblem = config.enableReceipt && !receiptTo ? "no-address" : null;
    await Promise.resolve()
      .then(() => browser.storage.local.set({ psempReceiptError: receiptProblem }))
      .catch(() => {});

    const newHeaders = await buildHeaders(
      config,
      evidenceId,
      bodyHash,
      attachmentEntries,
      merkle,
      manifestHash,
      { failures: attachmentFailures, receiptTo: receiptTo, timestamp: stamp, replay, canary, signedHeaders, messageId }
    );

    // Append WITHOUT dropping any existing (foreign) entries.
    const mergedHeaders = mergeCustomHeaders(details.customHeaders, newHeaders);

    // Breadcrumb: onBeforeSend having fired is not observable from the Sent folder
    // — Send Later keeps its own queue, an IMAP APPEND can fail, and a server-side
    // Sent copy may never reach local disk. Recording the send here means "did the
    // extension stamp this message?" is answerable without hunting through mbox
    // files. Best effort: the write is trivial and a storage failure is swallowed,
    // so it can never fail or cancel the send.
    await Promise.resolve()
      .then(async () => {
        const previous = await browser.storage.local.get({ psempSendCount: 0 });
        const count = Number(previous.psempSendCount) || 0;
        await browser.storage.local.set({
          psempSendCount: count + 1,
          psempLastSend: {
            at: new Date().toISOString(),
            evidenceId,
            bodySha256: bodyHash,
            manifestSha256: manifestHash,
            merkleRoot: merkle,
            attachmentCount: attachmentEntries.length,
            // filename=sha256 per file, so the options page can show exactly what
            // went into the evidence chain without opening a mailbox.
            attachments: attachmentEntries,
            attachmentFailures,
            receiptTo: receiptTo || null,
            // Names only: the values are already in the message being sent.
            headers: newHeaders.map((header) => header.name),
          },
        });
      })
      .catch(() => {});

    // Return ONLY the property that actually changed. The `details` we were handed
    // is a getComposeDetails() snapshot, and returning it is a setComposeDetails()
    // call that tries to write every property back — including read-only ones
    // (attachments[].size, isModified) and permission-gated ones (identityId,
    // additionalFccFolder, overrideDefaultFcc* need accountsRead, which this add-on
    // does not request). That write fails schema validation, and Thunderbird aborts
    // the send with no dialog and no error: the compose window simply stays open.
    // The docs for setComposeDetails are explicit: "only properties that are to be
    // changed should be included".
    // The Subject and the body are returned for the same reason: `subject` is a
    // writable ComposeDetails property (SetComposeDetails assigns gMsgCompose
    // .compFields.subject, and GenericSendMessage re-reads it after the beforesend
    // event, so the marker really reaches the wire), and the notice goes into the one
    // body property the compose format keeps. Nothing else is returned — see below.
    const changed = { customHeaders: mergedHeaders, subject: warSubject };
    if (warBody !== null) {
      changed[warField] = warBody;
    }
    return { details: changed };
  } catch (err) {
    // Never throw and never cancel: on any error the message still goes out.
    // `{}` means "no changes", which is the safe way to say "send it as it is" —
    // echoing `details` back would abort the send (see above).
    console.error("[PasevSU] header injection failed; sending without PasevSU headers:", err);
    return {};
  }
}

// --- Arm the extension -----------------------------------------------------
// The heartbeat is written BEFORE the listener is registered, so that a failed
// registration is distinguishable from a background script that never ran.
try {
  browser.storage.local
    .set({ psempLastLoadedAt: new Date().toISOString() })
    .catch(() => {});
} catch (err) {
  console.error("[PasevSU] heartbeat could not be written:", err);
}

try {
  browser.compose.onBeforeSend.addListener(handleBeforeSend);
} catch (err) {
  // Recorded rather than swallowed: the options page surfaces psempArmError.
  console.error("[PasevSU] could not arm onBeforeSend:", err);
  Promise.resolve()
    .then(() => browser.storage.local.set({ psempArmError: String((err && err.message) || err) }))
    .catch(() => {});
}
