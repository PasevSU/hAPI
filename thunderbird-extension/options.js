/*
 * PasevSU Forensic Mail — options page script.
 * Reads/writes browser.storage.local. Keys must match background.js DEFAULTS.
 */

const DEFAULTS = {
  version: "1.0",
  framework: "Forensic-Mail",
  origin: "Thunderbird",
  organization: "PasevSU",
  caseId: "",
  pgpFingerprint: "",
  enableOts: true,
  enableReceipt: true,
  receiptAddress: "",
};

const FIELDS = {
  version: document.getElementById("version"),
  framework: document.getElementById("framework"),
  origin: document.getElementById("origin"),
  organization: document.getElementById("organization"),
  caseId: document.getElementById("caseId"),
  pgpFingerprint: document.getElementById("pgpFingerprint"),
  enableOts: document.getElementById("enableOts"),
  enableReceipt: document.getElementById("enableReceipt"),
  receiptAddress: document.getElementById("receiptAddress"),
};

// English fallbacks: the page must stay readable when a catalogue entry is missing
// or when this script runs outside Thunderbird (the tests drive it with a stub DOM).
const FALLBACK = {
  armedChecking: "Checking whether the background script is armed…",
  armedOk: "Armed — background script loaded at $1.",
  armedNoReport: "Not armed — the background script has not reported yet. Restart Thunderbird.",
  armedError: "Not armed — $1",
  manifestError: "Last send: the manifest could NOT be attached — $1",
  lastSendSummary:
    "Stamped $1 message(s). Last: $2, Evidence-ID $3, $4 attachment(s), $5 headers.",
  lastSendNone:
    "Stamped 0 messages — no outgoing message has been stamped yet. Send one and this line will update.",
  attachmentHashes: "Attachment hashes of the last message:",
  attachmentFailures: "Unreadable attachments (named in X-PasevSU-Attachments-Error): $1",
  receiptError:
    "No receipt address: the receipt header is only written when the sending identity or the fallback address below is known.",
  fingerprintInvalid:
    "The fingerprint was not saved: it must be 40 or 64 hexadecimal characters (no spaces).",
  fingerprintIsKeyId:
    "That is a key ID (8 or 16 characters), not a fingerprint. Copy the full 40-character fingerprint.",
  save: "Save",
  saved: "Saved.",
  exported: "Exported settings.default.json",
  imported: "Imported $1 of $2 keys$3",
  notSettingsFile: "Not a settings file: $1",
};

const i18n = (browser && browser.i18n) || null;

function t(key, substitutions) {
  const subs = substitutions == null ? [] : [].concat(substitutions).map(String);
  if (i18n && typeof i18n.getMessage === "function") {
    const message = i18n.getMessage(key, subs);
    if (message) return message;
  }
  const template = FALLBACK[key] || key;
  return template.replace(/\$(\d)/g, (match, index) => {
    const value = subs[Number(index) - 1];
    return value == null ? match : value;
  });
}

// Locale files carry markup (<code>, <strong>), so HTML keys are set as HTML. The
// only values interpolated into them are ours, never message content.
function applyI18n() {
  if (typeof document.querySelectorAll !== "function" || !i18n) return;
  const language = typeof i18n.getUILanguage === "function" ? i18n.getUILanguage() : "";
  if (language) document.documentElement.lang = language;

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const message = i18n.getMessage(node.dataset.i18n);
    if (message) node.textContent = message;
  });
  document.querySelectorAll("[data-i18n-html]").forEach((node) => {
    const message = i18n.getMessage(node.dataset.i18nHtml);
    if (message) node.innerHTML = message;
  });
}

// Same rule as background.js: uppercase hex, no separators, so a fingerprint
// pasted from Thunderbird's key properties is stored exactly as gpg prints it.
function normalizeFingerprint(value) {
  return String(value == null ? "" : value)
    .replace(/[\s:]/g, "")
    .replace(/^0x/i, "")
    .toUpperCase();
}

// Same rule as background.js: a fingerprint is 40 hex digits (v4) or 64 (v6).
// Anything else is rejected HERE, before it is stored, so the send path never has to
// publish a claim that cannot be one. Measured on a real send, a 28-digit value — the
// case ID pasted into the wrong field — reached the wire and made the verifier accuse
// the signer of not matching its own key.
function fingerprintProblem(value) {
  const normalized = normalizeFingerprint(value);
  if (!normalized) {
    return "";
  }
  if (!/^[0-9A-F]+$/.test(normalized)) {
    return "not-hex";
  }
  if (normalized.length !== 40 && normalized.length !== 64) {
    return normalized.length === 8 || normalized.length === 16 ? "key-id-not-fingerprint" : "wrong-length";
  }
  return "";
}

