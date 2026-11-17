# PSEMP — PasevSU Secure Evidence Mail Protocol

**Version 1.1.** Normative for [`../thunderbird-extension/`](../thunderbird-extension/) and
[`./`](./). Worked example: [`examples/PasevSU_Package.json`](examples/PasevSU_Package.json).

PSEMP makes an email message carry a checkable statement about itself: what its body
was, what its attachments were, who sent it, when, to whom, and whether this exact copy
has already been seen. The statement travels inside the message, so a recipient needs
neither a server nor a network call to check it.

Two implementations produce the same bytes:

| | `thunderbird-extension/` | `psemp-gateway/` |
| --- | --- | --- |
| Runs in | Thunderbird ESR ≥ 115 (MailExtension, Web Crypto) | Node 22 (`node:crypto`) |
| Decides headers at | compose (`compose.onBeforeSend`) | CLI / library call |
| Writes `Origin:` as | `Thunderbird` | `PSEMP-Gateway` |

Everything else — header names, header order, manifest field order, the Merkle
algorithm, the digest block, the replay record — is identical. A manifest produced by
either half verifies a manifest produced by the other; `test/extension-arming.cjs`
pins that by recomputing the extension's output with `node:crypto`.

---

## 1. Scope

PSEMP is an **integrity and provenance** layer. It is not a confidentiality layer and
never pretends to be one.

| Question | Answered? | By |
| --- | --- | --- |
| Did the body change? | yes | `X-PasevSU-Body-SHA256` |
| Did *this* attachment change? | yes, per file | `name=sha256` pairs in `-Attachments-SHA256` |
| Is the *set* of attachments the same? | yes | Merkle root + `-Attachments-Count` |
| Was the manifest edited after it was hashed? | yes | `X-PasevSU-Manifest-SHA256` |
| Was the envelope metadata edited (Subject, From, To, Date)? | yes | `signed_headers` + `X-PasevSU-Headers-SHA256` |
| Who claims to have sent it, under which key? | claim: yes · proof: gateway | `X-PasevSU-PGP-Fingerprint`, `.asc` |
| When did it exist? | claim: yes · proof: gateway | `X-PasevSU-Created`, `.ots` |
| Is this a re-sent (replayed) copy? | yes, given a nonce store | nonce + sequence (§11) |
| Which copy did a leak come from? | yes | recipient binding + canary (§10) |
| Is the content confidential? | **no — out of scope** | use PGP encryption |

### 1.1 The invariant

> **The manifest is frozen before it is hashed.**

`X-PasevSU-Manifest-SHA256` is the SHA-256 of the exact bytes of
`PasevSU_Manifest.json` that get attached. Nothing may be added to the manifest after
that point — not by the gateway, not by the user, not by a "seal" step. The gateway can
fill *pre-existing* `null` slots (SHA3-512, BLAKE3) because the extension published
those keys with `null`, and it can add sidecar files, but it can never introduce a new
key.

Every field PSEMP wants in the package is therefore minted **at compose time**, in both
engines, before serialisation. That single rule is why §8, §10 and §11 look the way they
do.

---

## 2. Architecture

```text
   ┌──────────────────────────────────────────────────────────────────┐
   │ Thunderbird ESR ≥ 115                                            │
   │                                                                  │
   │  compose window                                                  │
   │      ↓  compose.onBeforeSend(tab, details)                        │
   │  ┌────────────────────────────────────────────────────────────┐  │
   │  │ hash engine      SHA-256(body), SHA-256(each attachment)   │  │
   │  │      ↓                                                     │  │
   │  │ Merkle builder   sorted leaves → root                      │  │
   │  │      ↓                                                     │  │
   │  │ identity         Evidence-ID, Message-ID, Nonce, Sequence  │  │
   │  │      ↓                                                     │  │
   │  │ manifest builder PasevSU_Manifest.json → its SHA-256       │  │
   │  │      ↓                                                     │  │
   │  │ header builder   25 × X-PasevSU-* lines                    │  │
   │  └────────────────────────────────────────────────────────────┘  │
   │      ↓  returns { details } — the send proceeds                   │
   └──────────────────────────────────────────────────────────────────┘
                          ↓  SMTP (Thunderbird's own submission)
   ┌──────────────────────────────────────────────────────────────────┐
   │ optional: psemp-gateway  (CLI, or called by an MTA hook)          │
   │                                                                  │
   │  seal    SHA3-512 + BLAKE3 slots · gpg --detach-sign → .asc       │
   │          ots stamp → .ots    (sha512 digest by default)           │
   │  sign    one PGP/MIME signature over body + attachments (§8.2)    │
   │  package PasevSU_Package.json — the self-describing bundle (§12)  │
   └──────────────────────────────────────────────────────────────────┘
                          ↓
   ┌──────────────────────────────────────────────────────────────────┐
   │ recipient                                                        │
   │  verify  7 steps (§13), offline, no PasevSU software required     │
   │  replay  consult a nonce store (§11)                              │
   └──────────────────────────────────────────────────────────────────┘
```

There is **no SMTP proxy** in this repository. `psemp-gateway` is a CLI plus a library;
it does not sit in the mail path. The practical consequence is stated once and honoured
everywhere: *the extension is the only writer that can decide, and it decides before the
message leaves.*

Stages the gateway performs are additive and optional. A message sealed by the gateway
is strictly stronger than one that was not; a message that was never sealed is still
verifiable for integrity, it just has no third-party signature or timestamp proof.

---

## 3. The two engines and the platform limits

A MailExtension is not a browser extension with extra powers; it is a browser extension
with *fewer* ones. Five limits shape the contract, and each one is visible in the design:

1. **`X-` prefix only.** `ComposeDetails.customHeaders` rejects any field name that does
   not start with `X-`, `List-` or the one allowed literal (`msip_labels`), and rejects
   `X-Mozilla-*`. A real `Message-ID:` therefore cannot be written by the extension.
   PSEMP sets `X-PasevSU-Message-ID` as the twin and puts the same value in
   `manifest.provenance.message_id`; only a component that composes the message itself
   (`composeEvidence()`) writes the real header, and nothing here transmits it (§2).
   The delivery receipt (`Disposition-Notification-To`, RFC 8098 MDN) is **not** written
   as a custom header either: the extension sets the native `returnReceipt` boolean and
   Thunderbird adds that field itself, alongside `X-PasevSU-Receipt`.
