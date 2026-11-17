#!/usr/bin/env node
/**
 * Inspect sent mail for the PasevSU evidence chain.
 *
 * The MailExtension asserts things about a message — a body hash, an attachment
 * hash, a Merkle root, a manifest hash — and until those assertions are checked
 * against the bytes that actually left the machine, "the headers are there" is
 * the only thing anyone knows. This walks a real .eml (or an mbox) and re-derives
 * every claim from the message itself:
 *
 *   - the always-on X-PasevSU-* headers are present, matched case-insensitively
 *     (Thunderbird returns custom header names in Http-Header-Case);
 *   - every hash-shaped value is 64 hex characters;
 *   - PasevSU_Manifest.json is really attached, and its bytes hash to
 *     X-PasevSU-Manifest-SHA256;
 *   - the manifest is internally consistent (its leaves hash to the root it declares);
 *   - each attachment the manifest lists is present and hashes to its claimed value.
 *
 * Usage:
 *   node psemp-gateway/tools/check-sent.cjs                   # newest sent message
 *   node psemp-gateway/tools/check-sent.cjs --all             # every sent message
 *   node psemp-gateway/tools/check-sent.cjs --only 3          # message 3, as printed
 *   node psemp-gateway/tools/check-sent.cjs path/to/mail.eml
 *   node psemp-gateway/tools/check-sent.cjs <thunderbird-profile-dir>
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const {
  sha256Hex,
  verifyManifest,
  verifyEvidence,
  buildDigestBlock,
  parseBlock,
  cryptoEngineCode,
  decryptDigestBlock,
  pgpInspectMessage,
  pgpCrossCheck,
} = require('../api.js');

const MANIFEST = 'PasevSU_Manifest.json';

const ALWAYS = [
  'X-PasevSU-Version',
  'X-PasevSU-Framework',
  'X-PasevSU-Origin',
  'X-PasevSU-Organization',
  'X-PasevSU-WAR',
  'X-PasevSU-Evidence-ID',
  'X-PasevSU-Body-SHA256',
  'X-PasevSU-Manifest-SHA256',
  'X-PasevSU-Merkle-Root',
  'X-PasevSU-Message-ID',
  // Replay defence and signed metadata are always minted, never opt-in: a message
  // missing these is not a PSEMP 1.1 message and cannot be replay-checked.
  'X-PasevSU-Created',
  'X-PasevSU-Expires',
  'X-PasevSU-Nonce',
  'X-PasevSU-Sequence',
  'X-PasevSU-Canary',
  'X-PasevSU-Headers-SHA256',
];

const HEX_FIELDS = [
  'X-PasevSU-Body-SHA256',
  'X-PasevSU-Manifest-SHA256',
  'X-PasevSU-Merkle-Root',
  'X-PasevSU-Headers-SHA256',
];

/** Values that must match a shape rather than being bare 64-hex digests. */
const SHAPED_FIELDS = [
  ['X-PasevSU-Nonce', /^[0-9a-f]{32}$/, '128-bit hex nonce'],
  ['X-PasevSU-Sequence', /^\d+$/, 'monotonic counter'],
  ['X-PasevSU-Canary', /^PASEVSU-\d{4}-\d{2}-\d{2}-[0-9A-F]{8}$/, 'canary token'],
  ['X-PasevSU-Message-ID', /^<PasevSU\..+@forensic\.evidence\.pasevsu>$/, 'PasevSU message id'],
];

/** Split an mbox into messages, or return one message for a plain .eml. */
function splitMessages(text) {
  if (!/^From /m.test(text)) return [text];
  const out = [];
  let current = null;
  for (const line of text.split(/(?<=\n)/)) {
    if (line.startsWith('From ')) {
      if (current !== null) out.push(current);
      current = '';
    } else if (current !== null) {
      current += line;
    }
  }
  if (current !== null) out.push(current);
  return out.length ? out : [text];
}

/** Header block + body. Unfolds continuation lines. */
function parseMessage(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const split = normalized.indexOf('\n\n');
  const head = split === -1 ? normalized : normalized.slice(0, split);
  const body = split === -1 ? '' : normalized.slice(split + 2);

  const headers = [];
  for (const line of head.split('\n')) {
    if (/^[ \t]/.test(line) && headers.length) {
      headers[headers.length - 1].value += ' ' + line.trim();
    } else {
      const at = line.indexOf(':');
      if (at > 0) headers.push({ name: line.slice(0, at).trim(), value: line.slice(at + 1).trim() });
    }
  }
  return { headers, body };
}

function headerGet(headers, name) {
  const lower = String(name).toLowerCase();
  // Last wins: an outer layer that re-stamps a header is the one that travelled.
  let found = null;
  for (const header of headers) if (header.name.toLowerCase() === lower) found = header.value;
  return found;
}

