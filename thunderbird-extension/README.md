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
5. Builds `PasevSU_Manifest.json`, computes its SHA-256, and attaches it.
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

The temporary add-on stays loaded until Thunderbird restarts. For permanent
install, package the folder as a `.xpi` (zip) and install it, or submit to
addons.thunderbird.net with a signed build.

Configure the static values via the extension's **Options** page (or
Thunderbird → Add-ons → this extension → Preferences).

## Limitations

- **OpenPGP / OpenTimestamps.** Real PGP signatures (`.asc`) and OpenTimestamps
  (`.ots`) cannot be generated inside a MailExtension (no Node, no `gpg`/`ots`
  binaries). `X-PasevSU-OTS: pending` is a marker; the SMTP gateway / CLI must
  stamp the manifest. (`gpg --armor --detach-sign PasevSU_Manifest.json`,
  `ots stamp PasevSU_Manifest.json`.) The marker is written **by default** on
  every message, so nothing is ever sent unstamped unless you untick
  `enableOts`; the server-side half lives in [`../psemp-gateway/`](../psemp-gateway/).
- **SHA3-512 / BLAKE3.** Web Crypto exposes only SHA-1/256/384/512. The
  extension uses SHA-256; `blake3` in the manifest is `null` for the gateway
  to fill in.
- **No MD5 / SHA1** are used by design.

## Optional: register header names in Thunderbird

Thunderbird's compose editor may not show custom headers in the UI, but you can
pre-register their names via `user.js`/Config Editor so they are recognized
when displayed:

```
user_pref(
  "mail.compose.other.header",
  "X-PasevSU-Version,X-PasevSU-Evidence-ID,X-PasevSU-Body-SHA256,X-PasevSU-Attachments-SHA256,X-PasevSU-Manifest-SHA256,X-PasevSU-Merkle-Root"
);
```

The extension injects the headers regardless of this preference; it only helps
display/recognition in some views.
