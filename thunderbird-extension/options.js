/*
 * PasevSU Forensic Mail — options page script.
 * Reads/writes browser.storage.local. Keys must match background.js DEFAULTS.
 */

const DEFAULTS = {
  version: "1.0",
  framework: "Forensic-Mail",
  origin: "Thunderbird",
  organization: "PasevSU",
  pgpFingerprint: "",
  enableOts: true,
};

const FIELDS = {
  version: document.getElementById("version"),
  framework: document.getElementById("framework"),
  origin: document.getElementById("origin"),
  organization: document.getElementById("organization"),
  pgpFingerprint: document.getElementById("pgpFingerprint"),
  enableOts: document.getElementById("enableOts"),
};

// Same rule as background.js: uppercase hex, no separators, so a fingerprint
// pasted from Thunderbird's key properties is stored exactly as gpg prints it.
function normalizeFingerprint(value) {
  return String(value == null ? "" : value)
    .replace(/[\s:]/g, "")
    .replace(/^0x/i, "")
    .toUpperCase();
}

function setStatus(message) {
  const status = document.getElementById("status");
  status.textContent = message;
  window.setTimeout(() => {
    status.textContent = "";
  }, 3000);
}

async function load() {
  const stored = await browser.storage.local.get(DEFAULTS);
  const config = Object.assign({}, DEFAULTS, stored);
  FIELDS.version.value = config.version;
  FIELDS.framework.value = config.framework;
  FIELDS.origin.value = config.origin;
  FIELDS.organization.value = config.organization;
  FIELDS.pgpFingerprint.value = config.pgpFingerprint;
  FIELDS.enableOts.checked = Boolean(config.enableOts);
  await renderArmed();
}

// Readiness comes from the background script itself: it writes a heartbeat as soon
// as it loads, and records an error if it cannot register onBeforeSend.
async function renderArmed() {
  const health = await browser.storage.local.get({ psempLastLoadedAt: "", psempArmError: "" });
  const armed = document.getElementById("armed");
  if (health.psempArmError) {
    armed.textContent = `Not armed — ${health.psempArmError}`;
  } else if (health.psempLastLoadedAt) {
    armed.textContent = `Armed — background script loaded at ${health.psempLastLoadedAt}.`;
  } else {
    armed.textContent = "Not armed — the background script has not reported yet. Restart Thunderbird.";
  }
}

async function save() {
  const next = {
    version: FIELDS.version.value.trim() || DEFAULTS.version,
    framework: FIELDS.framework.value.trim() || DEFAULTS.framework,
    origin: FIELDS.origin.value.trim() || DEFAULTS.origin,
    organization: FIELDS.organization.value.trim() || DEFAULTS.organization,
    pgpFingerprint: normalizeFingerprint(FIELDS.pgpFingerprint.value),
    enableOts: FIELDS.enableOts.checked,
  };
  await browser.storage.local.set(next);
  FIELDS.pgpFingerprint.value = next.pgpFingerprint;
  setStatus("Saved.");
}

document.addEventListener("DOMContentLoaded", load);
document.getElementById("save").addEventListener("click", save);

// ── Shared settings file ────────────────────────────────────────────────────────
// `psemp-gateway/settings.default.json` carries the same six keys, so one file can
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
  return next;
}

async function importSettings(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    setStatus(`Not a settings file: ${error.message}`);
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
  setStatus(`Imported ${applied} of ${SHARED_KEYS.length} keys${extra}`);
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
      pgpFingerprint: config.pgpFingerprint,
      enableOts: config.enableOts,
    },
    null,
    2,
  );
  const url = URL.createObjectURL(new Blob([`${body}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "settings.default.json";
  link.click();
  setStatus("Exported settings.default.json");
}

document.getElementById("importFile").addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) importSettings(file);
  event.target.value = "";
});
document.getElementById("exportFile").addEventListener("click", exportSettings);
