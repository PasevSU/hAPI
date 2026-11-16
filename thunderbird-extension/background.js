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
 *   - SHA3-512 and BLAKE3 are not available in Web Crypto; the manifest records
 *     "blake3": null so the gateway can fill it in.
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

async function computeAttachmentHashes(attachments) {
  const entries = [];
  for (const att of attachments || []) {
    try {
      if (!att || typeof att.id !== "number") {
        continue;
      }
      const file = await browser.compose.getAttachmentFile(att.id);
      const buffer = await file.arrayBuffer();
      const hash = await sha256Hex(buffer);
      const filename = sanitizeHeaderValue(att.name || file.name || "attachment");
      entries.push({ filename, sha256: hash });
    } catch (err) {
      // One unreadable attachment must not abort the whole send.
      console.warn(
        "[PasevSU] skipped attachment (could not read/hash):",
        att && att.name,
        err
      );
    }
  }
  return entries;
}

async function buildManifest(config, evidenceId, bodyHash, attachmentEntries, merkle) {
  const manifest = {
    framework: "PasevSU",
    version: sanitizeHeaderValue(config.version),
    message_sha256: bodyHash,
    attachments: attachmentEntries.map((a) => ({
      filename: a.filename,
      sha256: a.sha256,
      blake3: null, // not computable in a MailExtension; filled by the gateway
    })),
    merkle_root: merkle,
    timestamp: new Date().toISOString(),
    evidence_id: evidenceId,
  };
  return JSON.stringify(manifest, null, 2);
}

async function buildHeaders(config, evidenceId, bodyHash, attachmentEntries, merkle, manifestHash) {
  const headers = [];
  headers.push(`X-PasevSU-Version: ${sanitizeHeaderValue(config.version)}`);
  headers.push(`X-PasevSU-Framework: ${sanitizeHeaderValue(config.framework)}`);
  headers.push(`X-PasevSU-Origin: ${sanitizeHeaderValue(config.origin)}`);
  headers.push(`X-PasevSU-Organization: ${sanitizeHeaderValue(config.organization)}`);
  headers.push(`X-PasevSU-Evidence-ID: ${evidenceId}`);
  headers.push(`X-PasevSU-Body-SHA256: ${bodyHash}`);
  if (attachmentEntries.length > 0) {
    const list = attachmentEntries
      .map((a) => `${headerToken(a.filename)}=${a.sha256}`)
      .join(",");
    headers.push(`X-PasevSU-Attachments-SHA256: ${list}`);
  }
  headers.push(`X-PasevSU-Manifest-SHA256: ${manifestHash}`);
  headers.push(`X-PasevSU-Merkle-Root: ${merkle}`);
  if (config.pgpFingerprint) {
    // A claim: the MailExtension cannot read Thunderbird's own keyring, so this is
    // what the sender says Thunderbird signs with. `psemp-gateway pgp-check`
    // compares it with the signer actually found in the delivered message.
    headers.push(`X-PasevSU-PGP-Fingerprint: ${normalizeFingerprint(config.pgpFingerprint)}`);
  }
  if (config.enableOts) {
    // Marker only: real OpenTimestamps must be applied by the SMTP gateway / CLI.
    headers.push("X-PasevSU-OTS: pending");
  }
  return headers;
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

    const existingAttachments = Array.isArray(details.attachments) ? details.attachments : [];
    const attachmentEntries = await computeAttachmentHashes(existingAttachments);

    // Merkle leaves = body hash + each attachment hash.
    const leaves = [bodyHash, ...attachmentEntries.map((a) => a.sha256)];
    const merkle = await merkleRoot(leaves);

    const evidenceId = uuidV4();
    const manifestText = await buildManifest(
      config,
      evidenceId,
      bodyHash,
      attachmentEntries,
      merkle
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

    const newHeaders = await buildHeaders(
      config,
      evidenceId,
      bodyHash,
      attachmentEntries,
      merkle,
      manifestHash
    );

    // Append WITHOUT dropping any existing entries.
    details.customHeaders = [...(details.customHeaders || []), ...newHeaders];

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
            // Names only: the values are already in the message being sent.
            headers: newHeaders.map((header) => header.slice(0, header.indexOf(":"))),
          },
        });
      })
      .catch(() => {});

    return { details };
  } catch (err) {
    // Never throw: on any error the message still goes out, unchanged headers.
    console.error("[PasevSU] header injection failed; sending without PasevSU headers:", err);
    return { details };
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
