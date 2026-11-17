# PasevSU Forensic Mail — Thunderbird MailExtension

A Thunderbird MailExtension that automatically injects forensic/cryptographic
`X-PasevSU-*` headers and a `PasevSU_Manifest.json` attachment into **every**
outgoing email, transparently on send. There is no per-message opt-in: the
headers are always produced by default.

This is the browser-side component of the **PasevSU Secure Evidence Mail
Protocol (PSEMP)**. Heavy cryptography that Web Crypto cannot do (OpenPGP
signing, OpenTimestamps, SHA3-512, BLAKE3) is applied afterwards by
[`../psemp-gateway/`](../psemp-gateway/) — a CLI plus a library, not an SMTP
proxy — while Thunderbird's own OpenPGP does the signing in the MUA itself. This
extension produces the hashes, the Merkle root, the evidence ID, and a manifest
those later steps can stamp.

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
   dropping any existing headers. Each header is a `{ name, value }` **object**,
   which is what Thunderbird ≥ 100 requires — see *The header shape is a
   contract* under Limitations.
7. Returns `{ details }` so the message is sent; on any error it still returns
   `{ details }` unchanged (never cancels, never throws).

## Headers injected

Static (from options):

| Header | Value |
| --- | --- |
| `X-PasevSU-Version` | `version` option (default `1.0`) |
| `X-PasevSU-Build` | the installed add-on's own version, read from `manifest.json` (currently `1.8`) |
| `X-PasevSU-Framework` | `framework` option (default `Forensic-Mail`) |
| `X-PasevSU-Origin` | `origin` option (default `Thunderbird`) |
| `X-PasevSU-Organization` | `organization` option (default `PasevSU`) |
| `X-PasevSU-WAR` | the fixed identity/anti-forwarding statement (always — see below) |

Dynamic (computed per message):

| Header | Value |
| --- | --- |
| `X-PasevSU-Evidence-ID` | UUID v4 |
| `X-PasevSU-Case-ID` | `caseId` option (only when set — an empty case is omitted, never sent blank) |
| `X-PasevSU-Body-SHA256` | SHA-256 of the message body (always) |
| `X-PasevSU-Attachments-Count` | number of attachments (always — `0` is a claim, not an absence) |
| `X-PasevSU-Attachments-SHA256` | comma-separated `name=sha256` list (only when attachments exist) |
| `X-PasevSU-Attachment-N` | one header per file, `name=sha256`, `N` from 1 (only when attachments exist) |
| `X-PasevSU-Attachments-Error` | `name=reason` list — files were attached but none could be hashed |
| `X-PasevSU-Manifest-SHA256` | SHA-256 of `PasevSU_Manifest.json` (always) |
| `X-PasevSU-Merkle-Root` | hex Merkle root over body + attachment hashes (always) |
| `X-PasevSU-PGP-Fingerprint` | `pgpFingerprint` option (omitted if empty) |
| `X-PasevSU-OTS` | `pending` marker — **on by default**; untick `enableOts` to stop marking |
| `X-PasevSU-Receipt` | `requested` — only when `enableReceipt` is on |
| `X-PasevSU-Message-ID` | long `<…@forensic.evidence.pasevsu>` Message-ID (always) |
| `X-PasevSU-Sha256` | the readable digest block: `body - …`, one `name - …` per file, `timestep - …` |
| `X-PasevSU-Cripto-Engine` | 25-digit code derived from the seal |
| `X-PasevSU-Cripto-title` | the same block, AES-256-GCM encrypted under that code |
| `X-PasevSU-Created` | compose timestamp (always) |
| `X-PasevSU-Expires` | end of the freshness window (always) |
| `X-PasevSU-Nonce` | 128-bit hex, single use (always) |
| `X-PasevSU-Sequence` | per-sender monotonic counter (always) |
| `X-PasevSU-Canary` | `PASEVSU-YYYY-MM-DD-XXXXXXXX`, names this copy (always) |
| `X-PasevSU-Headers-SHA256` | SHA-256 over `manifest.signed_headers` (always) |

### The WAR marker, the WAR header and the body notice

Three things happen on **every** message and there is no setting that turns them off,
because the requirement was that they always be produced:

1. **The Subject always ends with `{{ PasevSU-WAR }}`**, appended with one space and only
   if absent — so a second `onBeforeSend` fire (Send Later, retry) cannot stack two
   markers. An empty Subject becomes the marker alone.
2. **`X-PasevSU-WAR` carries the statement**, ASCII English, exactly this and nothing
   else — 353 characters on one line:

   ```
   An email that does not carry the OpenPGP/MIME signed message (RFC 4880 and 3156) signature made with the PGP key registered to pasevdenislav@gmail.com is not ours. Only that signature proves our identity and preserves the integrity of the message. FORWARDING THIS EMAIL IS STRICTLY FORBIDDEN AND IS STATED EXPLICITLY IN THE EMAIL BODY. {{ PasevSU-WAR }}
   ```

