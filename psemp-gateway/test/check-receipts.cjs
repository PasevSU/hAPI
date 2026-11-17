#!/usr/bin/env node
/*
 * `tools/check-receipts.cjs` — did the receipt actually come back?
 *
 * The tool exists to prevent one specific lie: reporting a message as delivered
 * because we asked for a receipt. Requesting and receiving are two different facts,
 * and only the second one is evidence. So the checks below are built around the ways
 * a careless reader would turn an absence into a delivery:
 *
 *   - a body that merely *mentions* a disposition notification is not a receipt;
 *   - a receipt for somebody else's message is not ours;
 *   - a receipt saying "deleted" is not a receipt saying a person read it;
 *   - no receipt at all is still a truthful report, not a failure.
 *
 * The sent message comes from the real `background.js` via `test/check-sent.cjs`, so
 * the evidence being matched is the evidence this add-on actually produces.
 *
 *   node psemp-gateway/test/check-receipts.cjs
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runExtension, buildMessage } = require('./check-sent.cjs');
const {
  checkReceipts,
  readReceipts,
  receiptsIn,
  messageIdKey,
  dispositionOf,
} = require('../tools/check-receipts.cjs');

/**
 * RFC 5322 header names are case-insensitive, and Thunderbird hands custom names back
 * in Http-Header-Case, so the fixture map is read without regard to case.
 */
function headerValue(map, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of map) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/**
 * A Sent message as Thunderbird writes it: the add-on's headers, plus the Message-ID
 * the client assigns. The id is not ours to choose — which is exactly why the receipt
 * has to be matched against it rather than assumed.
 */
function sentMessage(headers, manifestBytes, messageId) {
  const message = buildMessage({ headers, manifestBytes });
  assert.ok(message.includes('MIME-Version: 1.0'), 'the fixture must have a header block');
  return message.replace('MIME-Version: 1.0', `MIME-Version: 1.0\nMessage-ID: ${messageId}`);
}

