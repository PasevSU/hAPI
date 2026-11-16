#!/usr/bin/env node
/*
 * PSEMP sent-mail checking.
 *
 * `tools/check-sent.cjs` is the only thing in the framework that compares the
 * headers on a message with the bytes of that message. If it is wrong, or if it is
 * merely lenient, every later claim about "proven evidence" rests on nothing.
 *
 * So this builds a message the way the extension produces one — by running the real
 * `background.js` and taking its headers and the manifest it attaches — assembles a
 * real MIME message around them, and then breaks it in the ways that matter:
 *
 *   - the manifest is missing (the defect that shipped: headers advertising a
 *     manifest Thunderbird had silently dropped);
 *   - an attachment was altered after the manifest was built;
 *   - a message carries no evidence headers at all.
 *
 * The checker must fail on each of those, and must still pass when Thunderbird
 * rewrites the header names into Http-Header-Case.
 *
 *   node psemp-gateway/test/check-sent.cjs
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadExtension, headerMap, sha256Hex, MANIFEST_FILENAME } = require('./lib/extension.cjs');
const { inspectMessage, splitMessages, sentFiles } = require('../tools/check-sent.cjs');

const MANIFEST = MANIFEST_FILENAME;

/* --- build a message from the extension's own output ----------------------- */

/**
 * Run background.js for a compose window and return the headers it injected plus
 * the manifest file it attached. Nothing here is hand-written: if the extension
 * changes what it emits, these tests follow it.
 *
 * ComposeAttachment.id is an integer in the WebExtension schema, so the ids handed
 * to the extension are integers here too — a string id is not something Thunderbird
 * produces, and the extension skips it.
 */
async function runExtension({ body = 'Forensic body', files = [] } = {}) {
  const attachments = {};
  files.forEach((file, index) => {
    attachments[index + 1] = { name: file.name, bytes: file.bytes };
  });

  const { listeners, added } = loadExtension({
    stored: { version: '1.1', caseId: 'CASE-1', pgpFingerprint: 'ABCDEF0123456789' },
    attachments,
  });
  const details = {
    isPlainText: true,
    body,
    attachments: files.map((file, index) => ({ id: index + 1, name: file.name })),
    customHeaders: [],
  };
  const result = await listeners[0]({}, details);
  assert.ok(result && result.details, 'listener must return { details }');

  assert.strictEqual(added.length, 1, 'the manifest must be attached through addAttachment');
  const manifestBytes = Buffer.from(await added[0].attachment.file.arrayBuffer());

  return { headers: headerMap(result.details.customHeaders), manifestBytes, details };
}

function base64Lines(buffer) {
  return buffer.toString('base64').replace(/(.{76})/g, '$1\r\n');
}

/**
 * Assemble a MIME message. `parts` are extra body parts; the manifest is added
 * unless `includeManifest` is false, which is how a dropped manifest is simulated.
 */
