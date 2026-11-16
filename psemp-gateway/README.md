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
  tools/check-sent.cjs       re-derives every claim from the bytes that travelled
  tools/verify-install.cjs   the profile is wired up and running the current build
  test/self-test.cjs         known-answer vectors + round-trip verification
  test/settings-parity.cjs   the two halves must agree on the settings keys
  test/pgp-thunderbird.cjs   signer read from a Thunderbird signature, no gpg needed
  test/ots-runtime.cjs       the vendored OpenTimestamps bundle actually stamps
  test/extension-arming.cjs  background.js arms itself, and injects, in a stub browser
  test/check-sent.cjs        the verifier rejects what it must reject
  test/verify-install.cjs    the install checker notices a broken profile
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

Written on every outgoing message, in this order — the order is a contract shared
with [`api.js`](api.js) `HEADER_NAMES`, the extension's `buildHeader()` calls and
`user.js` (see [`PROTOCOL.md`](PROTOCOL.md) §4):

| Header | Value |
| --- | --- |
| `X-PasevSU-Version` | configured framework version |
| `X-PasevSU-Framework` | `Forensic-Mail` |
| `X-PasevSU-Origin` | `Thunderbird` (extension) or `PSEMP-Gateway` (this gateway) |
| `X-PasevSU-Organization` | `PasevSU` |
| `X-PasevSU-WAR` | the identity/anti-forwarding statement — always, see below |
| `X-PasevSU-Evidence-ID` | UUID v4, equal to the manifest `evidence_id` |
| `X-PasevSU-Case-ID` | configured case label — omitted when empty |
| `X-PasevSU-Body-SHA256` | SHA-256 of the plain-text body |
| `X-PasevSU-Attachments-Count` | number of hashed attachments |
| `X-PasevSU-Attachments-SHA256` | `name=hash,name=hash` — omitted when there are no attachments |
| `X-PasevSU-Attachments-Error` | names of attachments that could not be read — omitted when none failed |
| `X-PasevSU-Manifest-SHA256` | SHA-256 of the exact `PasevSU_Manifest.json` text |
| `X-PasevSU-Merkle-Root` | Merkle root over body hash + attachment hashes |
| `X-PasevSU-PGP-Fingerprint` | configured fingerprint — omitted when empty |
| `X-PasevSU-OTS` | `pending` — on by default; turn off to stop marking |
| `X-PasevSU-Receipt` | `requested` — only when `enableReceipt` is on |
| `X-PasevSU-Message-ID` | long `<PasevSU.…@forensic.evidence.pasevsu>` id (the gateway also writes the real `Message-ID:`) |
| `X-PasevSU-Sha256` | digest block: `body - …`, one `name - …` per file, `timestep - …` |
| `X-PasevSU-Cripto-Engine` | 25-digit code derived from the seal |
| `X-PasevSU-Cripto-title` | the same block, AES-256-GCM encrypted under that code |
| `X-PasevSU-Created` | compose timestamp |
| `X-PasevSU-Expires` | end of the freshness window |
| `X-PasevSU-Nonce` | 128-bit hex, single use |
| `X-PasevSU-Sequence` | per-sender monotonic counter |
| `X-PasevSU-Canary` | `PASEVSU-YYYY-MM-DD-XXXXXXXX`, names this copy |
| `X-PasevSU-Headers-SHA256` | SHA-256 over `manifest.signed_headers` |
| `Disposition-Notification-To` | the receipt address — only when `enableReceipt` is on |

Every header except the four conditional ones (`-Attachments-Error`, `-Receipt`,
`-PGP-Fingerprint` when unset, `-Attachments-SHA256` with no files) is emitted on
every single message, with no per-message opt-in.

Newlines are stripped from every configured value, `,` and `=` are neutralised in
the attachment header tokens, and existing `customHeaders` are always preserved
(new lines are appended, never substituted).

### Signed metadata, replay and the package

The four trailing headers exist for three reasons, all specified in
[`PROTOCOL.md`](PROTOCOL.md):

* **`signed_headers` (§8)** hashes Subject, From, To, Date, Message-ID and the
  attachment set, not just the body. Swapping an attachment or rewriting a Subject
  breaks it; reordering attachments does not.
