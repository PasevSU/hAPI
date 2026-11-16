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
| Real OpenPGP detached signature (`.asc`) | no | yes (`gpg`) or OpenPGP.js after a build |
| Real OpenTimestamps proof (`.ots`) | no — writes `pending` | yes when npm `opentimestamps` is installed |
| BLAKE3 | no | not bundled (Web Crypto and the vendored groups have none) |

The extension therefore writes `X-PasevSU-OTS: pending` as a **marker only**, and
the gateway replaces that marker with a completed proof. Neither half ever
fabricates a signature or a timestamp.

## Layout

```
psemp-gateway/
  api.js                     one Node API — hashing, Merkle, manifest, headers, adapters
  cli.js                     thin CLI over api.js
  packages/                  vendored, dependency-closed code (see below)
  test/self-test.cjs         known-answer vectors + round-trip verification
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
psemp.pgpSign('msg.eml', { keyId: 'ABCDEF' });
psemp.pgpVerify('msg.eml', 'msg.eml.asc');
await psemp.emailEvidence(emlBytes, { filename: 'msg.eml' });
```

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
node psemp-gateway/cli.js verify-sig message.eml message.eml.asc
```

Every command prints JSON. Missing external tooling is reported as `pending`
(OpenTimestamps) or `unavailable` (GnuPG) and exits zero; only real failures exit
non-zero.

## Enabling the optional adapters

Neither step is required for the hash/manifest path.

- **OpenTimestamps** — install the npm package `opentimestamps` (version `0.4.6`,
  as pinned by `packages/07-ots/package.json`) so it resolves from
  `psemp-gateway/packages/07-ots/`. Until then `otsStatus()` reports
  `OTS_RUNTIME_MISSING` and `X-PasevSU-OTS` stays `pending`.
  `otsSidecar()` — the `<file>.sha256` sidecar helper — has no such dependency
  and works immediately.
- **OpenPGP** — the vendored `15-openpgpjs` is TypeScript source without a build
  output, so the adapter prefers a real `gpg`/`gpg2` binary on `PATH`. If GnuPG
  is absent, `pgpStatus()` reports `GPG_NOT_FOUND` and no signature is claimed.

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

## Self-test

```console
node psemp-gateway/test/self-test.cjs
```

Covers known-answer vectors for SHA-224/256/384/512, NIST SHA3-512, RIPEMD-160
and Keccak-512; agreement between the vendored CryptoJS group and `node:crypto`
for SHA-224/256/384/512; Merkle single-leaf, order-independence and empty-set
behaviour; manifest serialisation and hash; header order, preservation and
injection safety; adapter availability; the EML evidence pipeline; and an
evidence round-trip that must reject a tampered body.
