# PasevSU Forensic Mail — Thunderbird MailExtension

A Thunderbird MailExtension that automatically injects forensic/cryptographic
`X-PasevSU-*` headers and a `PasevSU_Manifest.json` attachment into **every**
outgoing email, transparently on send. There is no per-message opt-in: the
headers are always produced by default.

This is the browser-side component of the **PasevSU Secure Evidence Mail
Protocol (PSEMP)**. Heavy cryptography that Web Crypto cannot do (OpenPGP
signing, OpenTimestamps, SHA3-512, BLAKE3) is applied later by the SMTP
gateway / CLI — this extension produces the hashes, the Merkle root, the
evidence ID, and a manifest the gateway can stamp.

## What it does

On every send (`browser.compose.onBeforeSend`):

1. Selects the plain-text body and computes its SHA-256 (Web Crypto).
2. For each attachment, reads the file and computes its SHA-256. An unreadable
   attachment is skipped (logged) and never aborts the send.
3. Computes a Merkle root over the sorted leaf hashes (body + each attachment).
4. Generates a per-message Evidence-ID (UUID v4) and a timestamp.
5. Builds `PasevSU_Manifest.json`, computes its SHA-256, and attaches it with
   `compose.addAttachment()`. `ComposeDetails.attachments` is documented as
   **"Only used in the begin\* functions"**, so an entry pushed into `details`
   during `onBeforeSend` is silently dropped — which is why the manifest goes in
   through `addAttachment()`. If Thunderbird refuses it, the message still sends
   and the options page says so (`psempManifestError`).
6. Appends all `X-PasevSU-*` headers to `details.customHeaders` **without**
   dropping any existing headers.
7. Returns `{ details }` so the message is sent; on any error it still returns
   `{ details }` unchanged (never cancels, never throws).

## Headers injected

Static (from options):

| Header | Value |
| --- | --- |
| `X-PasevSU-Version` | `version` option (default `1.0`) |
| `X-PasevSU-Framework` | `framework` option (default `Forensic-Mail`) |
| `X-PasevSU-Origin` | `origin` option (default `Thunderbird`) |
| `X-PasevSU-Organization` | `organization` option (default `PasevSU`) |

Dynamic (computed per message):

| Header | Value |
| --- | --- |
| `X-PasevSU-Evidence-ID` | UUID v4 |
| `X-PasevSU-Body-SHA256` | SHA-256 of the message body (always) |
| `X-PasevSU-Attachments-SHA256` | comma-separated `name=sha256` list (only when attachments exist) |
| `X-PasevSU-Manifest-SHA256` | SHA-256 of `PasevSU_Manifest.json` (always) |
| `X-PasevSU-Merkle-Root` | hex Merkle root over body + attachment hashes (always) |
| `X-PasevSU-PGP-Fingerprint` | `pgpFingerprint` option (omitted if empty) |
| `X-PasevSU-OTS` | `pending` marker — **on by default**; untick `enableOts` to stop marking |

Thunderbird hands custom header names back in *Http-Header-Case*, so a reopened or
received message can show `X-Pasevsu-Version` instead of `X-PasevSU-Version`. Field
names are case-insensitive (RFC 5322 §2.2), so verify them with a case-insensitive
match rather than an exact string.

The `PasevSU_Manifest.json` attachment contains:

```json
{
  "framework": "PasevSU",
  "version": "1.0",
  "message_sha256": "...",
  "attachments": [
    { "filename": "document.pdf", "sha256": "...", "blake3": null }
  ],
  "merkle_root": "...",
  "timestamp": "...",
  "evidence_id": "..."
}
```

## Install

1. Open Thunderbird (ESR ≥ 115).
2. Go to **Settings → Add-ons and Themes**.
3. Click the **gear icon** and choose **Debug Add-ons**.
4. Click **Load Temporary Add-on…**.
5. Select `thunderbird-extension/manifest.json`.
6. Copy [`user.js`](user.js) into your Thunderbird profile directory and restart,
   so the header names are registered — see
   [Registering the header names](#registering-the-header-names-in-thunderbird).

The temporary add-on stays loaded until Thunderbird restarts. For permanent
install, package the folder as a `.xpi` (zip) and install it, or submit to
addons.thunderbird.net with a signed build.

Configure the static values via the extension's **Options** page (or
Thunderbird → Add-ons → this extension → Preferences).

## Shared settings file

The options page keeps six keys in `browser.storage.local`:

| Key | Default | Effect |
| --- | --- | --- |
| `version` | `1.0` | `X-PasevSU-Version` |
| `framework` | `Forensic-Mail` | `X-PasevSU-Framework` |
| `origin` | `Thunderbird` | `X-PasevSU-Origin` |
| `organization` | `PasevSU` | `X-PasevSU-Organization` |
| `pgpFingerprint` | empty | `X-PasevSU-PGP-Fingerprint`, omitted while empty |
| `enableOts` | `true` | writes the `X-PasevSU-OTS: pending` marker |