3. **The same prohibition is repeated inside the message body**, as a constant footer: a
   blank line, the marker on its own line, the same two sentences, and the prohibition —
   313 characters, one marker, final newline:

   ```
   <blank line>
   <blank line>
   {{ PasevSU-WAR }}
   An email that does not carry the OpenPGP/MIME signed message (RFC 4880 and 3156) signature made with the PGP key registered to pasevdenislav@gmail.com is not ours.
   Only that signature proves our identity and preserves the integrity of the message.
   FORWARDING THIS EMAIL IS STRICTLY FORBIDDEN.
   ```

   An HTML composer receives the same three sentences in
   `div.pasevsu-war[data-pasevsu-war="1"]` with the signer as a `mailto:` link — same
   wording, markup only. Headers are invisible to the recipient, and the request was that
   the prohibition be explicitly stated *in the email*, so this is the **exact suffix** of
   every body the add-on sends.

The header is `X-PasevSU-WAR` and not `PasevSU-WAR` because Thunderbird refuses any custom
header name that does not begin with `X-` or `List-`, and a refused `setComposeDetails()`
**aborts the send with no dialog**. The bare `PasevSU-WAR:` field can only be written by
something that composes the message itself — `psemp-gateway`'s `composeEvidence()` does,
though it has no transport to send it (§2 of the protocol) — the same twin arrangement as
`Message-ID` / `X-PasevSU-Message-ID`.