2. **A rejected `setComposeDetails()` aborts the send silently.** No dialog, no console
   error the user notices — the compose window simply stays open, and in the
   `onBeforeSend` path the throw is not caught at all, so the send promise is never
   settled. Every header value is therefore sanitised (`[\r\n]+` → space) and every
   header name is from the fixed allowlist in §4 — plus `enforceAllowedCustomHeaders()`
   drops anything inadmissible as a last line of defence.
   `test/custom-header-names.cjs` pins the rule against both the source and the live
   listener; `test/extension-arming.cjs` asserts each name is a legal field name.
3. **No `gpg`, no `ots`, no subprocesses.** OpenPGP signing and OpenTimestamps cannot run
   inside a MailExtension. The extension writes `X-PasevSU-OTS: pending` as a **marker**
   and never fabricates a proof.
4. **No SHA3-512, no BLAKE3 in Web Crypto.** The extension writes those manifest slots as
   `null`; the gateway fills them. Filling a published `null` does not violate §1.1.
5. **Only `customHeaders` in the result.** Returning the whole `getComposeDetails()`
   snapshot writes read-only properties and aborts the send. The listener returns
   `{ details: { customHeaders } }` and nothing else.

`require()` and Node built-ins are forbidden in `background.js`. Everything there is
WebExtension APIs plus `crypto.subtle`.

---

## 4. Header contract

Twenty-four `X-PasevSU-*` names plus two standard headers. **The order is a three-way
contract** and must stay identical in all three places: `HEADER_NAMES` in
[`api.js`](api.js), the `buildHeader()` call order in
[`../thunderbird-extension/background.js`](../thunderbird-extension/background.js), and
`mail.compose.other.header` in
[`../thunderbird-extension/user.js`](../thunderbird-extension/user.js).
Two tests keep it honest: `test/verify-install.cjs` compares `contractNames()` (sliced out of
`api.js`) with `emittedNames()` (regexed out of `background.js`) using `deepStrictEqual`
**including order**, and `test/settings-parity.cjs` checks `user.js` against `api.js`.

Example values below are real output from
[`examples/PasevSU_Manifest.json`](examples/PasevSU_Manifest.json).

| # | Header | Example | Present |
| --- | --- | --- | --- |
| 1 | `X-PasevSU-Version` | `1.1` | always |
| 2 | `X-PasevSU-Build` | `1.8` | always — the emitting build's own version |
| 3 | `X-PasevSU-Framework` | `Forensic-Mail` | always |
| 4 | `X-PasevSU-Origin` | `Thunderbird` / `PSEMP-Gateway` | always |
| 5 | `X-PasevSU-Organization` | `PasevSU` | always |
| 6 | `X-PasevSU-WAR` | see §4a | always |
| 7 | `X-PasevSU-Evidence-ID` | `ev-8f14e45fceea167a` | always |
| 8 | `X-PasevSU-Case-ID` | `CASE-2026-001` | when configured |
| 9 | `X-PasevSU-Body-SHA256` | `4121f576…885d5955` | always |
| 10 | `X-PasevSU-Attachments-Count` | `2` | always (`0` when none) |
| 11 | `X-PasevSU-Attachments-SHA256` | `report.pdf=4de6b94f…,stmt.txt=066167e6…` | when attachments exist |
| 12 | `X-PasevSU-Attachments-Error` | `photo.jpg=UNREADABLE` | only when one could not be read |
| 13 | `X-PasevSU-Manifest-SHA256` | `49ba81a1…397e287` | always |
| 14 | `X-PasevSU-Merkle-Root` | `95a9269a…abd9ea2` | always |
| 15 | `X-PasevSU-PGP-Fingerprint` | `A1B2…5678` | when configured |
| 16 | `X-PasevSU-OTS` | `pending` | only when `enableOts` |
| 17 | `X-PasevSU-Receipt` | `requested` | only when `enableReceipt` |
| 18 | `X-PasevSU-Message-ID` | `<PasevSU.20261116140000.ev-…@forensic.evidence.pasevsu-dev.com>` | always |
| 19 | `X-PasevSU-Sha256` | `body - 4121…,report.pdf - 4de6…,stmt.txt - 0661…,timestep - 2026-11-16T14:00:00.000Z` | always |
| 20 | `X-PasevSU-Cripto-Engine` | `9572595485317120971519535` | always |
| 21 | `X-PasevSU-Cripto-title` | `gcm1.fJrzS3nqWX5dErhA.UnuTZ…` | always |
| 22 | `X-PasevSU-Created` | `2026-11-16T14:00:00.000Z` | always |
| 23 | `X-PasevSU-Expires` | `2026-11-16T15:00:00.000Z` | always |
| 24 | `X-PasevSU-Nonce` | `f47ac10b58cc43728e19d1b7f3c5a2e6` | always |
| 25 | `X-PasevSU-Sequence` | `42` | always |
| 26 | `X-PasevSU-Canary` | `PASEVSU-2026-11-16-38F47C99` | always |
| 27 | `X-PasevSU-Headers-SHA256` | `617cef0d…88c7ff` | always |
| — | `Message-ID` | same value as #18 | gateway only (§3.1) |
| — | `PasevSU-WAR` | same value as #6 | gateway only (§4a) |
| — | `Disposition-Notification-To` | the receipt address | only when `enableReceipt` — written by **Thunderbird**, via `returnReceipt`, never by the extension |

Rules that fall out of the table:

* **`X-PasevSU-Attachment-N` is a family, not a row.** When attachments exist the
  extension also emits one `X-PasevSU-Attachment-<N>` per file, `name=sha256`, `N` from 1.
  It cannot live in the fixed-order contract because its count varies, so it is documented
  here and checked separately; the single-row `-Attachments-SHA256` list is the
  order-independent summarised form.
* **Row separators are `,`, never RFC 5322 folding.** A folded header needs CRLF, and
  CRLF in a value is header injection — refused by `sanitizeHeaderValue()`, asserted by the
  `header-injection-safety` case in `selfTest()` (`api.js`, run by `test/self-test.cjs`) and
  by a hostile `\r\nBcc:` recipient in `test/replay-package.cjs`. Inside a row, `,` and `=`
  are mapped to `_` by `headerToken()` so a filename cannot forge a boundary.
* **`null` slots stay in the manifest, absent headers stay absent.** A header that would
  be empty is omitted entirely rather than sent blank — a blank field and a missing field
  are different statements.
* **Headers are appended, never replaced.** `details.customHeaders` is
  `[...(details.customHeaders || []), ...newLines]`; a second `onBeforeSend` fire filters
  out our own names first so a message never carries a header twice.

### 4b. An over-long value travels as chunks, never on one line

RFC 5322 §2.1.1 caps a header line at **998 octets**, and Thunderbird does not fold a custom
header for us: `sanitizeCustomHeaderValue()` in `ext-compose` only trims. So a value we cannot
make short — a 14-attachment digest block is ~1.7 kB, the encrypted copy ~2.5 kB — travels as
several lines instead of one illegal one.