function setStatus(message) {
  const status = document.getElementById("status");
  status.textContent = message;
  window.setTimeout(() => {
    status.textContent = "";
  }, 3000);
}

function renderLines(container, lines) {
  if (!container) return;
  const items = lines.filter(Boolean);
  if (typeof container.replaceChildren === "function" && typeof document.createElement === "function") {
    container.replaceChildren(
      ...items.map((line) => {
        const row = document.createElement("div");
        row.textContent = line;
        return row;
      }),
    );
  } else {
    container.textContent = items.join(" | ");
  }
}

async function load() {
  applyI18n();
  const stored = await browser.storage.local.get(DEFAULTS);
  const config = Object.assign({}, DEFAULTS, stored);
  FIELDS.version.value = config.version;
  FIELDS.framework.value = config.framework;
  FIELDS.origin.value = config.origin;
  FIELDS.organization.value = config.organization;
  FIELDS.caseId.value = config.caseId;
  FIELDS.pgpFingerprint.value = config.pgpFingerprint;
  FIELDS.enableOts.checked = Boolean(config.enableOts);
  FIELDS.enableReceipt.checked = Boolean(config.enableReceipt);
  FIELDS.receiptAddress.value = config.receiptAddress;
  await renderArmed();
}

// Readiness comes from the background script itself: it writes a heartbeat as soon
// as it loads, records an error if it cannot register onBeforeSend, and records one
// if Thunderbird refuses the manifest attachment during a send.
async function renderArmed() {
  const health = await browser.storage.local.get({
    psempLastLoadedAt: "",
    psempArmError: "",
    psempManifestError: "",
    psempLastSend: null,
    psempSendCount: 0,
    psempReceiptError: "",
  });
  const armed = document.getElementById("armed");
  if (armed) {
    if (health.psempArmError) {
      armed.textContent = t("armedError", health.psempArmError);
    } else if (health.psempLastLoadedAt) {
      armed.textContent = t("armedOk", health.psempLastLoadedAt);
    } else {
      armed.textContent = t("armedNoReport");
    }
  }

  // The headers can be injected while the manifest attachment is refused, so this
  // is reported separately: the last send went out without PasevSU_Manifest.json.
  const manifest = document.getElementById("manifest");
  if (manifest) {
    manifest.textContent = health.psempManifestError
      ? t("manifestError", health.psempManifestError)
      : "";
  }

  const send = health.psempLastSend;
  const count = Number(health.psempSendCount) || 0;

  // Proof that the extension stamped a message, independent of any Sent folder.
  const lastSend = document.getElementById("lastSend");
  if (lastSend) {
    if (send && send.at) {
      lastSend.textContent = t("lastSendSummary", [
        count,
        send.at,
        send.evidenceId || "—",
        send.attachmentCount || 0,
        (send.headers || []).length,
      ]);
    } else {
      lastSend.textContent = t("lastSendNone");
    }
  }

  // The reported defect was "the attachment hashes are missing". They are shown
  // here as name=hash, exactly as they were written into the header.
  const hashesWrap = document.getElementById("attachHashesWrap");
  const hashes = document.getElementById("attachHashes");
  const entries = send && Array.isArray(send.attachments) ? send.attachments : [];
  if (hashesWrap) {
    if (entries.length > 0 && hashesWrap.classList) hashesWrap.classList.remove("hidden");
    else if (hashesWrap.classList) hashesWrap.classList.add("hidden");
  }
  if (hashes) {
    renderLines(
      hashes,
      entries.map((entry) => `${entry.filename}=${entry.sha256}`),
    );
  }

  const failures = send && Array.isArray(send.attachmentFailures) ? send.attachmentFailures : [];
  const failuresNode = document.getElementById("attachFailures");
  if (failuresNode) {
    failuresNode.textContent = failures.length
      ? t("attachmentFailures", failures.map((f) => `${f.filename} (${f.reason})`).join(", "))
      : "";
  }

  // The background script stores a CODE, not a sentence, so the wording stays in
  // the locale files (the German page must not show an English reason).
  const receiptProblem = document.getElementById("receiptProblem");
  if (receiptProblem) {
    receiptProblem.textContent = health.psempReceiptError ? t("receiptError") : "";
  }
}