function buildMessage({ headers, manifestBytes, body = 'Forensic body', attachmentParts = [], includeManifest = true, recase = false }) {
  const boundary = 'psemp-test-boundary';
  const lines = ['From: sender@example.test', 'To: recipient@example.test', 'Subject: evidence test', 'MIME-Version: 1.0'];

  for (const [name, value] of headers) {
    // Thunderbird hands custom header names back in Http-Header-Case; the checker
    // must match case-insensitively (RFC 5322 section 2.2).
    lines.push(`${recase ? recaseHeader(name) : name}: ${value}`);
  }

  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`);
  lines.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', body);
  lines.push(`--${boundary}`);

  for (const part of attachmentParts) {
    lines.push(`Content-Type: application/octet-stream; name="${part.name}"`);
    lines.push(`Content-Disposition: attachment; filename="${part.name}"`);
    lines.push('Content-Transfer-Encoding: base64', '', base64Lines(part.bytes) || '', `--${boundary}`);
  }

  if (includeManifest) {
    lines.push(`Content-Type: application/json; name="${MANIFEST}"`);
    lines.push(`Content-Disposition: attachment; filename="${MANIFEST}"`);
    lines.push('Content-Transfer-Encoding: base64', '', base64Lines(manifestBytes), `--${boundary}`);
  }

  lines.push('--', '');
  return lines.join('\r\n');
}

/** X-PasevSU-Body-SHA256 -> X-Pasevsu-Body-Sha256, as Thunderbird normalises it. */
function recaseHeader(name) {
  return name
    .toLowerCase()
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('-');
}

const failing = (result) => result.checks.filter((check) => !check.ok).map((check) => check.name);

/* --- checks --------------------------------------------------------------- */
const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

check('a message the extension produced passes every check', async () => {
  const { headers, manifestBytes } = await runExtension();
  const message = buildMessage({ headers, manifestBytes });
  const result = inspectMessage(message);

  assert.deepStrictEqual(failing(result), [], `unexpected failures: ${failing(result).join(', ')}`);
  assert.ok(result.ok);
  assert.ok(result.manifest, 'the manifest must be recovered from the message');
  assert.match(result.manifest.merkle_root, /^[0-9a-f]{64}$/);
  return `${result.checks.length} checks, evidence-id ${result.manifest.evidence_id}`;
});

check('an attachment listed in the manifest is found and re-hashed', async () => {
  const pdf = { name: 'document.pdf', bytes: Buffer.from('pretend this is a pdf') };
  const { headers, manifestBytes } = await runExtension({ files: [pdf] });
  const message = buildMessage({ headers, manifestBytes, attachmentParts: [pdf] });
  const result = inspectMessage(message);

  assert.deepStrictEqual(failing(result), [], `unexpected failures: ${failing(result).join(', ')}`);
  const names = result.checks.map((c) => c.name);
  assert.ok(names.includes('attachment document.pdf'), 'the attachment must be checked by name');
  return `attachment verified against manifest sha256 ${sha256Hex(pdf.bytes).slice(0, 12)}…`;
});

check('an attachment present but missing from the manifest is reported', async () => {
  // The extension skips an attachment it cannot read, and the manifest then simply
  // does not list it. The file still travels with the mail, so the evidence chain
  // has a hole the headers do not mention — the checker must say so.
  const pdf = { name: 'document.pdf', bytes: Buffer.from('pretend this is a pdf') };
  const { headers, manifestBytes } = await runExtension();
  const message = buildMessage({ headers, manifestBytes, attachmentParts: [pdf] });
  const result = inspectMessage(message);

  assert.strictEqual(result.ok, false, 'an unaccounted attachment must not pass');
  assert.ok(failing(result).includes('attachment document.pdf is in the manifest'));
  return 'unaccounted attachment caught';
});

check('a dropped manifest is reported even though the headers look right', async () => {
  // This is the shipped defect: X-PasevSU-Manifest-SHA256 present, nothing attached.
  const { headers, manifestBytes } = await runExtension();
  const message = buildMessage({ headers, manifestBytes, includeManifest: false });
  const result = inspectMessage(message);

  assert.strictEqual(result.ok, false, 'a missing manifest must not pass');
  assert.ok(failing(result).includes('manifest attached'), 'the failure must name the manifest');
  assert.match(
    result.checks.find((c) => c.name === 'manifest attached').detail,
    /absent although X-PasevSU-Manifest-SHA256 is set/
  );
  return 'missing manifest caught by name';
});

check('an altered attachment breaks the check that names it', async () => {
  const pdf = { name: 'document.pdf', bytes: Buffer.from('original bytes') };
  const { headers, manifestBytes } = await runExtension({ files: [pdf] });
  const tampered = { ...pdf, bytes: Buffer.from('tampered bytes') };
  const message = buildMessage({ headers, manifestBytes, attachmentParts: [tampered] });
  const result = inspectMessage(message);

  assert.strictEqual(result.ok, false, 'tampered attachment bytes must not pass');
  assert.ok(failing(result).includes('attachment document.pdf'));
  return 'altered bytes caught';
});

check('a message with no evidence headers fails rather than passing vacuously', async () => {
  const message = buildMessage({
    headers: new Map([['X-Other', 'value']]),
    manifestBytes: Buffer.from('{}'),
    includeManifest: false,
  });
  const result = inspectMessage(message);

  assert.strictEqual(result.ok, false);
  assert.ok(failing(result).includes('always-on headers present'));
  return 'absence of evidence is not evidence';
});

check('header names are matched case-insensitively', async () => {
  const { headers, manifestBytes } = await runExtension();
  // Every name and value rewritten the way Thunderbird returns them.
  const message = buildMessage({ headers, manifestBytes, recase: true });
  assert.ok(/(^|\n)X-Pasevsu-Body-Sha256: /m.test(message), 'the fixture must actually be recased');
  const result = inspectMessage(message);
  assert.deepStrictEqual(failing(result), [], `case must not matter: ${failing(result).join(', ')}`);
  return 'X-Pasevsu-Body-Sha256 accepted';
});

check('a quoted-printable body part is decoded before it is compared', async () => {
  const { headers, manifestBytes } = await runExtension();
  const boundary = 'qp-boundary';
  const message = [
    'From: a@example.test',
    'Subject: qp',
    ...Array.from(headers, ([name, value]) => `${name}: ${value}`),
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Forensic body=20with=20escapes',
    `--${boundary}`,
    `Content-Type: application/json; name="${MANIFEST}"`,
    `Content-Disposition: attachment; filename="${MANIFEST}"`,
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(manifestBytes),
    `--${boundary}--`,
    '',
  ].join('\n');

  const result = inspectMessage(message);
  assert.deepStrictEqual(failing(result), [], `qp decoding failed: ${failing(result).join(', ')}`);
  return 'quoted-printable decoded';
});

check('an mbox is split into individual messages', async () => {
  const { headers, manifestBytes } = await runExtension();
  const one = buildMessage({ headers, manifestBytes });
  const mbox = `From sender@example.test Mon Jan 01 00:00:00 2026\n${one}From sender@example.test Tue Jan 02 00:00:00 2026\n${one}`;
  const messages = splitMessages(mbox);

  assert.strictEqual(messages.length, 2, `expected 2 messages, got ${messages.length}`);
  for (const message of messages) {
    assert.deepStrictEqual(failing(inspectMessage(message)), [], 'each split message must still verify');
  }
  return '2 messages, both intact';
});

check('a plain .eml is one message', () => {
  const messages = splitMessages('Subject: x\nFrom: y\n\nbody\n');
  assert.strictEqual(messages.length, 1);
  return 'no false split';
});

check('only the Sent mbox is picked, never its index or cache files', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'psemp-sent-'));
  try {
    const acct = path.join(profile, 'ImapMail', 'mail.example.test');
    fs.mkdirSync(acct, { recursive: true });
    // The real Sent mbox, plus the files that are not mail but sit beside it.
    fs.writeFileSync(path.join(acct, 'Sent'), 'From a@b Mon Jan 01 00:00:00 2026\nSubject: real\n\nbody\n');
    fs.writeFileSync(path.join(acct, 'Sent.msf'), 'thunderbird summary index, not mail');
    fs.writeFileSync(path.join(acct, 'SA5PR19MB9972+abc%40outlook.com.wdseml'), 'windows search sidecar');
    fs.writeFileSync(path.join(acct, 'Inbox'), 'From a@b Mon Jan 01 00:00:00 2026\nSubject: received\n\nbody\n');

    const [chosen, ...rest] = sentFiles(profile);
    assert.strictEqual(path.basename(chosen), 'Sent', `picked ${path.basename(chosen)}`);
    assert.deepStrictEqual(rest, [], `nothing else may be probed, got ${rest.map((f) => path.basename(f)).join(', ')}`);
    assert.match(fs.readFileSync(chosen, 'utf8'), /Subject: real/, 'the file must be the mbox, not an index');
    return 'index and cache files rejected';
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

check('an account with Sent.msf but no Sent is not treated as a mailbox', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'psemp-sent-'));
  try {
    const acct = path.join(profile, 'ImapMail', 'never-synced.example.test');
    fs.mkdirSync(acct, { recursive: true });
    fs.writeFileSync(path.join(acct, 'Sent.msf'), 'index only, no local copy');
    assert.deepStrictEqual(sentFiles(profile), [], 'a summary index alone must not be offered as mail');
    return 'skipped, so a missing local copy is not reported as a defect';
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

check("the add-on's own nested debug profile is not scanned twice", () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'psemp-sent-'));
  try {
    const nested = path.join(profile, 'chrome_debugger_profile', 'ImapMail', 'mail.example.test');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'Sent'), 'From a@b Mon Jan 01 00:00:00 2026\nSubject: copy\n\nbody\n');
    assert.deepStrictEqual(sentFiles(profile), [], 'the nested profile holds a copy of the same mail');
    return 'nested profile excluded';
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

/* --- runner --------------------------------------------------------------- */
(async () => {
  let failed = 0;
  console.log(path.basename(__filename));
  for (const { name, fn } of checks) {
    try {
      const detail = await fn();
      console.log(`  ok   ${name}${typeof detail === 'string' ? ` (${detail})` : ''}`);
    } catch (err) {
      failed += 1;
      console.log(`  FAIL ${name}`);
      console.log(`       ${String(err.message).split('\n').slice(0, 12).join('\n       ')}`);
    }
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  if (failed > 0) process.exitCode = 1;
})();