| Piece | Name | Value |
| --- | --- | --- |
| first | `X-PasevSU-Sha256` | the first ≤ 900 characters |
| continuation | `X-PasevSU-Sha256-C2`, `-C3`, … | the next ≤ 900, in order |
| count | `X-PasevSU-Sha256-Chunks` | `2`, `3`, … |

Rules the two engines share (`background.js`, `api.js`):

* **A value that already fits is emitted byte-identical.** Nothing is rewritten to make
  room, so every short message and every existing fixture stays exactly as it was.
* **The cut prefers a row boundary.** `splitLossless()` looks for the last `,` inside the
  last 300 characters of the window and cuts there, so a chunk boundary rarely falls inside
  a `name=hash` row. If no comma is close enough it cuts at the limit; reassembly does not
  care where the cut landed.
* **Reassembly is plain concatenation** of piece 1 then `-C2…-Cn`, with no separator. The
  `<name>-Chunks` header states the count, so a reader can tell "short" from "truncated" —
  a message that declares 3 chunks and carries 2 must fail, not verify a partial digest.
* **Chunk names are derived, not registered.** `user.js` pre-registers the base names in the
  Thunderbird header lists; `-C2…-Cn` are unbounded and exist only so the value can travel,
  so registering them would be a lie about a fixed set.
* **Non-ASCII never reaches the wire.** File tokens are percent-encoded by `headerToken()`
  (`%D0%9F…`, exactly reversible, `%` itself encoded) and free text becomes an RFC 2047
  encoded-word `=?UTF-8?B?…?=` in `headerSafeValue()`. Sanitising happens **before**
  encoding, so a CR/LF is refused rather than hidden inside base64.
* **Both emitters apply the rule twice.** `buildHeaders()` splits everything it produces,
  and `enforceAllowedCustomHeaders()` splits again anything that reached the map by another
  route. Two nets, because one forgotten path is an unsent letter.
* **The verifier joins before it compares.** `headerGetJoined()` in `check-sent.cjs` reads
  `<name>-Chunks` and concatenates the pieces before any hash comparison — otherwise it would
  verify a truncated digest and call a correct message a forgery.

This is registered as DEF-95. The emitter side is guarded by `tests/thunderbird-header-budget.cjs`
(20 attachments: no value over the ceiling; with both nets disabled the same fixture reaches
3439 characters), the verifier side by `psemp-gateway/test/check-sent.cjs` (14 attachments
reassemble; a withheld chunk fails).

---

## 4a. The WAR line, the Subject marker, and the body notice

Three things happen on **every** message, with no setting to turn them off. They were
requested in Bulgarian as: "в края на темата винаги да се вписва `{{ PasevSU-WAR }}`… а в
хедъра PasevSU-WAR… ПРЕПРАЩАНЕТО НА ТОЗИ ИМЕЙЛ Е СТРОГО ЗАБРАНЕНО И ИЗРИЧНО ПОСОЧЕНО В
ИМЕЙЛА".

1. **The Subject ends with `{{ PasevSU-WAR }}`.** Appended with exactly one space, only if
   absent, so a second `onBeforeSend` fire (Send Later, retry, re-open) cannot stack two.
   The authored Subject is otherwise untouched; an empty Subject becomes the marker alone.
   This works because `onBeforeSend` may return a `subject` and Thunderbird re-reads
   `msgCompFields.subject` when it builds the message — measured in `MsgComposeCommands.js`.
2. **`X-PasevSU-WAR` carries the statement**, ASCII English, in full — this is the exact
   value, 353 characters on one line, and no other:

   ```
   An email that does not carry the OpenPGP/MIME signed message (RFC 4880 and 3156) signature made with the PGP key registered to pasevdenislav@gmail.com is not ours. Only that signature proves our identity and preserves the integrity of the message. FORWARDING THIS EMAIL IS STRICTLY FORBIDDEN AND IS STATED EXPLICITLY IN THE EMAIL BODY. {{ PasevSU-WAR }}
   ```

   It is written as a **requirement, not a claim**: the extension cannot sign, so it must
   never assert that a signature is attached. Thunderbird's own OpenPGP signs per identity.
   The sentence is negative on purpose ("an email that does **not** carry … is not ours"),
   because that is what the request says and because a positive claim could be false.
3. **The same prohibition is repeated in the message body**, because a header is invisible
   to the recipient. `WAR_NOTICE_TEXT` is appended verbatim and is exactly:

   ```
   <blank line>
   <blank line>
   {{ PasevSU-WAR }}
   An email that does not carry the OpenPGP/MIME signed message (RFC 4880 and 3156) signature made with the PGP key registered to pasevdenislav@gmail.com is not ours.
   Only that signature proves our identity and preserves the integrity of the message.
   FORWARDING THIS EMAIL IS STRICTLY FORBIDDEN.
   ```

   That is `\n\n{{ PasevSU-WAR }}\n` + sentence + `\n` + sentence + `\n` + prohibition +
   `\n` — 313 characters, one marker, and a final newline. An HTML composer receives the
   same three sentences inside `div.pasevsu-war[data-pasevsu-war="1"]` (`WAR_NOTICE_HTML`),
   with the signer as a `mailto:` link: same wording, markup only.

**Verifying the body digest, precisely.** Do **not** cut at the marker — an authored body
may legitimately contain `{{ PasevSU-WAR }}` itself. Cut with an exact suffix test:

```js
const authored = body.endsWith(WAR_NOTICE_TEXT) ? body.slice(0, -WAR_NOTICE_TEXT.length) : body;
// sha256(utf8(authored)) must equal X-PasevSU-Body-SHA256
```

`WAR_HEADER_TEXT`, `WAR_NOTICE_TEXT` and `WAR_NOTICE_HTML` are the same bytes in both
engines, and `test/extension-arming.cjs` fails if they ever drift.

**Why `X-PasevSU-WAR` and not `PasevSU-WAR`.** `ComposeDetails.customHeaders` accepts only
names beginning `X-`/`List-`, plus `msip_labels`; anything else makes `setComposeDetails()`
throw, and Thunderbird then aborts the send **with no dialog** (a silent data-loss class of
bug). Only the gateway, which composes the whole message, can emit the unprefixed
`PasevSU-WAR:` — into the bundle, not onto the wire, since it has no transport (§2) — the
same asymmetry as `Message-ID` / `X-PasevSU-Message-ID`. Both engines therefore emit the
`X-` form, and the gateway additionally emits the bare twin.