/** One RFC 8098 receipt wrapped the way a mail client sends it. */
function receiptMessage({
  originalMessageId,
  disposition = 'manual-action/MDN-sent-manually; displayed',
  finalRecipient = 'rfc822; recipient@example.test',
} = {}) {
  const boundary = 'mdn-boundary';
  return [
    'From: recipient@example.test',
    'To: sender@example.test',
    'Subject: Read: evidence test',
    'MIME-Version: 1.0',
    `Content-Type: multipart/report; report-type=disposition-notification; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'The message was displayed.',
    `--${boundary}`,
    'Content-Type: message/disposition-notification',
    '',
    'Reporting-UA: Thunderbird; Windows',
    `Final-Recipient: ${finalRecipient}`,
    `Original-Message-ID: ${originalMessageId}`,
    `Disposition: ${disposition}`,
    `--${boundary}--`,
    '',
  ].join('\n');
}

/** A profile whose folders are real mbox files, so the walk is exercised. */
function writeProfile(dir, { sent = [], inbox = [] }) {
  const profile = path.join(dir, 'profile');
  const folders = path.join(profile, 'Mail', 'Local Folders');
  fs.mkdirSync(folders, { recursive: true });
  const write = (name, messages) => {
    if (!messages.length) return;
    const body = messages.map((m) => `From - Mon Jan 01 00:00:00 2026\n${m}`).join('\n');
    fs.writeFileSync(path.join(folders, name), `${body}\n`);
  };
  write('Sent', sent);
  write('Inbox', inbox);
  return profile;
}

/** A scratch directory that is removed even when the assertions fail. */
function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psemp-receipts-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* --- checks --------------------------------------------------------------- */
const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

check('a receipt is matched to the evidence behind the message it acknowledges', async () =>
  withTemp(async (dir) => {
    // `details.from` is never filled by Thunderbird, so a real receipt request needs a
    // configured reply address — without one the header is correctly left out.
    const { headers, manifestBytes } = await runExtension({
      stored: { receiptAddress: 'sender@example.test' },
    });
    const sent = sentMessage(headers, manifestBytes, '<AABBCC-1234@example.test>');
    // The client strips the brackets and changes nothing else about the id: stored
    // case must not decide whether a real receipt counts.
    const profile = writeProfile(dir, {
      sent: [sent],
      inbox: [receiptMessage({ originalMessageId: 'aabbcc-1234@example.test' })],
    });

    const report = checkReceipts({ profile });
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.receipts, 1, 'the receipt part must be found');
    assert.strictEqual(report.matched.length, 1, 'the receipt must be matched, not left over');
    assert.strictEqual(report.unmatched.length, 0);
    assert.strictEqual(report.requested, 1, 'the add-on must have asked for a receipt');

    const [hit] = report.matched;
    assert.strictEqual(
      hit.evidence.evidenceId,
      headerValue(headers, 'X-PasevSU-Evidence-ID'),
      'the receipt must carry the evidence id of the message it acknowledges'
    );
    assert.strictEqual(
      hit.evidence.manifestSha256,
      headerValue(headers, 'X-PasevSU-Manifest-SHA256'),
      'the receipt must resolve to the manifest hash we published'
    );
    assert.strictEqual(hit.displayed, true, 'a displayed disposition means it was shown');
    return `matched ${hit.evidence.evidenceId.slice(0, 8)}…`;
  }));

check('a body that only mentions a disposition notification is not a receipt', () => {
  // The words appear; the content type does not. A grep would call this a delivery.
  const message = [
    'From: someone@example.test',
    'Subject: re: your message',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Please send me the message/disposition-notification part you received.',
    '',
  ].join('\n');
  assert.deepStrictEqual(receiptsIn(message), [], 'text alone must never count as a receipt');
});

check('a receipt for a message we did not send stays unmatched', async () =>
  withTemp(async (dir) => {
    const { headers, manifestBytes } = await runExtension();
    const profile = writeProfile(dir, {
      sent: [sentMessage(headers, manifestBytes, '<ours@example.test>')],
      inbox: [receiptMessage({ originalMessageId: '<theirs@example.test>' })],
    });

    const report = checkReceipts({ profile });
    assert.strictEqual(report.matched.length, 0, 'a stranger\'s receipt is not our delivery');
    assert.strictEqual(report.unmatched.length, 1, 'it must be kept, not silently dropped');
    assert.strictEqual(report.unmatched[0].originalMessageId, '<theirs@example.test>');
    return 'kept as unmatched';
  }));

check('"deleted" without "displayed" is not proof that anyone read it', async () =>
  withTemp(async (dir) => {
    const { headers, manifestBytes } = await runExtension();
    const profile = writeProfile(dir, {
      sent: [sentMessage(headers, manifestBytes, '<gone@example.test>')],
      inbox: [
        receiptMessage({
          originalMessageId: '<gone@example.test>',
          disposition: 'manual-action/MDN-sent-manually; deleted',
        }),
      ],
    });

    const report = checkReceipts({ profile });
    assert.strictEqual(report.matched.length, 1, 'a deletion is still a receipt');
    assert.strictEqual(
      report.matched[0].displayed,
      false,
      'delivery is proven; being read is not'
    );
    assert.strictEqual(dispositionOf('manual-action/MDN-sent-manually; deleted'), 'deleted');
    return 'delivered, not read';
  }));

check('no receipt at all is reported as unknown, never as non-delivery', async () =>
  withTemp(async (dir) => {
    const { headers, manifestBytes } = await runExtension({
      stored: { receiptAddress: 'sender@example.test' },
    });
    const profile = writeProfile(dir, {
      sent: [sentMessage(headers, manifestBytes, '<quiet@example.test>')],
    });

    const report = checkReceipts({ profile });
    assert.strictEqual(report.ok, true, 'silence is not a defect');
    assert.strictEqual(report.receipts, 0);
    assert.strictEqual(report.matched.length, 0);
    assert.strictEqual(report.requested, 1, 'the request was still made and is still recorded');
    assert.strictEqual(report.indexed, 1);
    assert.ok(
      /not evidence of non-delivery/i.test(report.note),
      `the note must refuse to infer non-delivery, got: ${report.note}`
    );
    return 'requested=1 received=0';
  }));

check('a Sent folder is not scanned for receipts unless asked', () =>
  withTemp((dir) => {
    const receipt = receiptMessage({ originalMessageId: '<echo@example.test>' });
    // A receipt sitting in Sent is one the account sent out, not one it received.
    const profile = writeProfile(dir, { sent: [receipt] });

    assert.deepStrictEqual(readReceipts(profile), [], 'Sent is skipped by default');
    assert.strictEqual(readReceipts(profile, { includeSent: true }).length, 1);
    return 'skipped by default, found on request';
  }));

check('one receipt saved in several folders is one acknowledgement', () =>
  withTemp((dir) => {
    // Gmail keeps All Mail, the Inbox and every label as separate mailboxes. Counting
    // each copy would report three deliveries where one message came back once.
    const receipt = [
      'From: recipient@example.test',
      'Message-ID: <d6342a40-d4ae-4c35-9093-c5dc7c439eba@example.test>',
      'Subject: Read: evidence test',
      'MIME-Version: 1.0',
      'Content-Type: multipart/report; report-type=disposition-notification; boundary="mdn-boundary"',
      '',
      '--mdn-boundary',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'The message was displayed.',
      '--mdn-boundary',
      'Content-Type: message/disposition-notification',
      '',
      'Final-Recipient: rfc822; recipient@example.test',
      'Original-Message-ID: <ours@example.test>',
      'Disposition: manual-action/MDN-sent-manually; displayed',
      '--mdn-boundary--',
      '',
    ].join('\n');

    const profile = path.join(dir, 'profile');
    const folders = path.join(profile, 'Mail', 'Local Folders');
    fs.mkdirSync(folders, { recursive: true });
    const body = `From - Mon Jan 01 00:00:00 2026\n${receipt}\n`;
    fs.writeFileSync(path.join(folders, 'Inbox'), body);
    fs.writeFileSync(path.join(folders, 'All Mail'), body);

    const found = readReceipts(profile);
    assert.strictEqual(found.length, 1, 'two copies must not count as two receipts');
    assert.deepStrictEqual(
      found[0].mailboxes.slice().sort(),
      ['All Mail', 'Inbox'],
      'both folders must still be recorded'
    );
    return `1 receipt in ${found[0].mailboxes.length} folders`;
  }));

check('message ids compare through brackets, whitespace and case', () => {
  const key = messageIdKey('  <AbC-123@Example.TEST>\n');
  assert.strictEqual(key, 'abc-123@example.test');
  assert.strictEqual(messageIdKey('abc-123@example.test'), key, 'both forms must be equal');
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
