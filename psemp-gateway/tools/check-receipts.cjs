#!/usr/bin/env node
'use strict';

/**
 * Find delivery receipts and tie each one back to the evidence it acknowledges.
 *
 * "Няма разписка за пристигнало" is a claim about the world, and it has two very
 * different causes that look identical from an empty Inbox:
 *
 *   1. the receipt was never requested, so none could arrive; or
 *   2. it was requested, the recipient's client declined or could not answer.
 *
 * Only the wire can tell them apart. This tool reads the Sent folder for messages
 * that carry `X-PasevSU-Receipt: requested`, then reads the incoming mail for an
 * RFC 8098 `message/disposition-notification` part whose `Original-Message-ID`
 * names one of them. A receipt is thus never inferred from a header we wrote
 * ourselves — it is a message that actually travelled back, matched by the id the
 * sender assigned in the first place.
 *
 * Absence is NOT failure. MDN is voluntary (a Gmail recipient can never return
 * one), so `ok` stays true with zero receipts; the report says what was requested
 * and what came back, and the caller draws the conclusion.
 */

const path = require('path');
const {
  parseMessage,
  collectParts,
  headerGet,
  mboxFiles,
  sentFiles,
  streamMessages,
  isSentName,
  defaultProfile,
} = require('./check-sent.cjs');

const MDN_TYPE = /^\s*message\/disposition-notification\b/i;

/** `rfc822; someone@example.com` -> `someone@example.com` (RFC 8098 address field). */
function addressOf(value) {
  const text = String(value || '').trim();
  const semi = text.indexOf(';');
  return (semi === -1 ? text : text.slice(semi + 1)).trim();
}

/**
 * A Message-ID in the one form used for comparison.
 *
 * Displayed value and compared value differ: clients write `Original-Message-ID`
 * with or without the angle brackets, and wrap the field at their own line length.
 * Case is folded too, because a saved id that differs only in case is the same id
 * for every practical purpose — being strict here would report a real receipt as
 * unmatched, which is the failure mode this tool exists to avoid.
 */
function messageIdKey(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/^</, '')
    .replace(/>$/, '')
    .toLowerCase();
}

/** RFC 8098 disposition: `manual-action/MDN-sent-manually; displayed` -> `displayed`. */
function dispositionOf(value) {
  const text = String(value || '');
  const semi = text.indexOf(';');
  return (semi === -1 ? text : text.slice(semi + 1)).trim().toLowerCase();
}

/** The fields of one `message/disposition-notification` part. */
function parseReport(text) {
  const { headers } = parseMessage(text);
  const field = (name) => {
    const found = headerGet(headers, name);
    return found === null ? '' : String(found).trim();
  };
  const disposition = field('Disposition');
  return {
    reportingUa: field('Reporting-UA'),
    finalRecipient: addressOf(field('Final-Recipient')),
    originalMessageId: field('Original-Message-ID'),
    disposition,
    // "deleted" without "displayed" says the client removed the message, not that a
    // person read it: a receipt is proof of delivery, never of being read. Kept as a
    // separate flag so no report can blur the two.
    displayed: /\bdisplayed\b/i.test(disposition),
    failure: field('Failure'),
    error: field('Error'),
  };
}

/**
 * Every receipt carried by one message.
 *
 * The content type decides, not the text: a body that merely mentions
 * "disposition-notification" is not a receipt, and treating it as one is how a
 * naive grep invents deliveries.
 */
function receiptsIn(message, mailbox = '') {
  if (!/disposition-notification/i.test(message)) return [];
  const { headers, body } = parseMessage(message);
  const out = [];
  for (const part of collectParts(headers, body)) {
    if (!MDN_TYPE.test(part.contentType)) continue;
    if (!part.bytes) continue;
    out.push({
      ...parseReport(part.bytes.toString('utf8')),
      mailbox,
      receivedAt: headerGet(headers, 'Date') || '',
      from: headerGet(headers, 'From') || '',
      subject: headerGet(headers, 'Subject') || '',
      messageId: headerGet(headers, 'Message-ID') || '',
    });
  }
  return out;
}

/**
 * Receipts sitting in the incoming mail.
 *
 * Sent folders are skipped by default: a receipt there is an echo of one the
 * account sent, not an acknowledgement received.
 */
function readReceipts(profile, { includeSent = false } = {}) {
  const out = [];
  const files = mboxFiles(profile, (name) => includeSent || !isSentName(name));
  for (const file of files) {
    const mailbox = path.basename(file);
    for (const message of streamMessages(file)) {
      out.push(...receiptsIn(message, mailbox));
    }
  }
  return out;
}

/**
 * What the account asked for, keyed by Message-ID.
 *
 * Filtered before parsing: a 2.3 GB mailbox must not be turned into strings for
 * messages that cannot match. Only messages the add-on touched are inspected.
 */
function indexEvidence(profile) {
  const index = new Map();
  for (const file of sentFiles(profile)) {
    for (const message of streamMessages(file)) {
      if (!/X-PasevSU-(?:Evidence-ID|Receipt)/i.test(message)) continue;
      const { headers } = parseMessage(message);
      const key = messageIdKey(headerGet(headers, 'Message-ID'));
      if (!key) continue;
      const receipt = headerGet(headers, 'X-PasevSU-Receipt');
      index.set(key, {
        messageId: headerGet(headers, 'Message-ID') || '',
        evidenceId: headerGet(headers, 'X-PasevSU-Evidence-ID') || '',
        manifestSha256: headerGet(headers, 'X-PasevSU-Manifest-SHA256') || '',
        date: headerGet(headers, 'Date') || '',
        subject: headerGet(headers, 'Subject') || '',
        requested: receipt !== null && /requested/i.test(receipt),
      });
    }
  }
  return index;
}

/** Pair receipts with the evidence behind the message they acknowledge. */
function checkReceipts({ profile, includeSent = false } = {}) {
  const dir = profile || defaultProfile();
  if (!dir) throw new Error('No Thunderbird profile found; pass --profile <dir>.');

  const evidence = indexEvidence(dir);
  const receipts = readReceipts(dir, { includeSent });
  const matched = [];
  const unmatched = [];

  for (const receipt of receipts) {
    const hit = evidence.get(messageIdKey(receipt.originalMessageId));
    if (hit) matched.push({ ...receipt, evidence: hit });
    else unmatched.push(receipt);
  }

  const requested = [...evidence.values()].filter((entry) => entry.requested);

  return {
    ok: true,
    profile: dir,
    // Absence of a receipt is not a failure: MDN is voluntary, and whether one comes
    // back depends on the recipient's client, not on the address. The counts state
    // what is known and nothing more.
    note: 'An absent receipt is not evidence of non-delivery.',
    receipts: receipts.length,
    matched,
    unmatched,
    requested: requested.length,
    indexed: evidence.size,
  };
}

function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') options.profile = argv[++index];
    else if (arg === '--include-sent') options.includeSent = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: node check-receipts.cjs [--profile <dir>] [--include-sent]\n');
      return 0;
    } else {
      process.stderr.write(`unknown argument: ${arg}\n`);
      return 2;
    }
  }
  const result = checkReceipts(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

module.exports = {
  receiptsIn,
  parseReport,
  readReceipts,
  indexEvidence,
  checkReceipts,
  messageIdKey,
  addressOf,
  dispositionOf,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