**The body hash covers the authored body, not the notice.** The digest is taken before the
footer is appended and is a field name (`X-PasevSU-Body-SHA256`), so the ordering is
recoverable. `X-PasevSU-Headers-SHA256` is computed over the already-marked Subject, which
stops the mandated marker from ever looking like tampering.

**Not the same thing as §9.** §9's `[XXXXXXXX]` Subject tag is **opt-in** and sits *before*
the marker (`Case 2026 [34AEF2] {{ PasevSU-WAR }}`); the marker itself is unconditional and
always last.

---

## 5. The manifest

`PasevSU_Manifest.json`, attached to the message. **Key order is part of the contract** —
both engines serialise in exactly this order, and `test/replay-package.cjs` asserts the
tail order with `Object.keys`.

| # | Field | Type | Written by | Meaning |
| --- | --- | --- | --- | --- |
| 1 | `framework` | string | both | `PasevSU` |
| 2 | `version` | string | both | protocol version, `1.1` |
| 3 | `message_sha256` | hex | both | body digest |
| 4 | `message_sha3_512` | hex \| null | gateway | filled by `seal` |
| 5 | `attachments` | array | both | `[{filename, sha256, sha3_512, blake3}]` |
| 6 | `merkle_root` | hex | both | §6 |
| 7 | `timestamp` | ISO 8601 | both | compose time |
| 8 | `evidence_id` | string | both | per-message identity |
| 9 | `algorithms` | object | both | self-description (§5.1) |
| 10 | `provenance` | object | both | watermark (§8) |
| 11 | `signed_headers` | object | both | signed metadata (§8) |
| 12 | `replay` | object | both | nonce / sequence / window (§11) |

Fields 1–8 are the PSEMP 1.0 core. **Everything from `algorithms` down was appended in
1.1, never inserted.** Appending keeps every hash the extension already published
recomputable: a 1.0 manifest and a 1.1 manifest share a byte-identical prefix, so older
verification code — and `selfTest()`'s literal-prefix assertion — keeps working, while a
1.1 reader sees the extra keys. Inserting `algorithms` above `merkle_root` would have
moved every subsequent byte for no benefit.

`attachments` entries carry `sha3_512`/`blake3` as `null` from the extension and are
filled in place by `seal`. An attachment that could not be read is **omitted from
`attachments`** and reported in `X-PasevSU-Attachments-Error` — it is never hashed as
empty bytes, because an empty-file hash is a signature over nothing.

### 5.1 `algorithms`

```json
{ "body": "SHA-256", "extra": ["SHA3-512", "BLAKE3"], "merkle": "SHA-256",
  "engine": "AES-256-GCM", "signature": "OpenPGP", "timestamp": "OpenTimestamps" }
```

The point is that a package found in ten years can be processed without guessing.
`extra` lists what *may* be present, not what *is*. MD5 and SHA-1 are absent by design,
and `test/replay-package.cjs` asserts that.

### 5.2 `replay`

```json
{ "nonce": "f47ac10b58cc43728e19d1b7f3c5a2e6", "sequence": 42,
  "issued_at": "2026-11-16T14:00:00.000Z", "expires_at": "2026-11-16T15:00:00.000Z",
  "recipient": "recipient@example.com", "single_use": true }
```

See §11 for semantics.

---

## 6. Merkle root

Input is the list of **leaf digests** — the body first, then one per attachment — each
already hex-encoded. Algorithm:

1. Drop empty or non-string leaves.
2. Sort the hex strings ascending by string comparison (not by input order, so attachment
   order never changes the root).
3. If one leaf remains, that is the root.
4. Otherwise, for each adjacent pair compute `sha256(left_hex + right_hex)` — the digest of
   the **concatenated hex text**, not of the raw bytes — duplicating the last leaf when the
   count is odd.
5. Repeat until one digest remains; hex-encode it.

Sorting is why `-Attachments-SHA256` can list files in any order while the root stays
stable; duplicating the odd leaf is the classic Bitcoin-style rule and is what makes the
fold deterministic without a length prefix.

The root covers **only** those leaves. Fields appended in §5 — `algorithms`, `provenance`,
`signed_headers`, `replay` — are *not* Merkle input. They are covered by
`X-PasevSU-Manifest-SHA256` instead, which is the whole point of the split: the Merkle root
stays a pure statement about content, and the manifest hash covers the record around it.

Coverage: `referenceMerkle()` in `test/extension.cjs` is an independent reimplementation, and
`test/extension-arming.cjs` compares it against the extension's output for a **1-leaf** tree
(root must equal the leaf) and a **3-leaf** tree (body plus two attachments, which exercises
the odd-leaf duplication). The gateway side is checked in `test/self-test.cjs` and the
cross-engine agreement in `test/pgp-thunderbird.cjs`.

---

## 7. The digest block and the crypto engine

`X-PasevSU-Sha256` is a single readable block, because a recipient reading headers in
Thunderbird should not have to open an attachment to see what was sent:

```text
X-PasevSU-Sha256: body - 4121f576…,report.pdf - 4de6b94f…,stmt.txt - 066167e6…,timestep - 2026-11-16T14:00:00.000Z
```

`X-PasevSU-Cripto-Engine` is a **25-digit** code. It is *derived*, never random:

```text
seed  = sha256("PasevSU-Cripto-Engine:v1|<merkle_root>|<body_sha256>")
code  = BigInt("0x" + seed.slice(0,24)) mod 10^25, zero-padded to 25 digits
```

A random code would be a serial number with no binding; a derived one binds the code to
the content, so two messages with the same code necessarily had the same body and the
same attachment set.

`X-PasevSU-Cripto-title` is the **same digest block**, AES-256-GCM encrypted and
deterministically encoded as `gcm1.<iv>.<tag>.<ciphertext>` (base64url), with

```text
key = sha256("PasevSU-Cripto-title:v1|key|<code>")
iv  = first 12 bytes of sha256("PasevSU-Cripto-title:v1|iv|<code>|<merkle_root>")
```

> **This is not confidentiality.** The key is derived from public material, so anyone who
> can read the block can decrypt it. Its job is to make the block *unreadable to naive
> scanners and greppers* while staying reproducible for a verifier — a transport
> obfuscation layer, deliberately reversible. Presenting it as encryption would be a lie,
> and no PasevSU document does.

Determinism matters: the same message must produce the same `Cripto-title` every time, or
the header could not be reproduced during verification. A random IV would break that.

---

## 8. Signed metadata and the provenance watermark

A signature over the body alone is weak: someone can keep a valid signed body and re-send
it under a new subject, from a spoofed From, at a different date, or with an attachment
swapped. PSEMP therefore hashes the envelope too, into `manifest.signed_headers`:

| Field | Covers |
| --- | --- |
| `subject` | the Subject line at compose time |
| `from` | the From mailbox |
| `to` | the To list, normalised to mailbox strings |
| `date` | the compose timestamp |
| `message_id` | the same value as `X-PasevSU-Message-ID` |
| `attachments_sha256` | `sha256` over the sorted `[filename, sha256]` pairs |
| `headers_sha256` | `sha256` over the whole record **except itself** |

Two details make this useful rather than decorative:

* `attachments_sha256` sorts `[filename, sha256]` pairs, so attachment **order** never
  changes the value but a **renamed or swapped file always does**. Hashing the filenames
  alone would miss a swap; hashing the digests alone would miss a rename.
* `headers_sha256` deliberately excludes itself. A field that covers itself cannot be
  computed, and "almost covers itself" invites a forged loop. Its value is published as
  `X-PasevSU-Headers-SHA256`, so a reader can recompute it from the manifest and compare.

`manifest.provenance` is the watermark — what the message says about its own origin:

```json
{ "framework": "PasevSU", "standard": "PSEMP", "organization": "PasevSU",
  "evidence_id": "ev-8f14e45fceea167a", "recipient": "recipient@example.com",
  "message_id": "<PasevSU.20261116140000.ev-…@forensic.evidence.pasevsu-dev.com>",
  "issued_at": "2026-11-16T14:00:00.000Z" }
```

`framework` is the literal `PasevSU` in both engines, even though `DEFAULTS.framework` is
`Forensic-Mail` — the watermark names the framework, the header names the mail layer.
`recipient` is the mailbox this copy was produced **for**; that is what makes §11 and §10
work, and what lets a leaked copy be traced to the addressee it was minted for.

`Message-ID` is built to be long and visibly ours:

```text
<PasevSU.<YYYYMMDDhhmmss>.<evidence_id>+<6hex>_<6hex>~<6hex>.<6hex>@forensic.evidence.pasevsu-dev.com>
```

The `+ _ ~` characters are legal in an RFC 5322 dot-atom, so the message stays deliverable,
but no ordinary MUA generates them — a PasevSU message is recognisable by grep in any mail
store, and `<evidence_id>` inside the Message-ID links the header to the attached manifest.

The extension can only write the `X-` twin (`X-PasevSU-Message-ID`, §3.1). The real
`Message-ID:` field is emitted by `composeEvidence()` → `buildHeaderLines()` (api.js), so
every bundle carries the promoted line; what does not exist is a transport that *sends* it,
because PSEMP has no SMTP proxy (§2).

### 8.1 The two signing layers, and the order they must be applied in

One digest proves integrity only for as long as a reader trusts the digest. PSEMP therefore
stacks two layers. They are not interchangeable, and calling layer 1 a signature would be a
lie — its key is derived from public material and anyone can reproduce it (§7).

| Layer | Produced by | What it is | Covers |
| --- | --- | --- | --- |
| 1 — content commitment | extension **and** gateway, always | Merkle root + 25-digit engine code + AES-GCM-sealed digest block; no secret, fully reproducible | body, **every** attachment, compose timestamp |
| 2 — OpenPGP signature, detached | gateway `seal` (`gpg --detach-sign`, SHA-512) or Thunderbird's built-in OpenPGP (RFC 4880) | a real asymmetric signature by a key only the sender holds | exactly one file: `PasevSU_Manifest.json`. It reaches the attachments only through the hash rows inside that manifest |
| 2b — OpenPGP signature, whole message | gateway `sign-message` / `seal --signed-message` (RFC 3156 MIME, `pgp-sha512`), or Thunderbird's own OpenPGP/MIME | one asymmetric signature over one entity that **contains** the attachments, so the set itself is signed | the MIME part that already contains layer 1 — body, **every** attachment in full, and `PasevSU_Manifest.json` when it travels as a part. **Not** the outer RFC 5322 header block: RFC 3156 signs the body part only |

The rule that makes the stack work is **layer 2 is applied last, over content that already
contains layer 1**:

* the extension injects its headers and attaches the sealed manifest inside
  `onBeforeSend`, i.e. *before* Thunderbird's OpenPGP signs the assembled MIME part, so the
  signature covers body, attachments and manifest together;
* the gateway writes the sealed manifest text first and only then runs
  `gpg --detach-sign` over that exact file (`seal`, §5). Injecting a header *after* signing
  would silently invalidate the signature, and nothing here does it.

A PGP/MIME signature does **not** cover the outer header block (RFC 3156 signs the body
part, not the RFC 5322 fields), which is a known weakness of PGP/MIME and the reason the
metadata record travels a second way: `signed_headers` inside `PasevSU_Manifest.json`, which
*is* a signed part, with `X-PasevSU-Manifest-SHA256` in the outer block to tie the two
together. Editing `Subject` after signing therefore leaves an outer field that disagrees
with the signed record, and a verifier that compares them sees it.

Layer 2 exists in two shapes, and the difference is not cosmetic. The **detached** `.asc`
signs one file — the manifest — so attachment bytes are covered only *by hash*, and only for
a verifier who walks the chain. The **whole-message** signature (§8.2) signs the attachment
bytes themselves, inside one entity, so the set of files is signed too: delete a file and
the signature breaks, which no collection of per-file signatures can promise.

What each layer catches, and what neither does:

| The attacker changes | Layer 1 | Layer 2 |
| --- | --- | --- |
| one body byte | Merkle root and `X-PasevSU-Body-SHA256` diverge | manifest no longer matches its signature |
| one byte in a PDF | that attachment's `sha256` row diverges; `check-sent` names the file (§10) | same — the digest is inside the signed manifest |
| an attachment renamed or swapped | `attachments_sha256` over sorted `[filename, sha256]` pairs (§8) | same |
| Subject / From / Date / Message-ID | `X-PasevSU-Headers-SHA256` | decisively, through `signed_headers` inside the signed manifest — an edited field no longer matches it |

Neither layer provides confidentiality: encryption is Thunderbird's OpenPGP, not PSEMP's
(§15). And neither layer survives a re-mailing — a forwarded copy is a new message (§16).

### 8.2 One signature over the whole message (PGP/MIME, RFC 3156)

A detached `.asc` over `PasevSU_Manifest.json` (`seal`, §5) proves the manifest, and the
manifest describes the attachments by hash — so the chain *does* reach the files, but only
for a verifier that walks it, and only as far as the manifest itself is trusted. Nothing in
that arrangement puts attachment bytes under a signature.

Per-file signatures do not fix this either: they prove each file genuine and say nothing
about the **set**. An attacker who removes a file *and* its signature leaves every remaining
signature perfectly valid, and the message still verifies. Deleting an exhibit must be as
detectable as altering one.

