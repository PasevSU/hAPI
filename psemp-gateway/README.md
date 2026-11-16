# PSEMP gateway — PasevSU Forensic Mail Framework (server side)

Node-side half of the forensic-mail layer. The Thunderbird MailExtension in
[`../thunderbird-extension/`](../thunderbird-extension/) stamps every outgoing
message with forensic headers while it is still in the composer; this gateway
does the work a MailExtension is not allowed to do — real OpenPGP signatures and
real OpenTimestamps proofs — and re-verifies what the extension claimed.

Both halves implement the **same contract**: identical header names, identical
header order, identical manifest field order, identical Merkle algorithm. A
manifest produced here verifies a manifest produced there, and vice versa.

## Why two halves

| Capability | MailExtension | Gateway |
| --- | --- | --- |
| SHA-256 of body / attachments | yes (Web Crypto) | yes (`node:crypto`) |
| Merkle root | yes | yes |
| `PasevSU_Manifest.json` + its SHA-256 | yes | yes |
| NIST SHA3-512, RIPEMD-160, Keccak-512 | no | yes |
| Real OpenPGP detached signature (`.asc`) | no | yes, with a `gpg` binary on `PATH` |
| Read the signer out of Thunderbird's own signature | no | yes — pure-Node packet parser, no `gpg` needed |
| Real OpenTimestamps proof (`.ots`) | no — writes `pending` | yes, from the vendored browser bundle, no npm install |
| BLAKE3 | no | not bundled (Web Crypto and the vendored groups have none) |

The extension therefore writes `X-PasevSU-OTS: pending` as a **marker only**, and
the gateway replaces that marker with a completed proof. Neither half ever
fabricates a signature or a timestamp.

## Layout

```
psemp-gateway/
  api.js                     one Node API — hashing, Merkle, manifest, headers, adapters
  cli.js                     thin CLI over api.js
  settings.default.json      the six shared settings, also importable by the extension
  packages/                  vendored, dependency-closed code (see below)
  test/self-test.cjs         known-answer vectors + round-trip verification
  test/settings-parity.cjs   the two halves must agree on the settings keys
  test/pgp-thunderbird.cjs   signer read from a Thunderbird signature, no gpg needed
  test/ots-runtime.cjs       the vendored OpenTimestamps bundle actually stamps
  test/extension-arming.cjs  background.js arms itself, and injects, in a stub browser
```

| Vendored group | Used for |
| --- | --- |
| `01-core`, `06-hash-crypto` | CryptoJS bridge — cross-checks the native digests |
| `07-ots` | OpenTimestamps manager (`createTimestamp`, `verifyTimestamp`, `upgradeTimestamp`) |
| `17-javascript-opentimestamps` | upstream OTS library source |
| `15-openpgpjs` | upstream OpenPGP.js source (TypeScript — needs a build before use) |
| `05-forensics/email-evidence-js-core` | RFC822 → evidence-object pipeline |

The core path needs **no third-party runtime dependency**: SHA-256, the Merkle
root, the manifest and header injection all run on `node:crypto` alone. Adapters
degrade gracefully instead of throwing.

### SHA-3 caveat

`06-hash-crypto` ships `CryptoJS.SHA3`, which is **Keccak-512** (the original
submission), not **NIST SHA3-512** — the padding differs, so the digests differ.
`api.hashHex('sha3', …)` returns NIST SHA3-512 via OpenSSL; `api.keccak512Hex(…)`
returns Keccak-512 through the vendored code. The self-test pins both vectors and
asserts they are not equal.

## Header contract

Written on every outgoing message, in this order:

| Header | Value |
| --- | --- |
| `X-PasevSU-Version` | configured framework version |
| `X-PasevSU-Framework` | `Forensic-Mail` |
| `X-PasevSU-Origin` | `Thunderbird` (extension) or `PSEMP-Gateway` (this gateway) |
| `X-PasevSU-Organization` | `PasevSU` |
| `X-PasevSU-Evidence-ID` | UUID v4, equal to the manifest `evidence_id` |
| `X-PasevSU-Body-SHA256` | SHA-256 of the plain-text body |
| `X-PasevSU-Attachments-SHA256` | `name=hash,name=hash` — omitted when there are no attachments |
| `X-PasevSU-Manifest-SHA256` | SHA-256 of the exact `PasevSU_Manifest.json` text |
| `X-PasevSU-Merkle-Root` | Merkle root over body hash + attachment hashes |
| `X-PasevSU-PGP-Fingerprint` | configured fingerprint — omitted when empty |
| `X-PasevSU-OTS` | `pending` — **on by default**; turn off to stop marking |