* **Replay defence (§11)** — nonce + sequence + `issued_at`/`expires_at` + recipient
  binding. Always on: `REPLAY_DEFAULTS` is deliberately not a user setting, because
  an optional anti-replay check is off in exactly the messages that matter.
* **`-Canary` (§10)** names the copy, so a leaked print or export traces back to the
  transmission and the mailbox it was minted for.

`node cli.js package <manifest.json> [--out <file.json>]` turns a manifest into
`PasevSU_Package.json`, the self-describing evidence bundle (§12), with a worked
example in [`examples/`](examples/). `verifyEvidence()` implements the seven
verification steps of §13.


### The digest block and the crypto engine

`X-PasevSU-Sha256` puts the whole digest set in one value, rows separated by `,`
(never RFC 5322 folding — Thunderbird collapses `[\r\n]+` to a space, so a folded
block would arrive flattened):

```
body - 1c4e…  document.pdf - 5f1a…  index,odd.txt - d3dc…  timestep - 2026-11-16T14:00:49.056Z
```

`timestep` is the same instant written into the manifest `timestamp`, so header and
seal cannot describe different moments. `headerToken()` maps `,` and `=` in a file
name to `_`, so the row count is always `1 + files + 1`.

`X-PasevSU-Cripto-Engine` is **derived, never random**:
`SHA-256("PasevSU-Cripto-Engine:v1|<merkle-root>|<body-sha256>")`, first 24 hex
digits as a `BigInt`, modulo 10²⁵, zero-padded to 25 digits. The recipient can
recompute it from the Merkle root they already hold, and
`test/extension-arming.cjs` proves the gateway and the extension agree.

`X-PasevSU-Cripto-title` is the block under AES-256-GCM with a key and IV derived
from that code, wire format `gcm1.<iv>.<tag>.<ct>` in base64url. It is **not
secrecy against the recipient** (the code travels in the same message): it keeps
file names and digests out of plaintext header scanners while staying recoverable.
A wrong code fails the GCM tag check rather than returning plausible garbage.

`Message-ID` is emitted twice on purpose. Raw SMTP may set any legal field name, so
the gateway writes the real `Message-ID:`; the extension cannot, because
`ComposeDetails.customHeaders` **rejects any name that does not start with `X-`**
and a rejected `setComposeDetails()` aborts the send with no dialog at all. Hence
the identical `X-PasevSU-Message-ID` twin.

`PasevSU-WAR` follows the same twin rule for the same reason. The value states the
**negative**: an email that does not carry the OpenPGP/MIME signed message (RFC 4880 and
3156) signature made with the PGP key registered to `pasevdenislav@gmail.com` is not ours,
that only that signature proves identity and preserves integrity, and that forwarding is
strictly forbidden. The extension writes `X-PasevSU-WAR`; the gateway also writes the bare
`PasevSU-WAR:`. It is phrased as a **requirement, never a claim**, because neither engine
signs — Thunderbird's own OpenPGP does, per identity. `PROTOCOL.md` §4a quotes the exact
353 characters; both engines produce the same bytes and
`test/extension-arming.cjs` fails if they drift apart.