The gateway keeps the same keys in
[`../psemp-gateway/settings.default.json`](../psemp-gateway/settings.default.json),
so one file can describe both halves. Use **Import settings file** on the options
page to load it and **Export settings file** to write it back. Importing copies the
six keys, normalises a pasted fingerprint to uppercase hex, and refreshes the form;
a broken file is reported and changes nothing.

`origin` is the one key import deliberately ignores: it names the producer, so the
extension always writes `Thunderbird` and the gateway writes `PSEMP-Gateway`.
`psemp-gateway/test/settings-parity.cjs` pins the key set, the key order and that
single divergence across both halves.

## Permanent install (side-load)

A folder loaded through **Load Temporary Add-on…** disappears on every restart. To
keep PSEMP active without re-loading it by hand, install it as a profile
side-load: zip the four files (`manifest.json`, `background.js`, `options.html`,
`options.js`) at the archive **root** into
`pasevsu-forensic-headers@pasev.example.xpi` and place it in
`<profile>\extensions\`.

[`tools/install.ps1`](tools/install.ps1) does exactly that, finds the profile, and
verifies the installed file's SHA-256 against the build:

```powershell
powershell -ExecutionPolicy Bypass -File thunderbird-extension\tools\install.ps1
```

Thunderbird **memory-maps** an installed `.xpi`, so it cannot be replaced while
Thunderbird runs — Windows answers *"the requested operation cannot be performed on
a file with a user-mapped section open"*. Close Thunderbird first; the script
refuses and exits with code 2 otherwise. After the install the script also warns if
the profile's `user.js` lacks the next pref.

Thunderbird disables hand-placed add-ons by default. [`user.js`](user.js) ships the
pref that turns that off, so the add-on stays enabled across restarts:

```js
user_pref("extensions.autoDisableScopes", 0);
```

Without it the add-on registers as `userDisabled: true` — installed, listed, and
doing nothing. Only the **default** profile is scanned for side-loads, so confirm
your profile is the one Thunderbird actually starts
(`Help → Troubleshooting Information → Profile Directory`).

## Checking that it is armed

`active: true` in `extensions.json` does **not** prove the background script ran —
that mistake cost a full debugging session: the add-on looked enabled while every
message went out with no headers at all. Two signals are reliable:

- **The options page.** It shows *Armed — background script loaded at …* once the
  script has written its startup heartbeat to `browser.storage.local`. If it says
  *Not armed*, the script did not start (or `compose.onBeforeSend` could not be
  registered, in which case the error is shown); restart Thunderbird.
- **Thunderbird's own record.** A loaded extension gets a UUID in the
  `extensions.webextensions.uuids` preference. Dictionaries and language packs
  never do, so a missing UUID on a `type: extension` add-on means it is not live.

`psemp-gateway/test/extension-arming.cjs` runs `background.js` against a stub
`browser` object and fails if the listener is not armed at load, if the heartbeat
is written after registration, or if any error path stops returning `{ details }`
(it must never `cancel` a send).

## Limitations

- **OpenPGP / OpenTimestamps.** A MailExtension has no Node, no `gpg` and no `ots`
  binary, so real PGP signatures (`.asc`) and OpenTimestamps (`.ots`) cannot be
  generated here. `X-PasevSU-OTS: pending` is a marker for the SMTP gateway / CLI,
  which does have both: it stamps the manifest from a vendored OpenTimestamps
  bundle with no install step, and it reads the signer out of the signature
  Thunderbird already applied, so the `X-PasevSU-PGP-Fingerprint` claim can be
  checked against the key that actually signed. The marker is written **by
  default** on every message, so nothing is ever sent unstamped unless you untick
  `enableOts`; the server-side half lives in
  [`../psemp-gateway/`](../psemp-gateway/).
- **SHA3-512 / BLAKE3.** Web Crypto exposes only SHA-1/256/384/512. The
  extension uses SHA-256; `blake3` in the manifest is `null` for the gateway
  to fill in.
- **No MD5 / SHA1** are used by design.

## Registering the header names in Thunderbird

Thunderbird will not compose or display a custom header unless its name is listed
in the `mail.compose.other.header` preference. [`user.js`](user.js) ships that
preference with **all eleven** names, in injection order:

1. Copy `thunderbird-extension/user.js` into your profile directory, e.g.
   `%APPDATA%\Thunderbird\Profiles\l6o3xe0h.default-esr\user.js`.
   To find it: **Help → Troubleshooting Information → Profile Directory → Open
   Directory**.
2. Restart Thunderbird.

`user.js` is re-applied at every startup and takes precedence over `prefs.js`, so
this is the durable way to register the names; the same list can be pasted straight
into **Settings → General → Config Editor** if you prefer to keep no extra file.

The extension injects the headers through the Compose API either way — this
preference only controls whether Thunderbird *recognises* the names when a message
is reopened, forwarded, shown in the compose window, or read by another tool. Keep
the list in sync with `HEADER_NAMES` in
[`../psemp-gateway/api.js`](../psemp-gateway/api.js);
`psemp-gateway/test/settings-parity.cjs` fails if a header is added to the code and
not registered in `user.js`.