The WAR text is phrased as a **requirement, not a claim**: this add-on does not sign.
Thunderbird's own OpenPGP signs per identity, so a message can only be vouched for by the
signature that identity attaches. The sentence is negative ("an email that does **not**
carry … is not ours") because a positive claim would be false whenever signing is off.

`X-PasevSU-Body-SHA256` is the hash of the **authored** body, taken before the footer is
appended. To reproduce it, strip the footer with `body.endsWith(WAR_NOTICE_TEXT)` and cut
exactly that many characters — never cut at the marker, because an authored body is
allowed to contain the marker too. `psemp-gateway/PROTOCOL.md` §4a holds the same texts,
and `test/extension-arming.cjs` fails if either engine's copy drifts. The opt-in
`[XXXXXXXX]` Subject tag is separate (off by default) and is spliced **before** the
marker, which stays last: `Case 2026 [34AEF2D1] {{ PasevSU-WAR }}`.

### Signed metadata, replay and the canary

Everything above except the conditional rows is produced on **every** send; nothing
here is a per-message opt-in. The last six exist because a signature over the body
alone is weak:

* **`signed_headers`** hashes Subject, From, To, Date, Message-ID and the attachment
  set, so metadata cannot be rewritten around a validly signed body. Its digest is
  published as `X-PasevSU-Headers-SHA256`.
* **Replay defence** — nonce + sequence + `created`/`expires` + recipient binding is
  always on. `REPLAY_DEFAULTS` is deliberately **not** in the options page: an
  optional anti-replay check is off in exactly the messages that matter. A
  MailExtension cannot keep a nonce store, so the extension mints and publishes
  the values and a downstream store enforces them.
* **`-Canary`** names this copy, so a leaked print or export traces back to the
  transmission and the mailbox it was minted for. It is derived, never random —
  every input is in the manifest, so it is recomputable from the attached package.

The full specification, including the manifest field order, the Merkle algorithm,
the five replay verdicts and the evidence package, is
[`../psemp-gateway/PROTOCOL.md`](../psemp-gateway/PROTOCOL.md). The gateway's
`seal` command fills the SHA3-512/BLAKE3 slots and adds the real `.asc` + `.ots`
sidecars; `package` builds `PasevSU_Package.json`.


### The digest block

`X-PasevSU-Sha256` gathers the digests into one value, in this order:

```
body - 1c4ef564075a26102c66f80f34142b3fabdfee3af8cf95903f3d328ff3f54427
document.pdf - 5f1a…  index,odd.txt - d3dc…  timestep - 2026-11-16T14:00:49.056Z
```

Rows are separated by `,`, not by RFC 5322 folding: Thunderbird hands
`customHeaders` back as single-line values and rewrites `[\r\n]+` to a space, so a
folded block would be silently flattened. A `,` or `=` inside a file name is
replaced by `_` (see `headerToken()`), so the row count is always
`1 + files + 1`. `timestep` is the exact instant written into the manifest's
`timestamp`, so the header and the seal can never describe different moments.

`X-PasevSU-Cripto-Engine` is **derived, never random**:
`SHA-256("PasevSU-Cripto-Engine:v1|<merkle-root>|<body-sha256>")`, first 24 hex
digits, reduced modulo 10²⁵, zero-padded to 25 digits. A recipient can therefore
recompute it from the Merkle root they already hold, and `psemp-gateway` computes
the same value independently — `test/extension-arming.cjs` fails if the two ever
disagree.

`X-PasevSU-Cripto-title` is the block encrypted with AES-256-GCM under a key and IV
derived from that code, wire format `gcm1.<iv>.<tag>.<ciphertext>` in base64url.
This is **not secrecy against the recipient** — the code travels in the same
message — it keeps file names and digests out of plaintext header scanners while
staying recoverable. A wrong code fails the GCM tag check instead of returning
plausible garbage.

`Message-ID` is written by `psemp-gateway`, which composes the whole message itself
(no SMTP transport exists in this repo, so that field reaches the wire only once
something else sends the bundle). This
extension emits the `X-PasevSU-Message-ID` twin instead, because Thunderbird's
`ComposeDetails.customHeaders` **rejects any name that does not start with `X-`**,
and a rejected `setComposeDetails()` aborts the send with no dialog at all — the
compose window just stays open. Both values are identical.

`name` is the attachment's filename with spaces and reserved characters replaced by
`_` (see `headerToken()`), so the value stays a single ASCII token. The hash itself
is always the 64-hex SHA-256 of the file's bytes.

Every attachment gets **both** the aggregated list and its own numbered header,
because a folded comma list loses its tail silently in some clients and mail gates.
`X-PasevSU-Attachments-Count` is always written: without it, a reader cannot tell
a message that carried no files from an add-on that failed to hash them.

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
  "message_sha3_512": null,
  "attachments": [
    { "filename": "document.pdf", "sha256": "...", "sha3_512": null, "blake3": null }
  ],
  "merkle_root": "...",
  "timestamp": "...",
  "evidence_id": "..."
}
```

`message_sha3_512`, each `sha3_512` and every `blake3` are written as `null` by the
extension, because Web Crypto has no SHA3-512 and BLAKE3 is not available inside a
MailExtension. They are not decoration: the gateway's `seal` step (see
[Signing strength](#signing-strength)) fills them in and signs the result. `null`
therefore means "not computed yet" and must never be read as "verified".

### Long values travel as chunks

RFC 5322 §2.1.1 caps a header line at **998 octets**, and Thunderbird does not fold a custom
header for us — `sanitizeCustomHeaderValue()` in `ext-compose` only trims. A message with 14
attachments produces a digest block of ~1.7 kB and an encrypted copy of ~2.5 kB, so those
values leave on several lines:

```
X-PasevSU-Sha256: body - 1c4ef56…,evidence-001.pdf - 9ab3…,evidence-002.pdf - 77c1…
X-PasevSU-Sha256-C2: ,evidence-003.pdf - 4f0e…,…
X-PasevSU-Sha256-Chunks: 3
```

The first piece keeps the original name, continuations are `-C2`, `-C3`, …, and `-Chunks`
states how many pieces there are. Reading the headers therefore means: read `-Chunks`, then
concatenate `<name>` and `<name>-C2…-Cn` with no separator. `psemp-gateway/tools/check-sent.cjs`
does that for you and fails a message that declares three chunks and carries two — a partial
digest must never pass as a short one.

Three details worth knowing:

* **A value that fits is untouched.** Short messages emit exactly the same bytes as before
  chunking existed, so nothing about a five-header mail changed.
* **The cut prefers a row boundary** (a `,`) so a `name - hash` row is rarely split across
  two lines. Reassembly does not depend on where the cut landed.
* **`-C2…-Cn` are deliberately absent from `user.js`.** They are derived and unbounded;
  registering them would claim a fixed set that does not exist. They need no entry to be sent
  or displayed.

Non-ASCII is handled before anything is written: filenames are percent-encoded
(`%D0%9F…`, exactly reversible) and free text such as the Case ID becomes an RFC 2047
encoded-word (`=?UTF-8?B?…?=`). Nothing 8-bit reaches the wire, and a CR/LF is stripped
*before* encoding rather than hidden inside base64.

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
side-load: zip `manifest.json`, `background.js`, `options.html`, `options.js` and the
whole `_locales` tree at the archive **root** into
`pasevsu-forensic-headers@pasev.example.xpi` and place it in
`<profile>\extensions\`. Entry names must use **forward slashes** even on Windows —
see [Why the archive has to be packed this way](#why-the-archive-has-to-be-packed-this-way).

[`tools/install.ps1`](tools/install.ps1) does exactly that, finds the profile, and
verifies the installed file's SHA-256 against the build:

```powershell
powershell -ExecutionPolicy Bypass -File thunderbird-extension\tools\install.ps1
```

Thunderbird **memory-maps** an installed `.xpi`, so it cannot be replaced while
Thunderbird runs — Windows answers *"the requested operation cannot be performed on
a file with a user-mapped section open"*. The script reports that and exits with code
2; quit Thunderbird and run it again. Everything else it does is already in place at
that point, so the second run only has to swap the file.

### Why the archive has to be packed this way

A side-loaded `.xpi` that Thunderbird cannot parse is **deleted without a trace**. It
is not disabled and it is not flagged; the file disappears from
`extensions\` and the add-on disappears from `extensions.json`, so the only symptom
is that the add-on count drops by one and no headers are produced. Two packing
faults each caused exactly that here, and both were silent:

| Fault | What Thunderbird sees | Why it is fatal |
| --- | --- | --- |
| `_locales` left out of the archive | `__MSG_extName__` in `manifest.json` with `default_locale: "en"` and no `_locales/en/messages.json` | The manifest cannot be resolved, so the add-on is rejected at load |
| Nested entries stored as `_locales\en\messages.json` | A file name containing a backslash | Gecko resolves archive paths with `/`; the locale tree is invisible even though the bytes are present |

The second one survives the obvious fix — adding `_locales` to the file list is not
enough if the archiver writes Windows separators. `Compress-Archive` and
`[IO.Compression.ZipFile]::CreateFromDirectory` both do. `install.ps1` now writes
each entry itself with `ZipArchive.CreateEntry`, replacing `\` with `/`, and refuses
to build at all when `default_locale` names a tree that is not in the stage folder.

[`psemp-gateway/tools/verify-install.cjs`](../../psemp-gateway/tools/verify-install.cjs)
guards this from outside: it walks the installed archive's central directory and
fails on an unreadable file list, on any backslashed entry, on a missing required
file, and on a missing `default_locale` tree. It also inflates every entry and
compares its SHA-256 with the source file of the same name, because a timestamp is
only a guess: a rebuild from a dirty stage, or a copy made after the edit, can be
newer than `background.js` and still contain the previous code. Its own test proves
each guard fires, including one fixture that is deliberately newer *and* stale —
which only the content check can catch.

The script also repairs the profile's `user.js`. Thunderbird sends only the custom
headers whose names are registered in `mail.compose.other.header`, so a profile
written by an earlier build drops every header added since — the extension computes
them, hands them to the send, and they vanish on the wire. Both that pref and
`mailnews.headers.extraExpandedHeaders` are therefore rebuilt from `background.js` on
every run, and the previous file is kept as `user.js.psemp-before-install`.

That repair is not a convenience. The add-on running in this profile was a hand-built
prototype stamped `1.5` — a version that never existed in git — and its engine knew
exactly eleven header names; the profile's `user.js` registered the same eleven. Every
header added since, the WAR marker included, was therefore neither computed nor
permitted onto the wire: a message sent from that profile carried nine (the eleven
minus the two that are conditional) and no `{{ PasevSU-WAR }}` in the subject.
`node psemp-gateway/tools/verify-install.cjs` prints *emitted*, *contract* and
*profile* side by side and fails on any gap.

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

Do not try to confirm the heartbeat by grepping the profile: `browser.storage.local`
is IndexedDB, and both the key (`psempLastLoadedAt`) and its value are written in a
compressed binary encoding, so a text search over `storage\default\moz-extension+++*`
finds nothing even when the record is there and fresh. Read the value instead — the
extension's directory under `storage\default\` (named by the UUID above, suffixed
`^userContextId=4294967295`) holds `idb\*.sqlite`, and the record's timestamp
advances on **every** Thunderbird start. That timestamp moving forward across a
restart is the proof that the add-on arms itself, with no per-message opt-in.

`psemp-gateway/test/extension-arming.cjs` runs `background.js` against a stub
`browser` object and fails if the listener is not armed at load, if the heartbeat
is written after registration, or if any error path stops returning `{ details }`
(it must never `cancel` a send).

### Proving a message was actually stamped

Being armed says the listener is registered; it says nothing about whether a send
ever reached it. The options page therefore also shows a **stamped counter** —
`Stamped N message(s). Last: …` — fed by two `browser.storage.local` keys the
listener writes on every send, after the headers are built and before the message
is released:

| Key | Contents |
| --- | --- |
| `psempSendCount` | integer, incremented per stamped send |
| `psempLastSend` | `at` (ISO time), `evidenceId`, `bodySha256`, `manifestSha256`, `merkleRoot`, `attachmentCount`, `headers` (header **names** only) |

`Stamped 0 messages — no outgoing message has been stamped yet` is the definitive
answer to "did it fire?", and it cannot be faked by a Sent folder that never hit
local disk, by *Send Later* keeping the message in its own queue, or by an identity
whose FCC target is a server-side folder. The write is best-effort: a storage
failure is swallowed so it can never block a send, and the record is not written
at all when the header injection itself fails.

To check the whole profile rather than one signal — including whether the
installed `.xpi` is the build you think it is — run:

```console
node psemp-gateway/tools/verify-install.cjs
```

It exits `0` only when the names `background.js` writes, the gateway's
`HEADER_NAMES` and the profile's `mail.compose.other.header` agree in order, the
installed copy is not older than the source, the archive itself is loadable
(readable file list, no backslashed entries, every required file present, the
`default_locale` tree present), and every file it carries is byte-identical to the
one in the repository.

### Getting the `.ots` for the newest sent message

The add-on marks `X-PasevSU-OTS: pending` because it cannot run `ots`. The bridge
is one command; it finds the newest Sent message itself, verifies the evidence
chain, and only then asks the gateway for a proof:

```console
node psemp-gateway/cli.js stamp-sent
```

- It **refuses** — exit `1`, nothing written — when the chain does not verify
  (manifest hash vs header, evidence-id, Merkle root, fingerprint claim, signature
  scope, attachment bytes, signed record vs live `Message-ID`). Timestamping a
  broken message would publish a defect as if it were proven.
- On success it writes `<evidence-id>.manifest.json` and `<evidence-id>.eml` into
  `psemp-gateway/data/pending/` (git-ignored) and stamps the **manifest**. The
  manifest is copied byte-for-byte out of the message rather than re-serialised,
  so its SHA-256 still equals `X-PasevSU-Manifest-SHA256`; re-printing the parsed
  object would quietly change the hash the proof is anchored to.
- `--profile <dir>` points at a different profile, `--file <msg>` at one message,
  `--out <dir>` at another output directory. Without `ots` installed the result is
  `"status": "pending"`, never an error.

### Checking whether a receipt came back

The add-on can only *ask* for a receipt; whether one arrives is the recipient's
decision. This separates the two, so an empty Inbox is never mistaken for a broken
send:

```console
node psemp-gateway/tools/check-receipts.cjs
```

It reads the Sent folder for messages carrying `X-PasevSU-Receipt: requested`, then
reads the incoming mail for an RFC 8098 `message/disposition-notification` part and
matches its `Original-Message-ID` to the `Message-ID` we assigned. Output:

| Field | Meaning |
| --- | --- |
| `requested` | messages that asked for a receipt |
| `indexed` | sent messages carrying PasevSU evidence headers |
| `receipts` | distinct receipts found in the incoming mail |
| `copies` | how many folder copies those receipts were read from — Gmail keeps All Mail beside the Inbox, and one acknowledgement must not count twice |
| `matched` | receipts whose `Original-Message-ID` names a message we sent — with its `evidenceId` and `manifestSha256` |
| `unmatched` | receipts for other mail, kept rather than dropped |

A receipt is never inferred from a header we wrote ourselves: it is a message that
actually travelled back. `--profile <dir>` reads another profile, `--include-sent`
also counts receipts an account sent out.

## What a recipient can verify

Every claim in the chain was re-checked against the raw source of a real sent
message (`PSEMP-E2E-15a`), not against the tools that produced it:

| Claim | Verdict |
| --- | --- |
| PGP/MIME signature is cryptographically valid | **Good signature** — `gpg --verify` exit `0`, RSA `4A1C1F8772D3B31927D96FAEB6A3C1BAFE614496` (primary `CB506C11850F99BBBBA54D09C6A8787C1FA6C393`), made 2026-11-16 13:36:54 |
| The `X-PasevSU-*` headers are covered by that signature | **Yes** — `protected-headers="v1"` repeats all ten headers inside the signed `multipart/mixed` part, so altering one breaks the signature |
| Attachment digest re-derives from the attachment bytes | **Yes** — `66ecf532…` in header, manifest and file |
| `X-PasevSU-Manifest-SHA256` matches the attached manifest | **Yes** — `800ad425…` |
| Merkle root re-derives from the recorded leaves | **Yes** — `9622207f…` |
| `X-PasevSU-Body-SHA256` re-derives from the sent body | **No** — see below |

A recipient with a stock `gpg` can therefore verify the signature, the
attachments and the manifest, and can prove the headers were not altered in
transit. Two caveats belong here rather than in a footnote:

- **`X-PasevSU-Body-SHA256` is a fingerprint of the composer buffer, not of the
  wire bytes.** Thunderbird derives the `text/plain` part from
  `ComposeDetails.plainTextBody` at send time: it prepends a CRLF, appends the
  `-- ` signature block and adds `format=flowed` trailing spaces. A hundred
  candidate transforms of the sent part (whole part, signature-stripped,
  CRLF/LF, whitespace cross-products, unstuffing, the `text/html` part) produce
  no match for the recorded digest, so a recipient cannot recompute the body
  hash. It still binds the composer's view of the text, and the PGP signature
  covers the body itself — but the header must not be read as a byte-exact
  proof of the bytes that arrived.
- **`X-PasevSU-PGP-Fingerprint` is omitted while `pgpFingerprint` is unset, and
  a MailExtension cannot read Thunderbird's OpenPGP key.** The header appears by
  contract only after the value is typed into the options page once. The sample
  message carries no fingerprint header for exactly that reason
  (`browser-extension-data/pasevsu-forensic-headers@pasev.example` does not
  exist, i.e. `storage.local` was never written). Read a missing fingerprint
  header as "not configured", never as "unsigned" — the signature still names
  the key.
- **`X-PasevSU-Version` is the config/format version, not the build.** It defaults
  to `1.0` and is typed by the user, so two very different builds can both say
  `1.0` — which is how a stale prototype went unnoticed. `X-PasevSU-Build` names
  the add-on version that actually stamped the message (`1.8` today) and is read
  from `manifest.json` at send time, so it cannot go stale by being forgotten.
  Compare messages by `Build`; read `Version` as "which settings format". A
  message with no `Build` header came from a build older than 1.8.

## Delivery receipts

Every message can request a standard delivery/read receipt — the RFC 8098 MDN
(`Disposition-Notification-To`), which is what mail clients actually honour.
It is **on by default** (`enableReceipt: true`), matching the rule that nothing
has to be switched on per message.

The request is made through Thunderbird itself, not by writing the field: the
add-on sets the native `returnReceipt` boolean on the message and Thunderbird adds
`Disposition-Notification-To`. This is not a stylistic choice. A MailExtension may
only put names starting with `X-` or `List-` into `customHeaders`; any other name
makes the platform reject the details, and because that rejection happens inside
the send path it is not caught — the message would silently never leave and no
dialog would explain it. `psemp-gateway/test/custom-header-names.cjs` enforces the
rule against both the source and the live listener.

| Field / header | Written when |
| --- | --- |
| `returnReceipt` (native compose field → `Disposition-Notification-To`) | `enableReceipt` is on **and** a sender address is known |
| `X-PasevSU-Receipt: requested` | same condition — marks the request as ours |

The address is the message's own `From:` identity, resolved from the compose
details; only if Thunderbird reports no identity does the add-on fall back to
the optional `receiptAddress` option. Nothing is written when both are empty, and
the options page then shows a warning instead of silently producing a message
that asks for no receipt.

The request is standard, not coercive: the recipient's client **asks** them, and
most clients show a dialog. Thunderbird's own per-account "Return Receipts"
setting exists independently; if both prompt, that is harmless.

### Why a receipt may still never arrive

`Disposition-Notification-To` on the wire is a *request*. Measured on this mailbox
(2026‑11‑17, `node psemp-gateway/tools/check-receipts.cjs`): 121 distinct receipts
are already sitting in the incoming mail, **one of them matched to a message this
add-on sent**, carrying `Original-Message-ID` equal to the `Message-ID` we assigned
and the same `X-PasevSU-Evidence-ID` as the sent copy. That one receipt is stored in
two mailboxes («Цялата поща» and `INBOX`) and counts once — Gmail keeps All Mail
beside the Inbox, and counting copies would report deliveries that did not happen.
So receipts do work — but they are not guaranteed, for reasons outside this add-on:

1. **MDN is voluntary.** The recipient's client decides, and some never ask. Gmail's
   **web** client does not implement MDN, so a recipient who reads mail only in a
   browser will never return one. The same `@gmail.com` address read in Thunderbird
   *does* return one — that is exactly where the matched receipt came from. The
   address is not the deciding factor; the client is.
2. **DSN — the "it reached the server" proof — is out of reach of a
   MailExtension.** RFC 3461 delivery notifications (`NOTIFY=SUCCESS`) are SMTP
   envelope parameters, not message headers. A WebExtension cannot set envelope
   parameters, the same class of limitation as `.asc` and `.ots`. Only the sending
   MTA can request them, so for a server-side delivery proof the SMTP gateway for
   `pasevsu-dev.com` has to add `NOTIFY=SUCCESS,FAILURE,DELAY`.

What the add-on guarantees is therefore the *request* plus the evidence that it
was made: `returnReceipt`, `X-PasevSU-Receipt: requested`, and — when a receipt
does come back — a `message/disposition-notification` part whose
`Original-Message-ID` ties it to the message we signed and to its `X-PasevSU-Evidence-ID`.

`check-receipts` reports what is actually known and refuses to infer the rest: it
separates *requested* from *received*, and it treats `disposition: …; deleted`
without `displayed` as "the client removed it", never as "a person read it". An
absent receipt is not evidence of non-delivery, and it must never be presented as one.

### German and Bulgarian

The options page and its hints are localised through `_locales/`:

| Locale | File | Coverage |
| --- | --- | --- |
| English (default) | [`_locales/en/messages.json`](_locales/en/messages.json) | 36 keys |
| German | [`_locales/de/messages.json`](_locales/de/messages.json) | 36 keys, mirrored |
| Bulgarian | [`_locales/bg/messages.json`](_locales/bg/messages.json) | 36 keys, mirrored |

German was the reported gap ("there is no delivery-receipt function in German"):
the checkbox, the fallback-address field, its hint, the warning and the
explanation paragraph all render in German on a German Thunderbird, including
"Lesebestätigung" terminology. Every locale must carry **exactly** the same key
set — `psemp-gateway/test/locales.cjs` fails on a missing, extra or empty key in
any language, so a half-translated panel cannot ship.

## The two signing layers

The protocol does not rely on one digest. Two layers are stacked, in this order, and the
order is not cosmetic.

| Layer | Produced by | What it is | Covers |
| --- | --- | --- | --- |
| 1 — content commitment | **this extension**, always | Merkle root + 25-digit engine code + AES-256-GCM-sealed digest block (`X-PasevSU-Merkle-Root`, `X-PasevSU-Cripto-Engine`, `X-PasevSU-Sha256`, `X-PasevSU-Cripto-title`, `X-PasevSU-Manifest-SHA256`, `X-PasevSU-Headers-SHA256`) | body, **every** attachment, compose timestamp |
| 2 — OpenPGP signature | **Thunderbird's own OpenPGP**, per identity (RFC 4880 and 3156) | a real asymmetric signature by a key only the sender holds | the MIME parts that already contain layer 1: body, **every** attachment, and `PasevSU_Manifest.json`. **Not** the outer header block — RFC 3156 signs the body part only |

Layer 1 runs inside `onBeforeSend`, which is *before* Thunderbird assembles and signs the
MIME part — so the signature covers the body, the attachments and the sealed manifest
together. Injecting anything after signing would silently invalidate the signature, and
nothing here does it.

The outer `X-PasevSU-*` header block itself is **not** covered by a PGP/MIME signature:
RFC 3156 signs the body part, not the RFC 5322 fields. That is why the metadata record is
carried a second way — `signed_headers` inside `PasevSU_Manifest.json`, which *is* a signed
part — and why `X-PasevSU-Manifest-SHA256` sits in the outer block to tie the two together.
Edit `Subject` after signing and the outer field disagrees with the signed record.

Layer 1 is a **commitment, not a signature**: its key is derived from public material
(§7 of [the protocol](../psemp-gateway/PROTOCOL.md)), so anyone can recompute and reproduce
it. That is deliberate — it must be reproducible for verification — but it means the
authentication is layer 2. `X-PasevSU-Cripto-title` is obfuscation, not confidentiality.

Because the manifest commits to `sha256` of every attachment and to the sorted
`[filename, sha256]` pairs, changing **one byte in a PDF** breaks the digest that names that
file, and layer 2 then fails over everything that is signed. Both properties are proven, not
asserted: `psemp-gateway/test/check-sent.cjs` re-hashes each part and names the altered one,
and `psemp-gateway/test/seal.cjs` refuses to seal a tampered attachment and reads the real
SHA-512 digest back out of the finished `.asc`.

**To actually get layer 2 you must turn it on in Thunderbird:** Account Settings → the
identity → *End-to-End Encryption* → select the key → tick *Digitally sign messages (by
default)*. The add-on cannot enable it, cannot read the key, and cannot sign. Without that
setting the message still carries layer 1 and still sends — but then the sentence in
`X-PasevSU-WAR` is a requirement the message does not meet, which is exactly how it is
worded.

## Limitations

- **OpenPGP / OpenTimestamps.** A MailExtension has no Node, no `gpg` and no `ots`
  binary, so real PGP signatures (`.asc`) and OpenTimestamps (`.ots`) cannot be
  generated here. `X-PasevSU-OTS: pending` is a marker for the `psemp-gateway`
  CLI, which does have both: it stamps the manifest from a vendored
  OpenTimestamps bundle with no install step, and it reads the signer out of the
  signature Thunderbird already applied, so the `X-PasevSU-PGP-Fingerprint` claim
  can be checked against the key that actually signed. There is **no SMTP proxy**
  in this repository (protocol §2), so that CLI runs over the saved message or
  bundle — not at an SMTP hop, and never on the way out. The marker is written
  **by default** on every message, so nothing is ever sent unstamped unless you
  untick `enableOts`; the server-side half lives in
  [`../psemp-gateway/`](../psemp-gateway/).
- **SHA3-512 / BLAKE3.** Web Crypto exposes only SHA-1/256/384/512. The
  extension uses SHA-256; `message_sha3_512`, each `sha3_512` and every `blake3`
  are written as `null` for the gateway to fill in (see
  [Signing strength](#signing-strength)). `null` means "not computed", never
  "verified". No BLAKE3 implementation is vendored in this repo, so `blake3`
  stays `null` unless a value is supplied with `--blake3`.
- **No MD5 / SHA1** are used by design.
- **The header shape is a contract.** `ComposeDetails.customHeaders` is an array
  of `{ name, value }` **objects** (Thunderbird ≥ 100), not `"Name: value"`
  strings. Returning a string fails schema validation inside the
  `setComposeDetails()` that Thunderbird performs on the `details` an
  `onBeforeSend` listener returns — and the failure is **silent**: no dialog, no
  error, the compose window simply stays open and nothing is sent. Version 1.3
  fixed exactly this (1.2 built strings, so every send was aborted even though
  the listener had already computed and stored its Evidence-ID).
  `background.js` therefore only ever builds headers through `buildHeader()`, and
  a header name must begin `X-` and must not begin `X-Mozilla-`
  (`psemp-gateway/test/extension-arming.cjs`, check *"custom headers are the
  { name, value } objects Thunderbird accepts"*). The same listener must also
  never emit a **duplicate** header name on a second fire, which is why
  `mergeCustomHeaders()` replaces its own earlier copies while keeping foreign
  ones.
- **Return only the property that changed.** The `details` handed to
  `onBeforeSend` is a `getComposeDetails()` snapshot, and returning it is
  *functionally the same as calling `setComposeDetails(tabId, details)`* — so it
  overwrites **every** property, including ones an add-on may not write:
  `attachments[].size` is read-only, and `identityId`, `additionalFccFolder`,
  `overrideDefaultFcc`, `overrideDefaultFccFolder` require the `accountsRead`
  permission, which this add-on deliberately does not request. The write then
  fails validation and Thunderbird aborts the send with **no dialog and no
  error** — the composer just stays open. The API docs are explicit: "only
  properties that are to be changed should be included". This was the second
  silent-abort defect, independent of the header shape: 1.3 built objects
  correctly but still returned the whole snapshot and still sent nothing. So
  `background.js` returns `{ details: { customHeaders } }` on success and `{}`
  on failure (`{}` = "no changes", message sends untouched) — never
  `{ details }` and never `{ cancel: true }`. Guarded by
  `psemp-gateway/test/extension-arming.cjs`, check *"a realistic compose
  snapshot is never echoed back as the return value"*.
- **Attachments are read with `listAttachments(tabId)`, never from `details`.**
  `ComposeDetails.attachments` is documented *"Only used in the begin\*
  functions. Attachments to add to the message."* — it is an input-only field,
  so the `details` a listener receives (a `getComposeDetails()` snapshot)
  reports an empty list while the message demonstrably carries files. Version
  1.4 hashed nothing, emitted no `X-PasevSU-Attachments-SHA256`, and attached a
  manifest with `"attachments": []` — every other check still passed, so the
  sent file was simply outside the evidence chain (`check-sent` is what caught
  it). The extension now asks `browser.compose.listAttachments(tab.id)`, keeps
  the snapshot as a fallback, and filters out its own `PasevSU_Manifest.json`
  so a second listener pass cannot hash the manifest it just added. Guarded by
  the checks *"the files are enumerated with listAttachments, not the send
  snapshot"* and *"this add-on's own manifest is not counted as a user
  attachment"*.

### Techniques deliberately not implemented

The protocol names twelve hardening techniques and records what happened to each in
[`../psemp-gateway/PROTOCOL.md`](../psemp-gateway/PROTOCOL.md) §14. Two are declined
outright, and the refusal is a decision rather than an omission:

- **Decoy files** — several near-identical attachments where only one carries a signed
  identifier. It traces a leak in media work, but in a legal evidence chain it means the
  sender knowingly fabricates documents that sit beside the real ones and cannot be told
  apart from them. The canary plus recipient binding gives the same traceability without
  polluting the evidence set (PROTOCOL §10).
- **Attachments inside an encrypted ZIP** — it adds nothing against a real attacker and
  duplicates the confidentiality Thunderbird's own encryption already provides; it only
  raises the cost for automated indexers. The sealed manifest is the part that has to
  survive (PROTOCOL §14).

A third is implemented but **off by default**: the `[XXXXXXXX]` Subject tag (§9), because
silently mutating a Subject breaks threading and saved searches for every recipient. The
WAR marker is the only thing always added to the Subject, and it is a marker, not a claim.

## Registering the header names in Thunderbird

Thunderbird will not compose or display a custom header unless its name is listed
in the `mail.compose.other.header` preference. [`user.js`](user.js) ships that
preference with **all fourteen** names, in injection order:

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

`X-PasevSU-Attachment-N` is the one header that cannot appear in the list: `N`
is a number, so the name is only known per message. Thunderbird still transmits
it; it simply will not be offered as a display column.

## Signing strength

The extension hashes with SHA-256 because that is all Web Crypto offers. SHA-256
is not the ceiling of the scheme — it is the floor, chosen so the chain can be
verified in any browser with no libraries. The stronger layer runs on the
gateway, where real binaries exist:

```powershell
node psemp-gateway/cli.js seal PasevSU_Manifest.json `
  --body message.txt --attach report=report.pdf
```

