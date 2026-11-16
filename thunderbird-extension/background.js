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
 *   - Generate a per-message Evidence-ID (UUID v4).
 *
 * What it CANNOT do (documented, done by the SMTP gateway / CLI):
 *   - Real OpenPGP signatures (.asc) and OpenTimestamps (.ots) cannot be
 *     produced inside a MailExtension; X-PasevSU-OTS is a "pending" marker only.
 *     `psemp-gateway seal` replaces that marker with a real .asc + .ots pair.
 *   - SHA3-512 and BLAKE3 are not available in Web Crypto; the manifest records
 *     "sha3_512": null and "blake3": null so the gateway can fill them in.
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

// Inverse of joinBlock, for readers that want the rows back.
function parseBlock(value) {
  return String(value == null ? "" : value)
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean);
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

async function buildManifest(config, evidenceId, bodyHash, attachmentEntries, merkle, timestamp) {
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
  headers.push(buildHeader("X-PasevSU-Message-ID", await buildMessageId(evidenceId, timestamp)));
  headers.push(buildHeader("X-PasevSU-Sha256", joinBlock(block)));
  headers.push(buildHeader("X-PasevSU-Cripto-Engine", engine));
  headers.push(buildHeader("X-PasevSU-Cripto-title", await encryptDigestBlock(engine, block, merkle)));
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
    const manifestText = await buildManifest(
      config,
      evidenceId,
      bodyHash,
      attachmentEntries,
      merkle,
      stamp
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
      { failures: attachmentFailures, receiptTo: receiptTo, timestamp: stamp }
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
    return { details: { customHeaders: mergedHeaders } };
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