/** Undo the RFC 2047 encoded-words the emitter uses for non-ASCII values (a Cyrillic case id). */
function decodeEncodedWords(value) {
  if (!value) return value;
  return value.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gi, (whole, base64) =>
    Buffer.from(base64, 'base64').toString('utf8')
  );
}

/**
 * A subject compared for MEANING, not for rendering.
 *
 * Thunderbird rewrites `Subject` on send: it re-folds long lines and re-encodes non-ASCII
 * as RFC 2047, and the WAR marker sits behind `{{ }}` where an editor may add a space. A
 * byte comparison would therefore report the client's formatting as tampering. Collapsing
 * whitespace keeps the check honest — different words, a dropped marker or a swapped case
 * id still fails — without a false alarm on the first real message.
 */
function subjectKey(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reassemble a value the emitter split across several header lines.
 *
 * RFC 5322 §2.1.1 caps a header line at 998 octets and Thunderbird does not fold a custom
 * header for us, so an over-long digest block travels as `<name>`, `<name>-C2`, ... with the
 * piece count in `<name>-Chunks`. Reading only `<name>` would verify a TRUNCATED digest and
 * call it a mismatch — the failure mode this function exists to prevent.
 *
 * Returns null for a message that declares chunks and then withholds one: a broken chain
 * must not pass as a short value. A message with no `<name>` at all returns null too, so
 * callers that need to tell "absent" from "broken" read the `-Chunks` header themselves.
 */
function headerGetJoined(headers, name) {
  const count = Number(headerGet(headers, `${name}-Chunks`));
  if (!Number.isInteger(count) || count < 1) return decodeEncodedWords(headerGet(headers, name));
  let joined = '';
  for (let index = 1; index <= count; index += 1) {
    const part = headerGet(headers, index === 1 ? name : `${name}-C${index}`);
    if (part === null) return null;
    joined += part;
  }
  return decodeEncodedWords(joined);
}

function decodeQuotedPrintable(text) {
  const bytes = [];
  const joined = text.replace(/=\n/g, '');
  for (let i = 0; i < joined.length; i++) {
    const ch = joined[i];
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function decodePart(body, transferEncoding) {
  const encoding = String(transferEncoding || '').trim().toLowerCase();
  if (encoding === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64');
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(body);
  return Buffer.from(body, 'utf8');
}

function param(value, key) {
  if (!value) return '';
  const match = new RegExp(`${key}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, 'i').exec(value);
  if (!match) return '';
  return (match[2] !== undefined ? match[2] : match[1]).trim();
}

/**
 * The parts of a multipart body, preamble and epilogue discarded.
 *
 * RFC 2046 allows text before the first delimiter and after the last one, and
 * Thunderbird uses the preamble: every PGP/MIME message starts with "This is an
 * OpenPGP/MIME signed message (RFC 4880 and 3156)". Splitting on the bare delimiter
 * makes that sentence a headerless text/plain child, which then becomes
 * `children[0]` — the very child a multipart/signed signs. Reading it as a part
 * would answer "what does the signature cover?" with the preamble instead of the
 * message, so the first delimiter has to be consumed before splitting.
 */
function splitMultipart(body, boundary) {
  const marker = `--${boundary}`;
  const at = body.indexOf(marker);
  if (at === -1) return [];
  const segments = [];
  for (const segment of body.slice(at + marker.length).split(marker)) {
    if (segment.startsWith('--')) break; // closing delimiter; the epilogue is not a part
    if (!segment.trim()) continue;
    segments.push(parseMessage(segment));
  }
  return segments;
}

/**
 * Walk the MIME tree and return the leaf parts with their decoded bytes.
 * multipart/signed inside multipart/mixed is followed to its leaves.
 */
function collectParts(headers, body, depth = 0) {
  const contentType = headerGet(headers, 'Content-Type') || 'text/plain';
  const boundary = param(contentType, 'boundary');

  if (!/^\s*multipart\//i.test(contentType) || !boundary || depth > 8) {
    const disposition = headerGet(headers, 'Content-Disposition') || '';
    return [
      {
        contentType,
        disposition,
        name: param(disposition, 'filename') || param(contentType, 'name'),
        bytes: decodePart(body, headerGet(headers, 'Content-Transfer-Encoding')),
      },
    ];
  }

  const parts = [];
  for (const parsed of splitMultipart(body, boundary)) {
    parts.push(...collectParts(parsed.headers, parsed.body, depth + 1));
  }
  return parts;
}

function partName(part) {
  return part.name || '';
}

/** The MIME structure, kept nested: coverage is a question about containment. */
function mimeTree(headers, body, depth = 0) {
  const contentType = headerGet(headers, 'Content-Type') || 'text/plain';
  const disposition = headerGet(headers, 'Content-Disposition') || '';
  const boundary = param(contentType, 'boundary');
  const node = {
    contentType,
    disposition,
    name: param(disposition, 'filename') || param(contentType, 'name'),
    bytes: null,
    children: [],
  };
  if (!/^\s*multipart\//i.test(contentType) || !boundary || depth > 8) {
    node.bytes = decodePart(body, headerGet(headers, 'Content-Transfer-Encoding'));
    return node;
  }
  for (const parsed of splitMultipart(body, boundary)) {
    node.children.push(mimeTree(parsed.headers, parsed.body, depth + 1));
  }
  return node;
}

/**
 * How far the OpenPGP signature actually reaches.
 *
 * "Signed" is not "signed whole". Thunderbird's PGP/MIME signs the FIRST part of a
 * multipart/signed, so a message whose files sit next to the signed part as
 * siblings of an outer multipart/mixed carries a signature that says nothing about
 * the files — the exact shape this tool reported as green while the user reported
 * "целият мейл не се подписва". Containment is therefore checked structurally: the
 * signed part must be the outermost one, and no payload part may live outside it.
 *
 * Only the detached signature itself is exempt, and only by content type. An earlier
 * version also dropped anything named `*.asc`/`*.sig` and the manifest, which made the
 * containment check vacuous: with every named part filtered out of `outside`, "the
 * signature covers the files" passed while nothing was being compared.
 */
function payloadNames(node, into = []) {
  if (/^\s*application\/(?:pgp-signature|x-pkcs7-signature)\b/i.test(node.contentType)) return into;
  if (node.name) into.push(node.name);
  for (const child of node.children) payloadNames(child, into);
  return into;
}

function signatureScope(text) {
  const { headers, body } = parseMessage(text);
  const root = mimeTree(headers, body);

  let signedNode = null;
  const find = (node) => {
    if (signedNode) return;
    if (/^\s*multipart\/signed/i.test(node.contentType)) {
      signedNode = node;
      return;
    }
    for (const child of node.children) find(child);
  };
  find(root);

  const all = payloadNames(root);
  if (!signedNode) return { found: false, topLevelSigned: false, inside: [], outside: all, all };

  const entity = signedNode.children[0] || null;
  const inside = entity ? payloadNames(entity) : [];
  const remaining = all.slice();
  for (const name of inside) {
    const index = remaining.indexOf(name);
    if (index !== -1) remaining.splice(index, 1);
  }
  return { found: true, topLevelSigned: signedNode === root, inside, outside: remaining, all };
}

/** Re-derive every claim a sent message makes about itself. */
function inspectMessage(text) {
  const { headers, body } = parseMessage(text);
  const parts = collectParts(headers, body);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail: detail || '' });

  const present = new Set();
  for (const header of headers) if (/^x-pasevsu-/i.test(header.name)) present.add(header.name.toLowerCase());

  const missing = ALWAYS.filter((name) => !present.has(name.toLowerCase()));
  add(
    'always-on headers present',
    missing.length === 0,
    missing.length ? `missing ${missing.join(', ')}` : `${ALWAYS.length}/${ALWAYS.length}`
  );

  for (const name of HEX_FIELDS) {
    const value = headerGetJoined(headers, name) || '';
    add(`${name} is sha256 hex`, /^[0-9a-fA-F]{64}$/.test(value), value ? `${value.length} chars` : 'absent');
  }

  for (const [name, pattern, label] of SHAPED_FIELDS) {
    const value = headerGetJoined(headers, name) || '';
    add(`${name} is a ${label}`, pattern.test(value), value || 'absent');
  }

  const claimedManifestHash = headerGetJoined(headers, 'X-PasevSU-Manifest-SHA256') || '';
  const manifestPart = parts.find((part) => partName(part).toLowerCase() === MANIFEST.toLowerCase());

  if (!manifestPart) {
    // The exact failure this tool exists for: headers advertising a manifest that
    // was never attached. Thunderbird drops ComposeDetails.attachments outside the
    // begin* functions, so this is a live failure mode, not a hypothetical one.
    add(
      'manifest attached',
      false,
      claimedManifestHash
        ? `${MANIFEST} absent although X-PasevSU-Manifest-SHA256 is set`
        : `${MANIFEST} absent`
    );
    return { checks, ok: false, manifest: null };
  }
  add('manifest attached', true, `${manifestPart.bytes.length} bytes`);

  const manifestText = manifestPart.bytes.toString('utf8');
  const hashCheck = verifyManifest(manifestText, claimedManifestHash);
  add('manifest hash matches header', hashCheck.ok, `actual=${hashCheck.actual}`);

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (err) {
    add('manifest parses as JSON', false, String(err.message));
    return { checks, ok: false, manifest: null };
  }
  add('manifest parses as JSON', true, `framework=${manifest.framework} version=${manifest.version}`);

  const evidenceId = headerGetJoined(headers, 'X-PasevSU-Evidence-ID') || '';
  add('manifest evidence-id matches header', manifest.evidence_id === evidenceId, `manifest=${manifest.evidence_id}`);

  const merkle = headerGetJoined(headers, 'X-PasevSU-Merkle-Root') || '';
  add('manifest merkle-root matches header', manifest.merkle_root === merkle, `manifest=${manifest.merkle_root}`);

  // Prove the manifest agrees with itself before any bytes are compared.
  for (const check of verifyEvidence(manifest, {}).checks) {
    if (check.name === 'merkle-consistency') add('manifest is self-consistent', check.ok, check.detail);
  }

  const claimed = Array.isArray(manifest.attachments) ? manifest.attachments : [];
  // Reassembled across `<name>`/`<name>-C2…-Cn`: a 14-attachment message puts this value
  // over the RFC 5322 line limit, so reading only the first piece used to look like a
  // header that forgot most of its files.
  const listedName = 'X-PasevSU-Attachments-SHA256';
  const declaredChunks = Number(headerGet(headers, `${listedName}-Chunks`));
  const listedRaw = headerGetJoined(headers, listedName);
  const listed = listedRaw || '';
  if (Number.isInteger(declaredChunks) && declaredChunks > 0 && listedRaw === null) {
    add('Attachments-SHA256 header reassembles from its chunks', false, 'a chunk is missing');
  }

  // Every attachment the manifest lists must be present with the claimed bytes.
  for (const entry of claimed) {
    const part = parts.find((candidate) => partName(candidate) === entry.filename);
    if (!part) {
      add(`attachment ${entry.filename}`, false, 'not present in the message');
      continue;
    }
    const actual = sha256Hex(part.bytes);
    add(`attachment ${entry.filename}`, actual === entry.sha256, `manifest=${entry.sha256} actual=${actual}`);
  }

  // ...and every attachment that travelled must be accounted for. The extension
  // omits an attachment it could not read, so the file can be sent while the
  // manifest stays silent about it — a hole the headers would otherwise hide.
  const listedNames = new Set(claimed.map((entry) => entry.filename));
  for (const part of parts) {
    const name = partName(part);
    if (!name || name === MANIFEST) continue;
    // Signature and timestamp sidecars describe the manifest; they are not payload.
    if (/\.(asc|ots)$/i.test(name)) continue;
    add(`attachment ${name} is in the manifest`, listedNames.has(name), listedNames.has(name) ? '' : 'not listed');
  }

  // ---------------------------------------------------------------------------
  // DOES THE SIGNATURE COVER THE MESSAGE?
  //
  // The user's requirement is the strong one: the signature must reach the files,
  // not just the text. These three checks are what "подписът обхваща всичко заедно с
  // прикачените файлове" means operationally.
  // ---------------------------------------------------------------------------
  const fingerprintClaim = headerGetJoined(headers, 'X-PasevSU-PGP-Fingerprint') || '';
  if (fingerprintClaim) {
    // A truncated claim is worse than no claim: 28 hex is what a case label looks
    // like, and it was published as this field once, so the shape is enforced here.
    add(
      'X-PasevSU-PGP-Fingerprint is a fingerprint or key id',
      /^(?:[0-9A-F]{16}|[0-9A-F]{40}|[0-9A-F]{64})$/i.test(fingerprintClaim.replace(/[^0-9A-F]/gi, '')),
      fingerprintClaim
    );
  }

  const signature = pgpInspectMessage(text);
  add(
    'message is OpenPGP signed',
    signature.signed,
    signature.signed ? signature.format : `not signed (${signature.reason || 'NO_SIGNATURE'})`
  );

  if (signature.signed) {
    const scope = signatureScope(text);
    // A text-only message has no named parts, so "everything is inside" holds
    // vacuously and is reported as such. A message that DOES carry files must show
    // at least one inside, otherwise the comparison proved nothing.
    const covered = scope.topLevelSigned && scope.outside.length === 0 && (scope.all.length === 0 || scope.inside.length > 0);
    add(
      'signature wraps the whole message (files inside it)',
      covered,
      !scope.topLevelSigned
        ? 'the signed part is nested inside multipart/mixed, so the files are covered by nothing'
        : scope.outside.length
          ? `outside the signed part: ${scope.outside.join(', ')}`
          : scope.all.length === 0
            ? 'no named parts to cover (text only)'
            : `${scope.inside.length}/${scope.all.length} named part(s) inside`
    );

    const duplicated = [...new Set(scope.all.filter((name, index) => scope.all.indexOf(name) !== index))];
    add(
      'each payload part is attached once',
      duplicated.length === 0,
      duplicated.length ? `duplicated: ${duplicated.join(', ')}` : `${scope.all.length} part(s)`
    );

    const cross = pgpCrossCheck(text, { fingerprint: fingerprintClaim });
    const mismatch = cross.checks.find(
      (check) => check.name === 'fingerprint-match' || check.name === 'fingerprint-verifiable' || check.name === 'fingerprint-claimed'
    );
    add(
      'signer matches the fingerprint claim',
      cross.ok,
      mismatch ? mismatch.detail : cross.info && cross.info.issuerFingerprint
    );
  }

  // ---------------------------------------------------------------------------
  // LAYER 1, RE-DERIVED.
  //
  // Everything above treats the crypto headers as opaque strings: `X-PasevSU-Sha256`
  // could name a different file, `Cripto-Engine` could be any 25 digits, and
  // `Cripto-title` could be a ciphertext from another message. The composer exports
  // the exact functions that BUILT them, so the strongest available check is to
  // rebuild each one from the manifest and compare — a forgery that changes one
  // digit or one hash row no longer verifies.
  // ---------------------------------------------------------------------------
  const created = headerGetJoined(headers, 'X-PasevSU-Created') || '';
  const engine = headerGetJoined(headers, 'X-PasevSU-Cripto-Engine') || '';
  const bodyHash = headerGetJoined(headers, 'X-PasevSU-Body-SHA256') || '';

  const expectedEngine = cryptoEngineCode({ merkleRoot: merkle, bodySha256: bodyHash });
  add(
    'Cripto-Engine is the code this evidence derives',
    engine === expectedEngine,
    engine ? `wire=${engine} derived=${expectedEngine}` : 'absent'
  );

  // The digest block is a contract: the body, then every manifest attachment in
  // order, then the timestamp. Rebuilding it catches a swapped hash, a dropped
  // file, a renamed row and a shifted timestamp in a single comparison.
  const expectedRows = buildDigestBlock({
    bodySha256: bodyHash,
    attachmentEntries: claimed,
    timestamp: created,
  });
  const wireRows = parseBlock(headerGetJoined(headers, 'X-PasevSU-Sha256'));
  const rowDiff = [];
  if (wireRows.length !== expectedRows.length) {
    rowDiff.push(`${wireRows.length} rows, expected ${expectedRows.length}`);
  }
  for (let index = 0; index < Math.max(wireRows.length, expectedRows.length); index += 1) {
    if (wireRows[index] !== expectedRows[index]) {
      rowDiff.push(
        `row ${index + 1}: wire=${wireRows[index] || 'absent'} expected=${expectedRows[index] || 'absent'}`
      );
    }
  }
  add(
    'Sha256 block re-derives from the manifest',
    rowDiff.length === 0,
    rowDiff.length ? rowDiff.slice(0, 3).join('; ') : `${expectedRows.length} rows`
  );

  add(
    'Body-SHA256 is the manifest message hash',
    manifest.message_sha256 === bodyHash,
    bodyHash ? `header=${bodyHash} manifest=${manifest.message_sha256}` : 'absent'
  );

  // The list header restates the same name/hash pairs, so it is compared on CONTENT, not
  // on count: a message can carry a correct digest block and a tampered `name=hash` list,
  // and the row comparison above would not notice. The expected pairs are derived from
  // the rebuilt rows, so `headerToken`'s escaping is applied exactly once, by the composer.
  if (claimed.length) {
    const expectedList = expectedRows
      .slice(1, -1)
      .map((row) => {
        const cut = row.lastIndexOf(' - ');
        return `${row.slice(0, cut)}=${row.slice(cut + 3)}`;
      })
      .join(',');
    add(
      'Attachments-SHA256 lists the same pairs as the digest block',
      listed === expectedList,
      listed === expectedList
        ? `${claimed.length} files`
        : `wire=${listed.slice(0, 96)}… expected=${expectedList.slice(0, 96)}…`
    );
  }

  // The encrypted title must decrypt under the engine code and hold exactly the block
  // above. GCM's authentication tag is why a single flipped byte fails here rather
  // than passing as "some ciphertext".
  const titleToken = headerGetJoined(headers, 'X-PasevSU-Cripto-title') || '';
  let titleRows = null;
  try {
    titleRows = decryptDigestBlock(engine, titleToken, { merkleRoot: merkle });
    add('Cripto-title decrypts under the engine', true, `${titleToken.length} chars`);
  } catch (err) {
    add('Cripto-title decrypts under the engine', false, String(err.message));
  }
  if (titleRows) {
    add(
      'Cripto-title holds the same block as Sha256',
      titleRows.join('\n') === expectedRows.join('\n'),
      titleRows.length === expectedRows.length
        ? `${titleRows.length} rows`
        : `${titleRows.length} rows, expected ${expectedRows.length}`
    );
  }

  // Metadata digest. `verifyEvidence` checks the record against itself, so an edited
  // `signed_headers` block cannot verify even when every byte still matches; passing the
  // live Message-ID additionally proves the record describes THIS message's envelope.
  // `from`, `to` and `date` stay inside the hash but are not compared to the wire:
  // Thunderbird rewrites `Date` on send, so a mismatch there would report its formatting
  // rather than tampering. The Subject is compared separately below, normalised on BOTH
  // sides — `verifyEvidence` compares it raw, which would fail on a re-folded line.
  const wireMessageId = headerGetJoined(headers, 'X-PasevSU-Message-ID') || '';
  const wireSubject = subjectKey(decodeEncodedWords(headerGet(headers, 'Subject') || ''));
  const signedChecks = verifyEvidence(manifest, { messageId: wireMessageId }).checks;
  for (const check of signedChecks) {
    if (check.name === 'headers-sha256') add('signed header record hashes to its own seal', check.ok, check.detail);
    if (check.name === 'headers-match-message') {
      add('signed record binds this Message-ID and attachment set', check.ok, check.detail);
    }
  }
  const signedRecord = manifest.signed_headers && typeof manifest.signed_headers === 'object' ? manifest.signed_headers : null;
  if (signedRecord) {
    const signedSubject = subjectKey(decodeEncodedWords(String(signedRecord.subject == null ? '' : signedRecord.subject)));
    if (!wireSubject) {
      // The gateway writes custom headers only; `Subject` is the message envelope, so a
      // message built for a test has none. Absent is not tampered — the comparison simply
      // cannot be made, and saying so is more honest than a green tick it did not earn.
      add('signed record binds this Subject', true, 'no Subject on the wire, not compared');
    } else {
      add(
        'signed record binds this Subject',
        signedSubject === wireSubject,
        signedSubject === wireSubject ? wireSubject : `manifest=${signedSubject} wire=${wireSubject}`
      );
    }
  }
  const wireHeadersHash = headerGetJoined(headers, 'X-PasevSU-Headers-SHA256') || '';
  if (signedRecord && signedRecord.headers_sha256) {
    add(
      'Headers-SHA256 header states the manifest seal',
      wireHeadersHash === signedRecord.headers_sha256,
      wireHeadersHash ? `wire=${wireHeadersHash} manifest=${signedRecord.headers_sha256}` : 'absent'
    );
  }

  // The body is informational, never a failure: the extension hashes the compose
  // text, while the sent part differs by transfer encoding and line endings. The
  // gateway re-derives the body hash for exactly that reason.
  const textPart = parts.find((part) => /^text\/plain/i.test(part.contentType));
  if (textPart) {
    const actual = sha256Hex(textPart.bytes);
    add(
      'body hash re-derives (informational)',
      true,
      actual === manifest.message_sha256
        ? 'matches the sent text/plain part'
        : 'differs from the sent text/plain part (encoding or line endings)'
    );
  }

  return { checks, ok: checks.every((check) => check.ok), manifest };
}

/**
 * Thunderbird names the folder that receives copies of sent messages after the
 * UI language, and Gmail prefixes its own copy with "[Gmail]/". Matching only
 * the English "Sent" is how the first end-to-end check managed to report on an
 * Outlook mailbox last written on 11-05 while the live one was "Изпратени".
 * Compared by basename, case-insensitively.
 */
const SENT_NAMES = [
  'sent',
  'sent mail',
  'sent items',
  'sent messages',
  'изпратени',
  'изходящи',
  'gesendet',
  'gesendete objekte',
  'envoyés',
  'éléments envoyés',
  'enviados',
  'elementos enviados',
  'posta inviata',
  'inviati',
  'отправленные',
  'надіслані',
  'послато',
  'надіслані листи',
  'wysłane',
  'verzonden',
  'enviadas',
  'odeslaná pošta',
  'odoslané správy',
  'poslano',
  'gönderilmiş öğeler',
  'gönderilenler',
  'trimise',
  'απεσταλμένα',
  'elküldött',
  'skickat',
  'sendt',
  'lähetetyt',
  '送信済み',
  '已发送',
  '寄件備份',
  '보낸편지함',
  'נשלחו',
  'المرسلة',
  'ارسال شده',
];

function isSentName(fileName) {
  const base = path.basename(fileName).replace(/\.(msf|wdseml)$/i, '').trim().toLowerCase();
  return SENT_NAMES.includes(base);
}

/**
 * Every non-empty mbox in a Thunderbird profile, newest first.
 *
 * `accept` filters by file name. Receipts are not confined to one folder the way
 * sent mail is — they land in whatever Inbox the recipient's client picked — so
 * the walk is shared and each caller supplies its own name rule.
 */
function mboxFiles(profile, accept = () => true) {
  const roots = [path.join(profile, 'Mail'), path.join(profile, 'ImapMail')].filter((dir) => fs.existsSync(dir));
  const found = [];

  const walk = (dir, depth) => {
    if (depth > 6) return;
    // The Debug Add-ons page creates a full nested profile; its mail is a copy.
    if (path.basename(dir) === 'chrome_debugger_profile') return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // ".mozmsgs" holds Windows Search metadata, never mail.
        if (entry.name === '.mozmsgs') continue;
        walk(full, depth + 1);
        continue;
      }
      if (!accept(entry.name)) continue;
      // ".msf" is Thunderbird's MIME summary index and ".wdseml" is a Windows Search
      // sidecar: neither is the message, and both would be reported as mail with no
      // headers at all.
      if (/\.(msf|wdseml|dat|mab|sqlite|json)$/i.test(entry.name)) continue;
      try {
        if (fs.statSync(full).size > 0) found.push(full);
      } catch {
        /* unreadable, skip */
      }
    }
  };

  for (const dir of roots) walk(dir, 0);
  return found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

/** Sent mbox files in a Thunderbird profile, newest first. */
function sentFiles(profile) {
  return mboxFiles(profile, isSentName);
}

/** Bytes [from, to) of a file, decoded once so no character is split. */
function readRange(file, from, to) {
  const size = to - from;
  if (size <= 0) return '';
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(size);
  try {
    fs.readSync(fd, buf, 0, size, from);
  } finally {
    fs.closeSync(fd);
  }
  return buf.toString('utf8');
}

/**
 * Walk an mbox one message at a time instead of holding it in memory. A real
 * profile here has a 2.3 GB Sent mailbox, which `readFileSync` cannot return as
 * a string at all.
 */
function* streamMessages(file, chunkSize = 1 << 20) {
  const fd = fs.openSync(file, 'r');
  const decoder = new StringDecoder('utf8');
  const buf = Buffer.allocUnsafe(chunkSize);
  let carry = '';
  let current = null;
  let started = false;
  let mbox = true;

  const takeLine = function* (line) {
    if (!started) {
      started = true;
      mbox = line.startsWith('From ');
      current = mbox ? '' : line;
      return;
    }
    if (mbox && line.startsWith('From ')) {
      if (current !== null) yield current;
      current = '';
      return;
    }
    current = (current === null ? '' : current) + line;
  };

  try {
    for (;;) {
      const bytesRead = fs.readSync(fd, buf, 0, chunkSize, null);
      carry += bytesRead === 0 ? decoder.end() : decoder.write(buf.subarray(0, bytesRead));
      let at;
      while ((at = carry.indexOf('\n')) !== -1) {
        const line = carry.slice(0, at + 1);
        carry = carry.slice(at + 1);
        yield* takeLine(line);
      }
      if (bytesRead === 0) break;
    }
    if (carry) yield* takeLine(carry);
    if (current) yield current;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The last `count` messages of an mbox, read from the tail. A sent copy is
 * appended, so the newest message is the last one, and finding it costs a scan
 * of the tail rather than of the whole mailbox.
 */
function lastMessages(file, count, chunkSize = 1 << 20) {
  const size = fs.statSync(file).size;
  if (size === 0) return [];

  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(chunkSize);
  const starts = [];
  let pos = size;
  try {
    while (pos > 0 && starts.length <= count) {
      const span = Math.min(chunkSize, pos);
      pos -= span;
      fs.readSync(fd, buf, 0, span, pos);
      // latin1 is one byte per character, so string offsets stay byte offsets.
      const text = buf.subarray(0, span).toString('latin1');
      for (let at = text.lastIndexOf('From '); at !== -1; at = text.lastIndexOf('From ', at - 1)) {
        if (at === 0 || text[at - 1] === '\n') {
          starts.push(pos + at);
          if (starts.length > count) break;
        }
        if (at === 0) break;
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  if (!starts.length) {
    // Not an mbox: a single .eml, and the whole file is the message.
    return [readRange(file, 0, size)];
  }

  starts.sort((a, b) => a - b);
  return splitMessages(readRange(file, starts[Math.max(0, starts.length - count)], size));
}

/**
 * The newest sent message in a profile, by the message's own Date header.
 * Choosing the mailbox by file mtime is not the same thing: in this profile the
 * most recently touched Sent folder holds a single message from 2022, while the
 * real outbox is a 2.3 GB mailbox whose last message is days older than that
 * folder's mtime.
 */
function newestSent(sources) {
  const candidates = [];
  for (const source of sources) {
    let message;
    let mtime = 0;
    try {
      const newest = lastMessages(source, 1);
      message = newest[newest.length - 1] || null;
      mtime = fs.statSync(source).mtimeMs;
    } catch {
      message = null;
    }
    if (!message) continue;
    const date = headerGet(parseMessage(message).headers, 'Date');
    const at = date ? Date.parse(date) : NaN;
    candidates.push({ source, message, at: Number.isNaN(at) ? -Infinity : at, mtime });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.at - a.at || b.mtime - a.mtime);
  return candidates[0];
}

function defaultProfile() {
  const base = path.join(process.env.APPDATA || '', 'Thunderbird', 'Profiles');
  if (!base || !fs.existsSync(base)) return null;
  const candidates = fs
    .readdirSync(base)
    .filter((name) => /\.default(-esr)?$/.test(name))
    .map((name) => path.join(base, name));
  if (!candidates.length) return null;
  return candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function report(label, result) {
  console.log(`\n${label}`);
  for (const check of result.checks) {
    console.log(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}${check.detail ? `  ${check.detail}` : ''}`);
  }
  console.log(`  -> ${result.ok ? 'evidence chain intact' : 'EVIDENCE CHAIN BROKEN'}`);
}

function main(argv) {
  const all = argv.includes('--all');
  let only = null;
  const args = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') continue;
    if (arg === '--only') {
      only = Number(argv[(i += 1)]);
      if (!Number.isInteger(only) || only < 1) {
        console.error('--only needs a message number, for example: --only 3');
        return 2;
      }
      continue;
    }
    if (arg.startsWith('--')) {
      console.error(`unknown option: ${arg}`);
      return 2;
    }
    args.push(arg);
  }

  let sources = [];

  if (args.length) {
    for (const arg of args) {
      if (!fs.existsSync(arg)) {
        console.error(`not found: ${arg}`);
        return 2;
      }
      if (fs.statSync(arg).isDirectory()) sources.push(...sentFiles(arg));
      else sources.push(arg);
    }
    if (!sources.length) {
      console.error('No Sent folder with messages found in that directory.');
      return 2;
    }
  } else {
    const profile = defaultProfile();
    if (!profile) {
      console.error('No Thunderbird profile found. Pass an .eml path or a profile directory.');
      return 2;
    }
    console.log(`profile: ${profile}`);
    sources = sentFiles(profile);
    if (!sources.length) {
      console.error('No Sent folder with messages found in that profile.');
      return 2;
    }
  }

  // A message number refers to one mailbox, so --only reads only the first one.
  if (only !== null) sources = sources.slice(0, 1);

  let failures = 0;
  let inspected = 0;
  const check = (source, label, message) => {
    const subject = headerGet(parseMessage(message).headers, 'Subject') || '(no subject)';
    const result = inspectMessage(message);
    // The mailbox is named, not just a basename: a profile has several Sent boxes.
    report(`${source}${label}  ${subject}`, result);
    inspected += 1;
    if (!result.ok) failures += 1;
  };

  if (!all && only === null) {
    const newest = newestSent(sources);
    if (!newest) {
      console.error('No readable message in any Sent mailbox.');
      return 2;
    }
    const date = headerGet(parseMessage(newest.message).headers, 'Date');
    check(newest.source, date ? ` (newest, ${date})` : ' (newest)', newest.message);
  } else {
    for (const source of sources) {
      // Streaming keeps memory flat, so a 2.3 GB Sent mailbox is readable; --only
      // holds the whole mailbox count back until the end for the "of N" in its label.
      let index = 0;
      let chosen = null;
      for (const message of streamMessages(source)) {
        index += 1;
        if (only !== null) {
          if (index === only) chosen = message;
          continue;
        }
        check(source, ` #${index}`, message);
      }
      if (only !== null) {
        if (chosen === null) {
          console.error(`${source} holds ${index} message(s), so --only ${only} does not exist.`);
          return 2;
        }
        check(source, ` #${only} of ${index}`, chosen);
      }
    }
  }

  console.log(`\nRESULT: ${failures === 0 ? `ALL ${inspected} MESSAGE(S) OK` : `${failures}/${inspected} MESSAGE(S) BROKEN`}`);
  return failures === 0 ? 0 : 1;
}

module.exports = {
  inspectMessage,
  splitMessages,
  parseMessage,
  collectParts,
  partName,
  headerGet,
  sentFiles,
  mboxFiles,
  isSentName,
  lastMessages,
  streamMessages,
  newestSent,
  defaultProfile,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