`signWholeMessage()` therefore produces one signature over one entity that holds everything:

```text
multipart/signed; micalg=pgp-sha512; protocol="application/pgp-signature"
  ├── part 1 (the signed entity)
  │     multipart/mixed
  │       ├── text/plain            the body
  │       ├── application/…         attachment 1, in full
  │       └── application/…         attachment n, in full
  └── part 2
        application/pgp-signature   ONE detached signature over part 1
```

Add a file, drop a file, rename a file, or change one byte of the body or of any attachment,
and part 1 changes, so the single signature stops verifying. `verifySignedMessage()` reports
which of those happened, and names the signer from the signature packet itself.

Four byte-level rules make this hold, and none of them is cosmetic:

| Rule | Why |
| --- | --- |
| every line ends CRLF | RFC 3156 canonicalisation; a bare LF re-encoded in transit would change the signed octets |
| the entity is signed in binary, from a `Buffer` | the signature covers the octets on the wire, not a text-mode normalisation — Windows will otherwise turn LF into CRLF behind you |
| the boundary is derived from the content | the same input signs to the same bytes twice, so two runs are comparable and a re-sign of unchanged content is detectable |
| part bodies are base64, no 8-bit headers | base64 is ASCII with a fixed line length, so transport cannot corrupt the signed bytes; a non-ASCII filename goes into RFC 2231 `filename*=UTF-8''…` form instead of raw bytes |

Two consequences worth stating plainly:

* a message with **no** attachments is a bare `text/plain` part, not a one-child
  `multipart/mixed` — the same shape Thunderbird produces;
* an attachment whose bytes the caller does not hold is **refused**, not signed. Signing a
  filename with no content would certify a claim instead of evidence.

The whole-message signature is **opt-in** (`seal --signed-message`, or `sign-message`
directly) because it needs the attachment bytes, which the manifest only describes. Without
`gpg` it reports `unavailable` and returns no message: a `multipart/signed` whose second part
is hollow would look signed and verify nowhere.

The two signatures complement each other and neither replaces the other. The manifest `.asc`
is self-contained, travels with the manifest, and survives being copied out of the message.
The whole-message signature is the only one that binds the message as a whole. A message that
carries both is strictly stronger than one that carries either.

---

## 9. The subject tag

`tagSubject()` appends the first **8 hex characters** of the body SHA-256, uppercased, in
square brackets:

```text
Subject: Case 2026-001 [34AEF2D1]
```

The value is the start of `X-PasevSU-Body-SHA256`, so the Subject alone tells you which
version of the body you are looking at without opening anything. It is idempotent — a
subject that already contains the tag is left alone.

**This is opt-in, and off by default** (`applyToComposeDetails(…, { tagSubject: true })`).
Rewriting a Subject is visible to every recipient, defeats saved searches, and breaks mail
threading for everyone on the thread. A protocol that silently mutates the user's Subject
line would be reverted by the user, and rightly so. The header block (§7) carries the same
information without changing anything the recipient sees.

It is also distinct from the **mandatory** `{{ PasevSU-WAR }}` marker of §4a: that marker is
a fixed literal required on every message and always occupies the end of the Subject, while
the tag is a per-message digest prefix that is only injected on request. When both apply the
tag is spliced in **before** the marker, never after it:

```text
Subject: Case 2026-001 [34AEF2D1] {{ PasevSU-WAR }}
```

---

## 10. Canary tokens

`X-PasevSU-Canary` names this copy:

```text
PASEVSU-2026-11-16-38F47C99
```

```text
date  = UTC day of issued_at
seed  = sha256("PasevSU-Canary:v1|<organization>|<date>|<sequence>|<nonce>")
canary = "PASEVSU-" + date + "-" + seed.slice(0,8).toUpperCase()
```

It is **derived, never random** — every input lives in the manifest, so the canary is
recomputable from the package alone. `buildEvidencePackage()` does exactly that when it is
handed a bare manifest, which is why the package never reports an empty canary.

What it buys: if a printed page, a PDF export or a forwarded copy turns up somewhere it
should not be, the token identifies the exact transmission and, through `recipient`, the
mailbox it was minted for. Combined with `sequence`, a leak can be ordered in time against
other messages to the same party.

**On decoy files.** The idea of shipping several near-identical attachments where only one
carries a signed identifier was considered and deliberately not implemented. It works for
media leaks, but in a legal evidence chain it means the sender knowingly fabricates
documents, and the fabricated ones are indistinguishable from real evidence in the same
message. The canary plus recipient binding achieves the same traceability without
polluting the evidence set.

---

## 11. Replay defence

A signature proves a message is authentic. It does **not** prove the copy you hold is the
copy that was sent *now*. Nonce, sequence, freshness and recipient binding are the four
controls that close that gap; all four are minted at compose time (§1.1) and live in
`manifest.replay`.

### 11.1 The record

| Field | Meaning |
| --- | --- |
| `nonce` | 128 bits, 32 hex chars, `crypto.randomUUID()` with dashes removed |
| `sequence` | per-sender monotonic counter, persisted in `storage.local` |
| `issued_at` | compose time |
| `expires_at` | `issued_at + maxAgeSeconds` |
| `recipient` | the mailbox this copy was produced for |
| `single_use` | always `true` |

`REPLAY_DEFAULTS` is `{ maxAgeSeconds: 3600, maxSkewSeconds: 60, windowSize: 4096 }`. It is
**not** part of `DEFAULTS` and therefore not a user setting: replay defence is always on,
and no configuration can turn it off. That is deliberate — an optional anti-replay check is
a check that is off in the messages that matter.

### 11.2 Verdicts

`ReplayGuard.check(nonce, {issuedAt, expiresAt, recipient, evidenceId, now})` returns
`{ok, verdict, detail}` with one of five verdicts:

| Verdict | Meaning | `ok` |
| --- | --- | --- |
| `first-use` | nonce never seen, within the window | yes |
| `replay` | nonce already accepted | **no** |
| `expired` | `now > expires_at` | no |
| `future-dated` | `now < issued_at − maxSkewSeconds` | no |
| `unknown` | no nonce in the evidence at all | no |

`maxSkewSeconds` (60) exists because sender and receiver clocks are never equal and a
message minted 3 seconds in the future is ordinary, not suspicious.

### 11.3 Why expiry is safe

Expiry does **not** weaken integrity. The Merkle root, the manifest hash, the PGP signature
and the OTS proof stay valid forever. `expires_at` says one narrow thing: *this copy is no
longer a currently-issued statement, so refusing it costs nothing.* Losing your own archive
because a nonce aged out would be an absurd trade, and PSEMP never asks for it.