Newlines are stripped from every configured value, `,` and `=` are neutralised in
the attachment header tokens, and existing `customHeaders` are always preserved
(new lines are appended, never substituted).

### Merkle algorithm

1. Hex-encode every leaf digest (body, then each attachment).
2. Sort the hex strings ascending — so the root does not depend on input order.
3. One leaf: the root is that leaf.
4. Otherwise concatenate adjacent pairs **as UTF-8 text**, SHA-256 them, duplicate
   the last odd leaf, and repeat until a single digest remains.

The manifest is deliberately **not** part of the Merkle set: that set covers the
original body and the original attachments only.

### Manifest shape

```json
{
  "framework": "PasevSU",
  "version": "1.0",
  "message_sha256": "…",
  "attachments": [{ "filename": "note.txt", "sha256": "…", "blake3": null }],
  "merkle_root": "…",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "evidence_id": "…"
}
```

Field order is part of the contract — the SHA-256 is taken over
`JSON.stringify(manifest, null, 2)` with exactly this key order.

## API

```js
const psemp = require('./psemp-gateway/api.js');

psemp.sha256Hex('abc');                       // lowercase hex
psemp.hashHex('sha3', Buffer.from('abc'));    // NIST SHA3-512
psemp.keccak512Hex('');                       // Keccak-512 (vendored CryptoJS)
psemp.merkleRoot([hashA, hashB]);             // hex root

const evidence = psemp.computeEvidence({
  body: 'Hello evidence',
  attachments: [{ name: 'note.txt', data: Buffer.from('bytes') }],
  config: { version: '1.0', pgpFingerprint: 'ABCDEF', enableOts: true },
});
evidence.headerLines;   // ['X-PasevSU-Version: 1.0', …] — append to the message
evidence.manifest;      // the object
evidence.manifestText;  // exact text to attach as PasevSU_Manifest.json
evidence.manifestSha256;

psemp.verifyManifest(evidence.manifestText, evidence.manifestSha256);
psemp.verifyEvidence(evidence.manifest, { body, attachments });

psemp.otsStatus();             // { available, reason } — never throws
await psemp.otsStamp('msg.eml');
await psemp.otsVerify('msg.eml.ots');
psemp.pgpStatus();             // { available, executable, version }
psemp.pgpInspectMessage('msg.eml');   // { signed, format, issuerFingerprint, signerSource }
psemp.pgpResolvedFingerprint('msg.eml');  // signer, or '' when unsigned
psemp.pgpCrossCheck('msg.eml', { fingerprint: 'ABC…' });
psemp.pgpSign('msg.eml', { keyId: 'ABCDEF' });
psemp.pgpVerify('msg.eml', 'msg.eml.asc');
await psemp.emailEvidence(emlBytes, { filename: 'msg.eml' });
```

`computeEvidence({ … , signature })` fills an empty `pgpFingerprint` from the
signer found in `signature`, so a message Thunderbird already signed gets the
right `X-PasevSU-PGP-Fingerprint` without the sender typing the key. The
fingerprint is a header claim only — it is not in the manifest, so the value of
`X-PasevSU-Manifest-SHA256` never moves because of it, and an explicit
`config.pgpFingerprint` always wins over the detected one.

`pgpSign()` refuses to stack a second signature on a message that already carries
one (`status: 'skipped'`, `reason: 'ALREADY_SIGNED'`). Pass `{ force: true }` to
sign anyway.

An unreadable attachment never aborts the run: it is reported in
`evidence.skipped` and left out of the Merkle set, which is exactly what the
extension does.

## CLI

