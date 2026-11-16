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
  enableOts: false,
};

const FIELDS = {
  version: document.getElementById("version"),
  framework: document.getElementById("framework"),
  origin: document.getElementById("origin"),
  organization: document.getElementById("organization"),
  pgpFingerprint: document.getElementById("pgpFingerprint"),
  enableOts: document.getElementById("enableOts"),
};

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
}

async function save() {
  const next = {
    version: FIELDS.version.value.trim() || DEFAULTS.version,
    framework: FIELDS.framework.value.trim() || DEFAULTS.framework,
    origin: FIELDS.origin.value.trim() || DEFAULTS.origin,
    organization: FIELDS.organization.value.trim() || DEFAULTS.organization,
    pgpFingerprint: FIELDS.pgpFingerprint.value.trim(),
    enableOts: FIELDS.enableOts.checked,
  };
  await browser.storage.local.set(next);
  setStatus("Saved.");
}

document.addEventListener("DOMContentLoaded", load);
document.getElementById("save").addEventListener("click", save);