async function save() {
  const typedFingerprint = FIELDS.pgpFingerprint.value;
  const fingerprintIssue = fingerprintProblem(typedFingerprint);
  if (fingerprintIssue) {
    // Refused at the point of entry: the field keeps what was typed so it can be
    // corrected, and nothing impossible is written to storage.
    if (fingerprintIssue === "key-id-not-fingerprint") {
      setStatus(t("fingerprintIsKeyId"));
    } else {
      setStatus(t("fingerprintInvalid"));
    }
    return;
  }
  const next = {
    version: FIELDS.version.value.trim() || DEFAULTS.version,
    framework: FIELDS.framework.value.trim() || DEFAULTS.framework,
    origin: FIELDS.origin.value.trim() || DEFAULTS.origin,
    organization: FIELDS.organization.value.trim() || DEFAULTS.organization,
    caseId: FIELDS.caseId.value.trim(),
    pgpFingerprint: normalizeFingerprint(typedFingerprint),
    enableOts: FIELDS.enableOts.checked,
    enableReceipt: FIELDS.enableReceipt.checked,
    receiptAddress: FIELDS.receiptAddress.value.trim(),
    // A fingerprint just accepted clears the complaint background.js recorded for the
    // previous one, so the page stops reporting a defect the user has already fixed.
    psempFingerprintIssue: "",
  };
  await browser.storage.local.set(next);
  FIELDS.pgpFingerprint.value = next.pgpFingerprint;
  FIELDS.receiptAddress.value = next.receiptAddress;
  setStatus(t("saved"));
}

document.addEventListener("DOMContentLoaded", load);
document.getElementById("save").addEventListener("click", save);

// ── Shared settings file ────────────────────────────────────────────────────────
// `psemp-gateway/settings.default.json` carries the same keys, so one file can
// describe both halves. `origin` is the exception: it names the producer and must
// stay `Thunderbird` here, otherwise the extension would claim to be the gateway.

const SHARED_KEYS = Object.keys(DEFAULTS).filter((key) => key !== "origin");

function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const next = {};
  if (source.version != null) next.version = String(source.version).trim() || DEFAULTS.version;
  if (source.framework != null) next.framework = String(source.framework).trim() || DEFAULTS.framework;
  if (source.organization != null) {
    next.organization = String(source.organization).trim() || DEFAULTS.organization;
  }
  if (source.pgpFingerprint != null) next.pgpFingerprint = normalizeFingerprint(source.pgpFingerprint);
  if (source.enableOts != null) next.enableOts = source.enableOts === true || source.enableOts === "true";
  if (source.enableReceipt != null) {
    next.enableReceipt = source.enableReceipt === true || source.enableReceipt === "true";
  }
  if (source.receiptAddress != null) next.receiptAddress = String(source.receiptAddress).trim();
  return next;
}

async function importSettings(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    setStatus(t("notSettingsFile", error.message));
    return;
  }
  const incoming = normalizeSettings(parsed);
  const unknown = Object.keys(parsed || {}).filter(
    (key) => !Object.prototype.hasOwnProperty.call(DEFAULTS, key),
  );
  await browser.storage.local.set(incoming);
  await load();
  const applied = Object.keys(incoming).length;
  const extra = unknown.length ? ` (ignored: ${unknown.join(", ")})` : "";
  setStatus(t("imported", [applied, SHARED_KEYS.length, extra]));
}

async function exportSettings() {
  const stored = await browser.storage.local.get(DEFAULTS);
  const config = Object.assign({}, DEFAULTS, stored);
  // Same key order and shape as psemp-gateway/settings.default.json.
  const body = JSON.stringify(
    {
      version: config.version,
      framework: config.framework,
      origin: config.origin,
      organization: config.organization,
      caseId: config.caseId,
      pgpFingerprint: config.pgpFingerprint,
      enableOts: config.enableOts,
      enableReceipt: config.enableReceipt,
      receiptAddress: config.receiptAddress,
    },
    null,
    2,
  );
  const url = URL.createObjectURL(new Blob([`${body}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "settings.default.json";
  link.click();
  setStatus(t("exported"));
}

document.getElementById("importFile").addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) importSettings(file);
  event.target.value = "";
});
document.getElementById("exportFile").addEventListener("click", exportSettings);