```console
node psemp-gateway/cli.js status
node psemp-gateway/cli.js self-test
node psemp-gateway/cli.js hash sha256 message.eml
node psemp-gateway/cli.js evidence message.eml --name message.eml
node psemp-gateway/cli.js eml message.eml --out manifest.json
node psemp-gateway/cli.js stamp message.eml
node psemp-gateway/cli.js verify message.eml.ots
node psemp-gateway/cli.js upgrade message.eml.ots
node psemp-gateway/cli.js sign message.eml --key ABCDEF
node psemp-gateway/cli.js sign message.eml --force
node psemp-gateway/cli.js verify-sig message.eml message.eml.asc
node psemp-gateway/cli.js pgp-info message.eml
node psemp-gateway/cli.js pgp-check message.eml --fingerprint ABCDEF
```

`pgp-info` prints what `pgpInspectMessage()` found — format, issuer fingerprint,
issuer key ID and where the signer came from (`signature-packet` when it was read
out of the message, `gpg` when GnuPG had to be consulted). `pgp-check` compares the
`X-PasevSU-PGP-Fingerprint` claim on a delivered message with the key that actually
signed it and exits non-zero on a mismatch.

Every command prints JSON. Missing external tooling is reported as `pending`
(OpenTimestamps) or `unavailable` (GnuPG) and exits zero; only real failures exit
non-zero.

## Enabling the optional adapters

Neither step is required for the hash/manifest path.

- **OpenTimestamps — works as vendored.** `07-ots/opentimestamps.min.js` is the
  upstream **browser** bundle, so `require()` alone returns `{}`; `ots-manager.js`
  therefore prefers npm `opentimestamps` and falls back to loading the bundle with
  minimal `window`/`self`/`navigator`/`document` shims and reading its API off
  `window.OpenTimestamps`. No install step. `otsStatus()` reports
  `{ available: true, vendored: true }` on that path, and a stamp contacts the
  public calendars directly from Node.
  `otsSidecar()` — the `<file>.sha256` sidecar helper — never had a dependency.
- **OpenPGP — a `gpg`/`gpg2` binary on `PATH` is needed to *create* a signature.**
  The vendored `15-openpgpjs` is TypeScript source without a build output and its
  npm dependencies are absent, so it cannot be used as shipped. Reading an existing
  signature needs nothing: `pgpInspectMessage()` parses the OpenPGP packets itself
  (`armorPayloadToBytes` → `readPgpPackets` → `parseSignatureSubpackets`), so the
  signer of a message Thunderbird signed is available on a machine with no GnuPG.
  If GnuPG is absent, `pgpStatus()` reports `GPG_NOT_FOUND` and no signature is claimed.

## Shared settings

`settings.default.json` holds the six keys both halves use — `version`,
`framework`, `origin`, `organization`, `pgpFingerprint`, `enableOts`. The
extension's options page can import this file and export back to it, so a single
file describes the framework everywhere.

`resolveConfig()` merges `DEFAULTS` < `loadSettings()` < the caller's `config`, in
that order — the file overrides the built-in defaults, and an explicit `config`
argument overrides both. A missing or malformed settings file silently falls back
to `DEFAULTS`: settings must never be able to fail a send.

`origin` is deliberately **not** shared: it names the producer, so the extension
always writes `Thunderbird` and the gateway writes `PSEMP-Gateway`. That is the
only intentional difference in the header set, and `test/settings-parity.cjs`
asserts it together with the key set and key order in all four places.

## Full chain

```
Thunderbird composer
  └─ MailExtension: body/attachment SHA-256 → Merkle root → manifest → headers
       └─ SMTP submission (message + PasevSU_Manifest.json)
            └─ PSEMP gateway
                 ├─ verify the extension's manifest and Merkle root
                 ├─ NIST SHA3-512 / Keccak-512 / RIPEMD-160 if required
                 ├─ OpenPGP detached signature  → PasevSU_Manifest.json.asc
                 ├─ OpenTimestamps proof        → PasevSU_Manifest.json.ots
                 └─ replace `X-PasevSU-OTS: pending` with the completed proof
```

Every step is automatic: nothing is opt-in per message. `enableOts` is on by
default and only controls whether the `pending` marker is written, so the gateway
knows to stamp the message; turn it off in the extension options only if you
deliberately want messages left unstamped.

## Verifying a sent message

The chain above makes claims. `tools/check-sent.cjs` re-derives them from the
bytes that actually travelled, so a header is never trusted on its own:

```console
node psemp-gateway/tools/check-sent.cjs                    # newest message in the newest Sent mailbox
node psemp-gateway/tools/check-sent.cjs --all              # every message in it
node psemp-gateway/tools/check-sent.cjs --only 3           # message 3, as the report numbers them
node psemp-gateway/tools/check-sent.cjs mail.eml           # one file
node psemp-gateway/tools/check-sent.cjs "C:\...\l6o3xe0h.default-esr"   # a profile directory
```

It reads the Sent mbox, then for the message it parses the MIME tree, decodes
quoted-printable and base64 parts, re-hashes the body and every attachment, and
recomputes the Merkle root. It reuses `api.js` (`sha256Hex`, `verifyManifest`,
`verifyEvidence`) rather than re-implementing the hashes, so a disagreement means
the message and the code disagree, not that two implementations drifted.

Exit code 0 means every claim held. A failure prints which claim broke:

| Reported | Meaning |
| --- | --- |
| `missing X-PasevSU-…` | the message was not stamped — the add-on is not armed, or the mail predates it |
| `manifest attached … absent` | `PasevSU_Manifest.json` did not travel with the mail |
| `attachment … is in the manifest` | a payload part was sent that the manifest does not list: the evidence has a hole |
| `body is sha256 hex` fails | the body was altered after stamping |
| `merkle root` fails | the headers and the manifest disagree with each other |

Old mail legitimately fails: the framework only stamps what it sends. Send a test
message after installing and check **that** one.

Three files in a profile look like mail but are not, and the tool skips them:
`.msf` is Thunderbird's MIME summary index, `.wdseml` is a Windows Search
sidecar, and `.dat`/`.mab`/`.sqlite`/`.json` are address books and databases. An
account that has `Sent.msf` but no `Sent` has simply never written a local copy;
that is not a defect and the tool does not report it. `chrome_debugger_profile`
is a nested profile created by the Debug Add-ons page and holds a copy of the
same mail, so it is excluded as well.

## Tests

```console
node psemp-gateway/test/self-test.cjs
node psemp-gateway/test/settings-parity.cjs
node psemp-gateway/test/pgp-thunderbird.cjs
node psemp-gateway/test/ots-runtime.cjs
node psemp-gateway/test/extension-arming.cjs
node psemp-gateway/test/check-sent.cjs
```

`self-test.cjs` covers known-answer vectors for SHA-224/256/384/512, NIST
SHA3-512, RIPEMD-160 and Keccak-512; agreement between the vendored CryptoJS
group and `node:crypto` for SHA-224/256/384/512; Merkle single-leaf,
order-independence and empty-set behaviour; manifest serialisation and hash;
header order, preservation and injection safety; adapter availability; the EML
evidence pipeline; and an evidence round-trip that must reject a tampered body.

`settings-parity.cjs` pins the six settings keys and their order across `api.js`,
`settings.default.json`, `background.js` and `options.js`, then runs the options
page script against a stub DOM to prove that importing a settings file copies the
six keys, normalises the fingerprint, refreshes the form and never copies `origin`.

`pgp-thunderbird.cjs` builds OpenPGP v4 signature packets by hand, so it needs no
keyring and no GnuPG, and covers the packet parser, armour decoding, CRLF-split
PGP/MIME messages, the signer-derived fingerprint header, the
`ALREADY_SIGNED` guard and `--force`.

`ots-runtime.cjs` proves the vendored OpenTimestamps bundle loads and reaches the
stamping stage; it accepts either an attested proof (a written `.ots`) or the
explicit "no usable calendar attestation" error, and never a missing runtime.

`extension-arming.cjs` runs `background.js` inside a `vm` with a stub `browser`
object, the way Thunderbird runs it, and then drives the registered
`onBeforeSend` listener. It fails if the listener is not armed at load, if the
startup heartbeat is written after registration, if a failing attachment or a
failing `storage.local.get` stops the send, or if `{ cancel: true }` ever comes
back. Merkle roots are recomputed with `node:crypto` rather than Web Crypto, so
the extension and the test cannot drift together.

`check-sent.cjs` drives the real `background.js` to produce a message — headers
and manifest — assembles it into a MIME fixture, and then points the verifier at
it. It proves the verifier is not vacuous: a dropped manifest, an altered
attachment, an unlisted attachment and a message with no headers at all must all
be reported. It also pins the profile file filter, because treating `Sent.msf` or
a `.wdseml` cache as mail would produce a confident verdict about the wrong file.