### 11.4 The store

Replay detection needs memory, and memory is state, so it is explicit rather than hidden:

* `new ReplayGuard({limits, storePath, persist})` — persistence writes `{version:1, seen}`
  through a `.tmp` file and `fs.renameSync`.
* `check()` verifies freshness **before** inserting. A refused message therefore never
  poisons the store — otherwise three forged copies would permanently blacklist a nonce the
  real sender had not yet used.
* `prune()` drops entries older than `maxAgeSeconds × 4` and enforces `windowSize`.
* A corrupt store sets `loadError` and starts empty; a failed save sets `saveError`. Neither
  throws into a send path. **A send must never fail because the replay store is unwell** —
  the message is still cryptographically sound without it.

Callers that cannot persist (the MailExtension itself) still mint nonce and sequence; they
are published in the manifest so any downstream store can enforce them. Sequence makes a
*deliberate rollback* visible even if a nonce were somehow reused: a message claiming
sequence 42 that arrives after one claiming 47 is refused regardless of its nonce.

### 11.5 What a verifier must do

1. Read `manifest.replay` (or the four headers).
2. If `nonce` is absent → `unknown` → refuse.
3. Recompute `expires_at` from `issued_at` and check it is `issued_at + 3600s`; a mismatch
   means the sender changed the TTL after the fact.
4. Check `now` against the window.
5. Look the nonce up in a store; insert on `first-use`.
6. Compare `replay.recipient` with the envelope `To` this copy actually arrived on.

Steps 3, 5 and 6 are what `verifyEvidence()` automates
(`replay-window-consistent`, `replay:<verdict>`, and the `signed_headers` cross-checks).

---

## 12. The evidence package

`PasevSU_Package.json` is the self-describing bundle: everything needed to verify the
message years later, without PasevSU software, plus an honest note about anything that was
never produced.

```text
node psemp-gateway/cli.js package PasevSU_Manifest.json --out PasevSU_Package.json
```

The committed example is [`examples/PasevSU_Package.json`](examples/PasevSU_Package.json),
byte-reproducible from [`examples/PasevSU_Manifest.json`](examples/PasevSU_Manifest.json)
with exactly that command. Top-level shape:

| Key | Contents |
| --- | --- |
| `package` | `PasevSU_Evidence_Package` |
| `standard` | `PSEMP` |
| `version` | protocol version |
| `generated_at` | when the package was written (the only non-reproducible field) |
| `algorithms` | copied from the manifest (§5.1) |
| `evidence` | id, digests, Merkle root, canary, nonce, sequence, recipient, window |
| `provenance` | watermark (§8) |
| `signed_headers` | signed metadata (§8), or `null` for a PSEMP 1.0 manifest |
| `files` | one entry per artefact, with `role` |
| `signature` | algorithm, fingerprint, and the `.asc` sidecar if present |
| `timestamp` | algorithm, and the `.ots` sidecar if present |
| `verify` | the seven verification steps (§13) |

`files` always starts with `role: "manifest"` and `role: "body"`, then one entry per
attachment. The manifest entry is the anchor: its `sha256` is the digest of the manifest
bytes themselves, so a package can never disagree with the manifest it describes.

### 12.1 Sidecars are described, not assumed

`signature.detached` and `timestamp.proof` are built by `describeSidecar()`, which reports
`present: false`, `sha256: null`, `bytes: 0` when the file is missing, and a real digest
when it exists. Each carries a note naming the step that produces it. A package therefore
says *"there is no `.asc` here"* rather than implying one exists — the failure mode that
makes most "evidence bundles" worthless in practice.

`test/replay-package.cjs` covers both branches, including a real `.asc` on disk being
digested.

---

## 13. Verification

Offline, in this order. Stop at the first failure; each step assumes the previous one.

1. **Manifest integrity.** `sha256(PasevSU_Manifest.json)` must equal
   `files[role=manifest].sha256` **and** `X-PasevSU-Manifest-SHA256`. This is the root of
   trust for everything else in the package.
2. **Content.** Recompute SHA-256 of the body and of every attachment; each must equal its
   `files` entry and its `name=hash` pair in `X-PasevSU-Attachments-SHA256`.
3. **Merkle root.** Rebuild the root from the leaves per §6; it must equal
   `evidence.merkle_root` and `X-PasevSU-Merkle-Root`.
4. **Signature.** `gpg --verify PasevSU_Manifest.json.asc PasevSU_Manifest.json`. The key
   used must be the one named in `X-PasevSU-PGP-Fingerprint`; `pgp-check` compares the claim
   with the actual signer so a valid signature from the wrong key is refused.
5. **Timestamp.** `ots verify PasevSU_Manifest.json.ots`. This is the only step that
   establishes *when*, because everything else is the sender's own claim.
6. **Envelope.** `signed_headers.subject` / `from` / `to` / `date` must match the envelope
   the message actually arrived with, and `X-PasevSU-Headers-SHA256` must recompute.
7. **Replay.** Apply §11.5. Repeat delivery of an already-accepted nonce is refused.

Steps 1–3 need nothing but `sha256sum` and a text editor. Steps 4–5 need `gpg` and `ots`.
Step 7 needs a store. `psemp-gateway` automates all seven in `verifyEvidence()`; individual
checks report separately so a partial failure is diagnosable rather than a single red mark.

### 13.1 What a verifier re-derives, and what it must take on trust

Reading a header is not verification. A string that merely *looks* like a hash, a 25-digit
code and a ciphertext would pass any check that only tests its shape, and a forged layer 1
would report OK. So `tools/check-sent` does not describe the headers, it **rebuilds** them:
it imports the same composer functions the emitter was written against and compares the
result with what arrived on the wire.

| Value | Re-derived from | A forgery that changes… |
| --- | --- | --- |
| `X-PasevSU-Sha256` block | `buildDigestBlock(bodySha256, attachments, created)` | one hash row fails |
| `X-PasevSU-Cripto-Engine` | `cryptoEngineCode({merkleRoot, bodySha256})` | one digit fails |
| `X-PasevSU-Cripto-title` | `decryptDigestBlock(engine, token, {merkleRoot})` | one ciphertext byte fails the GCM tag, and the plaintext must equal the digest block |
| `X-PasevSU-Attachments-SHA256` | the file rows of the rebuilt block | one `name=hash` pair fails |
| `X-PasevSU-Headers-SHA256` | `sha256(JSON(signed_headers))` | one character of the seal fails |
| `Subject`, `Message-ID`, attachment set | `signed_headers` inside the manifest | a swapped Subject or a removed file fails |

