#!/usr/bin/env node
/*
 * CustomHeader name admissibility.
 *
 * Thunderbird validates every name in ComposeDetails.customHeaders with
 * sanitizeCustomHeaderName() (parent/ext-compose.js): a name must start with "X-"
 * (but not with "X-Mozilla-"), start with "List-", or be one of
 * ALLOWED_CUSTOM_HEADER_NAMES (currently only "msip_labels"). Anything else throws
 * ExtensionError("Invalid custom header: ...") from setComposeDetails(), and the
 * onBeforeSend path calls it WITHOUT a try/catch — so the send promise is neither
 * resolved nor rejected and the message silently never leaves the Outbox.
 *
 * This went wrong once: the delivery receipt was written as
 * `Disposition-Notification-To` inside customHeaders, which is a legal RFC 8098 field
 * and an illegal custom header. Every other test passed, because the vm stub records
 * whatever it is handed. So this file pins the rule twice — by scanning the source for
 * every name it can produce, and by driving the real listener and checking its output
 * against the rule.
 *
 *   node psemp-gateway/test/custom-header-names.cjs
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');

const { SOURCE, loadExtension, headerNames } = require('./lib/extension.cjs');

/* --- the rule, duplicated on purpose -------------------------------------- */
const ALLOWED_CUSTOM_HEADER_NAMES = ['msip_labels'];

function isAllowedCustomHeaderName(name) {
  const sanitized = String(name || '').toLowerCase().trim();
  if (!sanitized) {
    return false;
  }
  if (sanitized.startsWith('x-') && !sanitized.startsWith('x-mozilla-')) {
    return true;
  }
  return sanitized.startsWith('list-') || ALLOWED_CUSTOM_HEADER_NAMES.includes(sanitized);
}

const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

/* --- every name the source can produce ------------------------------------ */
check('every buildHeader() name in background.js is one Thunderbird accepts', () => {
  const text = fs.readFileSync(SOURCE, 'utf8');
  const names = [];
  const re = /buildHeader\(\s*(?:"([^"]+)"|'([^']+)'|`([^`$]*)\$\{)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    // A template literal is checked by its static prefix plus a digit, which is what
    // the per-attachment headers expand to.
    names.push(match[1] || match[2] || `${match[3]}1`);
  }

  assert.ok(names.length >= 20, `expected the full header set, found ${names.length}`);
  const rejected = names.filter((name) => !isAllowedCustomHeaderName(name));
  assert.deepStrictEqual(
    rejected,
    [],
    `names Thunderbird rejects (the send would fail silently): ${rejected.join(', ')}`
  );
  return `${names.length} names`;
});

check('the emitted set contains no standard mail field', () => {
  const text = fs.readFileSync(SOURCE, 'utf8');
  // Standard fields a well-meaning edit might try to write directly. They belong to
  // ComposeDetails (subject, returnReceipt, ...) or to psemp-gateway's raw SMTP path.
  for (const field of [
    'Disposition-Notification-To',
    'Message-ID',
    'References',
    'In-Reply-To',
    'Reply-To',
    'Sender',
    'Return-Path',
  ]) {
    const escaped = field.replace(/[-]/g, '\\-');
    assert.ok(
      !new RegExp(`buildHeader\\(\\s*["'\`]${escaped}["'\`]`, 'i').test(text),
      `${field} must not be written as a custom header`
    );
  }
  return 'standard fields left to the platform';
});

check('the guard is applied to what is actually returned', () => {
  const text = fs.readFileSync(SOURCE, 'utf8');
  assert.ok(
    /customHeaders:\s*await enforceAllowedCustomHeaders\(/.test(text),
    'the returned customHeaders must pass through enforceAllowedCustomHeaders()'
  );
  assert.ok(
    !/customHeaders:\s*mergedHeaders\b/.test(text),
    'the raw merged list must never be returned unguarded'
  );
  return 'guarded';
});

/* --- the names the listener really emits ---------------------------------- */
check('a full message emits only acceptable names, and requests its receipt natively', async () => {
  const { listeners } = loadExtension({ attachments: { 7: Buffer.from('PDFPAYLOAD') } });
  const details = {
    isPlainText: true,
    body: 'Forensic test body.',
    attachments: [{ id: 7, name: 'Report.pdf', size: 10 }],
    customHeaders: [{ name: 'X-Foreign', value: 'kept' }],
    from: 'pasev@example.org',
    to: ['recipient@example.org'],
    subject: 'Case 2026',
  };

  const { details: out } = await listeners[0]({}, details);
  const names = headerNames(out.customHeaders);

  const rejected = names.filter((name) => !isAllowedCustomHeaderName(name));
  assert.deepStrictEqual(rejected, [], `rejected names: ${rejected.join(', ')}`);
  assert.ok(names.includes('X-Foreign'), 'foreign headers are still preserved');
  assert.ok(!names.some((n) => /^disposition-notification-to$/i.test(n)));

  // The receipt is the standard field, added by Thunderbird itself.
  assert.strictEqual(out.returnReceipt, true);
  assert.ok(out.customHeaders.some((h) => h.name === 'X-PasevSU-Receipt'));
  return `${names.length} names`;
});

/* --- the rule itself ------------------------------------------------------ */
check('the rule matches Thunderbird: X-, List-, msip_labels only', () => {
  const allowed = ['X-PasevSU-Version', 'X-Foreign', 'List-Unsubscribe', 'msip_labels', 'MSIP_Labels'];
  const denied = [
    'Disposition-Notification-To',
    'Subject',
    'Message-ID',
    'X-Mozilla-Status',
    'Content-Type',
    '',
  ];

  for (const name of allowed) {
    assert.strictEqual(isAllowedCustomHeaderName(name), true, `${name} should be allowed`);
  }
  for (const name of denied) {
    assert.strictEqual(isAllowedCustomHeaderName(name), false, `${name} should be rejected`);
  }
  return `${allowed.length} allowed / ${denied.length} denied`;
});

/* --- runner --------------------------------------------------------------- */
(async () => {
  let failed = 0;
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
  if (failed > 0) {
    process.exitCode = 1;
  }
})();