Two more things happen on every message, and cannot be switched off: the Subject always
ends with `{{ PasevSU-WAR }}` (appended once, after any opt-in `[XXXXXXXX]` tag), and the
same three sentences are repeated in the body as a constant footer
(`\n\n{{ PasevSU-WAR }}\n…`, 313 characters) so the recipient actually reads it. The body
digest is taken **before** the footer is appended, and a verifier reproduces it by cutting
the exact suffix — `body.endsWith(WAR_NOTICE_TEXT)`, never at the marker.
See [`PROTOCOL.md` §4a](PROTOCOL.md#4a-the-war-line-the-subject-marker-and-the-body-notice).

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
node psemp-gateway/cli.js sign message.eml --digest SHA384
node psemp-gateway/cli.js verify-sig message.eml message.eml.asc
node psemp-gateway/cli.js pgp-info message.eml
node psemp-gateway/cli.js pgp-check message.eml --fingerprint ABCDEF
node psemp-gateway/cli.js seal PasevSU_Manifest.json --body message.txt --attach report.pdf
node psemp-gateway/cli.js seal PasevSU_Manifest.json --body message.txt `
     --attach "report=report.pdf" --attach "photo=photo.jpg" --key ABCDEF
```

`pgp-info` prints what `pgpInspectMessage()` found — format, issuer fingerprint,
issuer key ID and where the signer came from (`signature-packet` when it was read
out of the message, `gpg` when GnuPG had to be consulted). `pgp-check` compares the
`X-PasevSU-PGP-Fingerprint` claim on a delivered message with the key that actually
signed it and exits non-zero on a mismatch.

Every command prints JSON. Missing external tooling is reported as `pending`
(OpenTimestamps) or `unavailable` (GnuPG) and exits zero; only real failures exit
non-zero.

### `seal` — the step that makes the manifest strong

The extension can only compute SHA-256, so it writes `message_sha3_512`,
`sha3_512` and `blake3` as `null`. `seal` is the gateway command that fills what it
can and signs the result:

```console
$ node psemp-gateway/cli.js seal PasevSU_Manifest.json --body message.txt --attach report.pdf
{
  "ok": true,
  "status": "sealed-partial",
  "manifest": "…\\PasevSU_Manifest.json",
  "evidenceId": "11111111-2222-4333-8444-555555555555",
  "merkleRoot": "cac33879…",
  "filled": ["message_sha3_512", "report.pdf:sha3_512"],
  "confirmed": [],
  "unsealedFiles": [],
  "mismatches": [],
  "signature": {
    "status": "ok",
    "signaturePath": "…\\PasevSU_Manifest.json.asc",
    "executable": "C:\\Program Files\\GnuPG\\bin\\gpg.exe",
    "digestRequested": "SHA512",
    "digestAlgo": "SHA-512",
    "digestId": 10,
    "digestSource": "gpg --list-packets"
  },
  "timestamp": { "status": "pending", "reason": "calendar unreachable" },
  "claimedManifestSha256": "cebb53d7…",
  "sealedManifestSha256": "0bfe2c95…",
  "changed": true,
  "supersededProof": null,
  "signaturePath": "…\\PasevSU_Manifest.json.asc",
  "proofPath": null,
  "artifacts": ["…\\PasevSU_Manifest.json", "…\\PasevSU_Manifest.json.asc"]
}
```

`status` is `sealed` only when the manifest was both signed and stamped;
anything less is `sealed-partial` and still exits zero, because the hash chain is
complete either way. `changed` says whether the manifest file itself was
rewritten — a second run over already-sealed bytes reports `false`, lists the
slots under `confirmed` instead of `filled`, and verifies the existing signature
rather than replacing it.

`--attach` is repeatable and accepts either `path` (the basename is used) or
`name=path`. `--no-sign` / `--no-ots` skip a step; `--digest` picks the signature
digest; `--blake3` supplies a BLAKE3 value, since no BLAKE3 implementation is
vendored here.

Behaviour worth knowing:

- **`filled` vs `confirmed`.** `filled` lists slots this run actually changed;
  `confirmed` lists slots that already held the correct value. A second `seal`
  over identical bytes is a no-op — `filled` is empty and the existing signature
  is verified rather than replaced.
- **The Merkle root never moves.** It is built from SHA-256 leaves and is already
  published in the message headers. Sealing adds a second digest *beside* the
  chain, never inside it, so a sealed manifest still matches the
  `X-PasevSU-Merkle-Root` the recipient already holds.
- **Mismatch means stop.** If the body or an attachment no longer hashes to the
  value the manifest claims, `seal` returns `status: "mismatch"` and **leaves the
  file untouched**. Bytes not supplied are reported in `unsealedFiles`, never
  assumed correct.
- **A stale `.ots` is moved aside, never overwritten.** Proofs are append-only, so
  a superseded one becomes `*.superseded` and its path is reported in
  `supersededProof`.
- **Signing degrades loudly.** With no GnuPG the signature is reported
  `unavailable` and the seal still succeeds; the exit code tells you the hash
  chain was completed without the signature.

#### The digest-name trap

gpg spells digests **without a hyphen**: `SHA512`, `SHA384`, `SHA256`, `SHA224`,
`SHA1`, `MD5`, `RIPEMD160`. `--digest-algo SHA-512` is rejected with
`gpg: selected digest algorithm is invalid` (exit 2) — measured on gpg 2.5.24.
That is a silent kill: the command fails, nothing is signed, and a caller that
does not check the exit code reports success.

Two guards, both in `api.js`:

- `normalizeDigestAlgo()` accepts the hyphenated spelling and rewrites it to the
  name gpg wants; it defaults to `SHA512`.
- SHA3 is **refused** for signing (`UNSUPPORTED_DIGEST`) because OpenPGP has no
  SHA3 signature packet. SHA3-512 belongs in the manifest as a content digest, not
  in the signature packet. `SHA-512`, `SHA3-256`, `SHA3-512` and `SHAKE256` were
  all measured to fail; `SHA512`–`MD5` all succeed, including under an ed25519
  key, which signs with SHA-512.

The digest reported back is read from the finished `.asc` with
`gpg --batch --list-packets` (`digest algo (\d+)` → `DIGEST_NAMES`), so
`digestAlgo` is what was **used**, not what was asked for, and
`digestSource: "gpg --list-packets"` records where that came from.

Also note: GnuPG on Windows installs to `C:\Program Files\GnuPG\bin\gpg.exe` and
is **not** on `PATH` by default. The GnuPG status cache is keyed on `PATH` and
`PATHEXT`, so a gateway started before GnuPG was installed stops saying
"unavailable" as soon as the PATH is corrected — it is not memoised for the life
of the process.

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

## Verifying the install

A sent message is the final proof, but it is a slow way to find out that the
add-on was never armed. `tools/verify-install.cjs` reads the Thunderbird profile
and answers the question directly:

```console
node psemp-gateway/tools/verify-install.cjs
node psemp-gateway/tools/verify-install.cjs "C:\...\Profiles\l6o3xe0h.default-esr"
```

It compares three lists that have to agree, in order: the names `background.js`
actually pushes, `HEADER_NAMES` in `api.js`, and `mail.compose.other.header` in
the profile's `user.js`. It also checks that nothing stale is registered, that
`mailnews.headers.extraExpandedHeaders` covers every name, that the side-load
prefs are present, that `user.js` is still LF-only and ends with `;`, that no
original pref was lost, and that the installed `.xpi` is not older than the
source it was built from.

Exit codes: `0` everything holds, `1` a check failed, `2` there is no profile or
no `user.js` to judge — that is an answer about the machine, not about the mail.

The stale-build check earns its place: the headers can change and be committed
while Thunderbird keeps running the previous `.xpi`, and nothing else notices
until a sent message comes back without them.

## Verifying a sent message

The chain above makes claims. `tools/check-sent.cjs` re-derives them from the
bytes that actually travelled, so a header is never trusted on its own:

```console
node psemp-gateway/tools/check-sent.cjs                    # the newest sent message in the profile
node psemp-gateway/tools/check-sent.cjs --all              # every message in every Sent mailbox
node psemp-gateway/tools/check-sent.cjs --only 3           # message 3 of the first mailbox, as numbered
node psemp-gateway/tools/check-sent.cjs mail.eml           # one file
node psemp-gateway/tools/check-sent.cjs "C:\...\l6o3xe0h.default-esr"   # a profile directory
```

It reads the Sent mbox, then for the message it parses the MIME tree, decodes
quoted-printable and base64 parts, re-hashes the body and every attachment, and
recomputes the Merkle root. It reuses `api.js` (`sha256Hex`, `verifyManifest`,
`verifyEvidence`) rather than re-implementing the hashes, so a disagreement means
the message and the code disagree, not that two implementations drifted.

### Which mailbox is "Sent"

By the folder's own name, in the languages Thunderbird translates it into:
`Sent`, `Изпратени`, `Gesendet`, `Отправленные` and the rest of the list in
`isSentName()`. Matching only the English word is a real defect that shipped
once: this profile is Bulgarian, its live outbox is `[Gmail].sbd\Изпратени`
(2.3 GB), and the English-only walk confidently reported on an Outlook `Sent`
that had not been written since 5 November.

Among the matches, the message with the newest `Date` header wins — not the
newest file modification time. The most recently *touched* Sent folder here holds
a single message from 2022, so mtime points at the wrong mailbox as soon as
Thunderbird refreshes an index.

Mailboxes are read from the tail (`lastMessages`) or streamed (`streamMessages`),
never loaded whole: a 2.3 GB mbox cannot be returned as a Node string at all, and
the newest message is by definition the last one.

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
same mail, so it is excluded as well, and so is `.mozmsgs`, which holds Windows
Search metadata rather than mail.

## Tests

```console
node psemp-gateway/test/self-test.cjs
node psemp-gateway/test/settings-parity.cjs
node psemp-gateway/test/locales.cjs
node psemp-gateway/test/pgp-thunderbird.cjs
node psemp-gateway/test/ots-runtime.cjs
node psemp-gateway/test/seal.cjs
node psemp-gateway/test/extension-arming.cjs
node psemp-gateway/test/check-sent.cjs
node psemp-gateway/test/verify-install.cjs
```

`self-test.cjs` covers known-answer vectors for SHA-224/256/384/512, NIST
SHA3-512, RIPEMD-160 and Keccak-512; agreement between the vendored CryptoJS
group and `node:crypto` for SHA-224/256/384/512; Merkle single-leaf,
order-independence and empty-set behaviour; manifest serialisation and hash;
header order, preservation and injection safety; adapter availability; the EML
evidence pipeline; and an evidence round-trip that must reject a tampered body.

`settings-parity.cjs` pins the eight settings keys and their order across `api.js`,
`settings.default.json`, `background.js` and `options.js`, and pins that `user.js`
registers every header name the extension writes. It then runs the options page
script against a stub DOM to prove that importing a settings file copies the eight
keys, normalises the fingerprint, refreshes the form and never copies `origin`.

`locales.cjs` proves the three catalogues (`en`, `de`, `bg`) carry exactly the
same key set, that no key is empty or untranslated, that the options page and
manifest ask only for keys that exist, that no catalogue key is dead, that the
markup of each hint survives translation, and — specifically — that German and
Bulgarian carry the delivery-receipt feature. A half-translated panel fails here
rather than in front of a recipient.

`seal.cjs` covers the sealing step end to end: SHA3-512 slots filled without
moving the Merkle root, a tampered SHA3 claim caught, a manifest describing other
bytes refused, a tampered attachment refused, a second run over identical bytes
proven a no-op (`filled` empty, slots under `confirmed`), a stale `.ots` moved
aside rather than overwritten, unsupplied bytes reported instead of guessed, and
a `Buffer` body accepted the way the CLI reads it.

Three of its checks are about signing specifically, because "the signing level is
weak" was the reported defect and it turned out gpg was never signing at all:
the digest name is the one gpg accepts (the hyphenated `SHA-512` spelling is
rejected by gpg, and `normalizeDigestAlgo()` must rewrite it), signing degrades
loudly with an emptied `PATH`, and a real signature is produced from a throwaway
`GNUPGHOME` with an ed25519 key, verified, and its digest **read back** from the
`.asc`. That last check is the only one that proves a signature exists rather
than that a command was constructed.

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
The same class of mistake is pinned twice more: a `Изпратени` mailbox has to be
found with no English `Sent` anywhere in the profile, and the newest message has
to be chosen by its `Date` header even when a different mailbox was touched more
recently. `lastMessages` and `streamMessages` are checked against the in-memory
split at a 7-byte chunk size, so a multi-byte character split across chunks
cannot silently mangle a body.

`verify-install.cjs` provokes every failure the install checker claims to catch —
a retired header name still registered, a written header never registered, an
`.xpi` older than the source, a profile with no `user.js` — using throwaway
profiles in `%TEMP%`, and requires a correctly wired profile to pass. Without
that, a checker reporting success from three lists that happened to match would
look exactly like a working install.
