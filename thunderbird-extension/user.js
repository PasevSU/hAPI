// PasevSU Forensic Mail — Thunderbird preference registration.
//
// Copy this file into the profile directory of the Thunderbird you send from, e.g.
//
//   %APPDATA%\Thunderbird\Profiles\l6o3xe0h.default-esr\user.js
//
// and restart Thunderbird. `user.js` is re-applied at every startup and takes
// precedence over `prefs.js`, so this is the durable way to register the names.
// Deleting the file and restarting removes the preference again (Thunderbird
// keeps the value in `prefs.js` once written, so also reset it in the Config
// Editor if you want the old behaviour back).
//
// Why it is needed: Thunderbird will not compose or display an arbitrary
// custom header unless its name is listed in `mail.compose.other.header`.
// The extension sets all of these through the Compose API regardless, but
// registering them keeps the names recognised when a message is opened,
// forwarded, shown in the compose window, or inspected by other tools.
//
// Keep this list in sync with HEADER_NAMES in `../psemp-gateway/api.js`.
// `psemp-gateway/test/settings-parity.cjs` fails if a header is added to the
// code and not registered here.

user_pref(
  "mail.compose.other.header",
  [
    "X-PasevSU-Version",
    "X-PasevSU-Framework",
    "X-PasevSU-Origin",
    "X-PasevSU-Organization",
    "X-PasevSU-Evidence-ID",
    "X-PasevSU-Body-SHA256",
    "X-PasevSU-Attachments-SHA256",
    "X-PasevSU-Manifest-SHA256",
    "X-PasevSU-Merkle-Root",
    "X-PasevSU-PGP-Fingerprint",
    "X-PasevSU-OTS",
  ].join(","),
);