`seal` does four things the MailExtension cannot:

| Step | What it produces | Why it is stronger |
| --- | --- | --- |
| SHA3-512 | fills `message_sha3_512` and per-file `sha3_512` | 512-bit second digest, independent of SHA-256 |
| OpenPGP signature | `PasevSU_Manifest.json.asc` | binds the manifest to a private key |
| OpenTimestamps | `PasevSU_Manifest.json.ots` | proves the hash existed at a point in time |
| re-check | refuses to seal if any hash disagrees with the bytes | a tampered file cannot be blessed |

Two properties matter more than the algorithm list:

- **Sealing never moves the Merkle root.** The root is built from SHA-256 leaves
  and is already published in the headers the recipient holds. A second digest
  is added *beside* the chain, never inside it, so a sealed manifest still
  matches the `X-PasevSU-Merkle-Root` in the message it belongs to.
- **`seal` refuses rather than guesses.** If the body or an attachment no longer
  hashes to the value the manifest claims, the command reports `mismatch` and
  leaves the file untouched. A file with no bytes supplied is reported as
  `unsealedFiles`, never assumed correct.

The signature's digest is SHA-512 by default and is **read back** from the
finished `.asc` with `gpg --list-packets`, so the reported `digestAlgo` is the
one that was actually used rather than the one that was requested. Note that gpg
spells digests without a hyphen (`SHA512`, not `SHA-512`); the gateway normalises
the name and refuses SHA3 as a signature digest outright, because OpenPGP has no
SHA3 signature packet — SHA3-512 belongs in the manifest, not in the packet.

`PasevSU_Manifest.json.asc` and `.ots` are **not** attached by the extension. It
cannot produce them; the `psemp-gateway` CLI produces them afterwards, over the
saved message — this repository has no SMTP proxy to add anything at a hop (§2 of
[the protocol](../psemp-gateway/PROTOCOL.md)).