The `Subject` is compared after decoding RFC 2047 words and collapsing whitespace, because a
mailbox may re-fold it; meaning is compared, not rendering.

What it **cannot** do, and does not pretend to:

- `from`, `to` and `date` are covered by `headers_sha256` (so altering them breaks the seal)
  but are not compared with the live envelope, because the envelope a message arrives with
  is not in the local Sent copy. Step 6 above is a recipient-side check.
- Layer 1 is a **commitment, not a signature** (§8.1): its key is derived from public
  material so that any verifier can reproduce it. It proves the headers and the manifest
  agree with each other, nothing about who sent them. Only layer 2 — Thunderbird's own
  OpenPGP signature over the message — carries an identity.
- `X-PasevSU-PGP-Fingerprint` is a *claim* until `gpg --verify` compares it with the real
  signer. `check-sent` cannot run that comparison; `pgp-check` can, given the signed file.

---

## 14. Technique ledger

What was asked for, and what is actually in the repository. The distinction between
**implemented** and **advisory** is the whole point of this table.

| # | Technique | Status | Where |
| --- | --- | --- | --- |
| 1 | Watermark inside the cryptographic payload (recipient, timestamp, message_id) | **implemented** | `manifest.provenance` (§8) |
| 2 | Sign the headers, not only the body | **implemented** | `manifest.signed_headers` + `X-PasevSU-Headers-SHA256` (§8) |
| 3 | Decoy files carrying a hidden identifier | **declined, reason given** | §10 — canary replaces it |
| 4 | Cryptographic time (`X-Created` + proof) | **implemented**, proof needs `ots` | `-Created`/`-Expires` + `.ots` (§13.5) |
| 5 | Several signature layers (engine + PGP + mail signature) | **implemented** | engine code + manifest hash always; detached PGP + OTS via `seal`; one whole-message PGP/MIME signature via `sign-message` (§8.2) |
| 6 | Hash in the Subject | **implemented, opt-in** | `tagSubject()` (§9) |
| 7 | Canary tokens | **implemented** | `X-PasevSU-Canary` (§10) |
| 8 | Attachments inside an encrypted ZIP | **declined** | adds no strength against a real attacker; Thunderbird's own encryption covers confidentiality |
| 9 | Self-describing package | **implemented** | `PasevSU_Package.json` (§12) |
| 10 | Unambiguous attachment hashes (`name - hash`) | **implemented** | `-Attachments-SHA256` + digest block (§4, §7) |
| 11 | Stronger-than-SHA-256 digests | **implemented** (gateway) | SHA3-512, filled by `seal` (§5) |
| 12 | Replay protection | **implemented** | nonce + sequence + window + recipient (§11) |

Two were declined on purpose. A protocol document that lists only successes is a sales
sheet, not a specification.

---

## 15. The recommended stack, mapped to reality

The brief recommended: *PGP signature + PGP encryption + SHA-256 of the files + a unique
package identifier + a timestamped log.* Here is where each one actually runs:

| Layer | Who does it | State |
| --- | --- | --- |
| SHA-256 of body and every file | extension (`crypto.subtle`) **and** gateway (`node:crypto`) | done, cross-tested |
| Unique identifier | `evidence_id` + `nonce` + `sequence` + canary | done |
| Manifest, Merkle root, headers | extension, at compose time | done |
| PGP **signature** | gateway `seal` → `gpg --detach-sign` over the manifest, SHA-512 digest; and `sign-message` / `seal --signed-message` → one `multipart/signed` over body **and** every attachment (§8.2) | done, requires `gpg`. The whole-message form is opt-in because it needs the attachment bytes |
| PGP **encryption** | **Thunderbird's own OpenPGP**, not PSEMP | out of scope by design — PSEMP records, it does not encrypt; encrypting inside a MailExtension would duplicate a reviewed implementation and make the headers unreadable to the recipient |
| Real timestamp | gateway `stamp`/`seal` → `ots` | done, requires `ots` |
| Timestamped log | `ReplayGuard` store + the gateway's JSON output | done; the store is a log of accepted nonces |
| Metadata signature (Subject/Date/Message-ID/Attachments) | `signed_headers`, covered by `X-PasevSU-Manifest-SHA256` and by the PGP signature over the manifest | done |

The honest summary: **integrity, provenance and replay are finished and testable; PGP
signature and OpenTimestamps are finished but need external binaries; confidentiality is
Thunderbird's job, not PSEMP's.**

---

## 16. Open items

Known, deliberate gaps. None of them silently weakens a message that was sealed.

* **No real `Message-ID:` from the extension** — §3.1. `composeEvidence()` does produce the
  real field (§8.1), but no SMTP transport exists here to put it on the wire, so in the live
  path the message is sent by Thunderbird with the `X-` twin only.
* **No SMTP proxy** — §2. Nothing can be added to a sent message after `onBeforeSend`, which
  is a constraint PSEMP is designed around rather than against.
* **BLAKE3 is not computed** — neither Web Crypto nor the vendored OpenTimestamps groups
  provide it. The manifest has the slot; it stays `null` and the package says so.
* **`ReplayGuard.save()` is not proven atomic across concurrent writers** on Windows. The
  `.tmp` + `rename` pattern is single-writer atomic and the restart case is tested; a
  multi-process writer test is not.
* **The extension cannot persist a nonce store** — it mints nonce and sequence and relies on
  a downstream store to enforce them (§11.4).
* **A whole-message signature needs the attachment bytes, so the extension cannot do it
  alone** — §8.2. `sign-message` therefore sits outside the compose window and is opt-in: a
  manifest describes attachments by hash, and signing a filename without its content would
  certify a claim rather than evidence. In the live path this is covered by Thunderbird's own
  OpenPGP/MIME, which does sign body and attachments together; PSEMP's version exists so the
  same guarantee is available with the gateway's key and without a Thunderbird identity.
* **Does a mail signature survive a forwarding hop?** No. PSEMP verifies the copy as sent;
  a re-mailing by a third party is a new message and must be re-stamped, which is precisely
  what `Origin:` and `provenance` make visible.
* **A deployed `.xpi` is not a running `.xpi`** — Thunderbird reads an add-on once, at start,
  so the file on disk can be current while the process keeps executing the previous build.
  Nothing on the wire reveals that, because the previous build simply writes the previous
  headers — or, in the 1.8 case, blocked every send. `tools/verify-install.cjs` now compares
  the version packed inside the `.xpi` with the one recorded in `extensions.json` and fails
  with `loaded X, on disk Y - quit and reopen Thunderbird`. The restart itself stays a human
  step: no API lets an add-on reload its own code, and nothing here may kill a mail client
  that might hold an unsaved draft.
