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
const { sha256Hex, verifyManifest, verifyEvidence } = require('../api.js');

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
  for (const segment of body.split(`--${boundary}`)) {
    if (!segment.trim() || segment.startsWith('--')) continue;
    const parsed = parseMessage(segment);
    parts.push(...collectParts(parsed.headers, parsed.body, depth + 1));
  }
  return parts;
}

function partName(part) {
  return part.name || '';
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
  } else if (claimed.length) {
    const names = claimed.map((entry) => entry.filename).join(',');
    add('Attachments-SHA256 header lists every manifest attachment', listed.split(',').length === claimed.length, names);
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

/** Sent mbox files in a Thunderbird profile, newest first. */
function sentFiles(profile) {
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
      if (!isSentName(entry.name)) continue;
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
  isSentName,
  lastMessages,
  streamMessages,
  newestSent,
  defaultProfile,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
