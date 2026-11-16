#!/usr/bin/env node
/*
 * PSEMP extension arming + injection.
 *
 * The extension is the half of the framework the user never opens: if it does not
 * arm itself at load time, every message goes out with no evidence and nothing
 * reports an error. So this test does not read `background.js` as text — it RUNS
 * it inside a vm with a stub `browser`, exactly as Thunderbird would, and then
 * drives the registered listener.
 *
 * It pins the things that already went wrong once:
 *   - the listener must be registered unconditionally at load (it was not live
 *     while extensions.json claimed active: true);
 *   - the heartbeat must be written BEFORE registration, so "never ran" and
 *     "registration threw" are distinguishable;
 *   - a failing part must never abort the send: the listener returns {details}
 *     and never {cancel:true}, and never throws.
 *
 * Merkle roots are recomputed here with node:crypto rather than Web Crypto, so the
 * test fails if the extension and the test drift together.
 *
 *   node psemp-gateway/test/extension-arming.cjs
 */

'use strict';

const assert = require('node:assert');
const vm = require('node:vm');

const {
  SOURCE,
  CODE,
  BARE_CODE,
  HEX64,
  MANIFEST_FILENAME: MANIFEST,
  sha256Hex,
  referenceMerkle,
  loadExtension,
  headerMap,
  headerNames,
} = require('./lib/extension.cjs');

/* --- checks --------------------------------------------------------------- */
const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

check('background.js loads and arms the listener exactly once', () => {
  const { listeners, order } = loadExtension();
  assert.strictEqual(listeners.length, 1, 'onBeforeSend must be registered at load');
  assert.strictEqual(
    order.filter((step) => step === 'addListener').length,
    1,
    'registered more than once'
  );
});

check('the heartbeat is written BEFORE the listener is registered', () => {
  const { order } = loadExtension();
  const heartbeat = order.indexOf('storage.set:psempLastLoadedAt');
  const armed = order.indexOf('addListener');
  assert.ok(heartbeat >= 0, 'no heartbeat was written at load');
  assert.ok(heartbeat < armed, 'heartbeat must precede registration so both failures differ');
});

check('a failed registration is recorded, not swallowed', () => {
  const { listeners } = loadExtension();
  assert.strictEqual(listeners.length, 1);
  // Re-run with addListener throwing.
  const writes = {};
  const context = vm.createContext({
    browser: {
      storage: {
        local: {
          async get(defaults) {
            return defaults;
          },
          async set(values) {
            Object.assign(writes, values);
          },
        },
      },
      compose: {
        onBeforeSend: {
          addListener() {
            throw new Error('compose permission missing');
          },
        },
      },
    },
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    File,
    console: { warn() {}, error() {}, log() {} },
  });
  vm.runInContext(CODE, context, { filename: SOURCE });
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        assert.match(String(writes.psempArmError), /compose permission missing/);
        resolve('psempArmError recorded');
      } catch (err) {
        reject(err);
      }
    });
  });
});

check('plain-text send gets the full header set in contract order', async () => {
  const { listeners } = loadExtension();
  const details = {
    isPlainText: true,
    body: 'Hello evidence',
    attachments: [],
    customHeaders: [],
  };
  const result = await listeners[0]({}, details);

  assert.ok(result && result.details, 'listener must return { details }');
  assert.ok(!result.cancel, 'listener must never cancel the send');
  // Returned details are applied as setComposeDetails(), and the docs say "only
  // properties that are to be changed should be included". Echoing the whole
  // getComposeDetails() snapshot back tries to write read-only properties
  // (attachments[].size, isModified) and accountsRead-gated ones (identityId,
  // additionalFccFolder, overrideDefaultFcc*), which this add-on does not request.
  // That write fails validation and Thunderbird aborts the send with no dialog.
  assert.deepStrictEqual(
    Array.from(Object.keys(result.details)),
    ['customHeaders'],
    'details must carry ONLY the property that changed'
  );
  assert.deepStrictEqual(
    Array.from(details.customHeaders),
    [],
    'the caller\'s details object must not be mutated'
  );

  const names = headerNames(result.details.customHeaders);
  // No attachments and no fingerprint configured, so those are omitted; the count
  // stays, because "0 files" is a claim and silence is not.
  assert.deepStrictEqual(names, [
    'X-PasevSU-Version',
    'X-PasevSU-Framework',
    'X-PasevSU-Origin',
    'X-PasevSU-Organization',
    'X-PasevSU-Evidence-ID',
    'X-PasevSU-Body-SHA256',
    'X-PasevSU-Attachments-Count',
    'X-PasevSU-Manifest-SHA256',
    'X-PasevSU-Merkle-Root',
    'X-PasevSU-OTS',
    'X-PasevSU-Message-ID',
    'X-PasevSU-Sha256',
    'X-PasevSU-Cripto-Engine',
    'X-PasevSU-Cripto-title',
  ]);

  const headers = headerMap(result.details.customHeaders);
  assert.strictEqual(headers.get('X-PasevSU-Attachments-Count'), '0');
  assert.strictEqual(headers.get('X-PasevSU-Body-SHA256'), sha256Hex('Hello evidence'));
  assert.strictEqual(headers.get('X-PasevSU-Origin'), 'Thunderbird');
  assert.strictEqual(headers.get('X-PasevSU-Organization'), 'PasevSU');
  assert.strictEqual(headers.get('X-PasevSU-OTS'), 'pending');
  assert.match(headers.get('X-PasevSU-Evidence-ID'), /^[0-9a-f-]{36}$/);
});

check('custom headers are the { name, value } objects Thunderbird accepts', async () => {
  // Regression: 0.69.225- pushed "Name: value" STRINGS. Thunderbird >= 100 types
  // ComposeDetails.customHeaders as `{ name, value }` objects, so the returned
  // details failed schema validation inside setComposeDetails() and the send was
  // aborted with no dialog — the compose window just stayed open.
  const { listeners } = loadExtension();
  const details = {
    to: ['a@example.com'],
    subject: 'shape',
    body: '<p>shape</p>',
    plainTextBody: 'shape',
    isPlainText: false,
    attachments: [],
    customHeaders: [{ name: 'X-Foreign', value: 'kept' }],
  };

  const result = await listeners[0]({}, details);
  const entries = Array.from(result.details.customHeaders);

  for (const entry of entries) {
    assert.ok(
      entry && typeof entry === 'object' && !Array.isArray(entry),
      `customHeaders entry must be an object, got ${JSON.stringify(entry)}`
    );
    assert.strictEqual(typeof entry.name, 'string', 'header name must be a string');
    assert.strictEqual(typeof entry.value, 'string', 'header value must be a string');
    // Thunderbird's schema: must start with X-, and must not be X-Mozilla-*.
    assert.match(entry.name, /^X-(?!Mozilla-)/i, `illegal header name: ${entry.name}`);
    assert.doesNotMatch(
      entry.value,
      /[\r\n]/,
      `header value must never inject a line: ${entry.name}`
    );
  }

  // A foreign header survives untouched.
  const foreign = entries.filter((entry) => entry.name === 'X-Foreign');
  assert.strictEqual(foreign.length, 1, 'an existing custom header must not be dropped');
  assert.strictEqual(foreign[0].value, 'kept');

  // Thunderbird aborts the send when handed a duplicate name, so a second fire
  // must not add a second copy of anything.
  const twice = await listeners[0]({}, details);
  const names = Array.from(twice.details.customHeaders, (entry) => String(entry.name).toLowerCase());
  assert.deepStrictEqual(names, [...new Set(names)], 'a header was duplicated');
  assert.strictEqual(
    names.filter((name) => name === 'x-pasevsu-version').length,
    1,
    'X-PasevSU-Version duplicated on re-fire'
  );
});

check('empty body still produces a well-formed hash and root', async () => {
  const { listeners } = loadExtension();
  const details = { isPlainText: true, body: '', attachments: [], customHeaders: [] };
  const { details: out } = await listeners[0]({}, details);
  const headers = headerMap(out.customHeaders);
  assert.strictEqual(headers.get('X-PasevSU-Body-SHA256'), sha256Hex(''));
  assert.match(headers.get('X-PasevSU-Merkle-Root'), HEX64);
});

check('attachments are hashed and the merkle root matches an independent tree', async () => {
  const first = Buffer.from('first attachment bytes');
  const second = Buffer.from('second attachment bytes');
  const { listeners } = loadExtension({
    attachments: {
      7: { name: 'a.txt', bytes: first },
      9: { name: 'b.bin', bytes: second },
    },
  });

  const details = {
    isPlainText: true,
    body: 'body text',
    attachments: [
      { id: 7, name: 'a.txt' },
      { id: 9, name: 'b.bin' },
    ],
    customHeaders: [],
  };
  const { details: out } = await listeners[0]({}, details);
  const headers = headerMap(out.customHeaders);

  const bodyHash = sha256Hex('body text');
  const list = headers.get('X-PasevSU-Attachments-SHA256');
  assert.strictEqual(list, `a.txt=${sha256Hex(first)},b.bin=${sha256Hex(second)}`);

  // Reported defect "the attachment hashes are missing": the comma list alone was
  // too easy to lose. The count and one header per file make each file's hash
  // readable on its own, and survive a client that folds or truncates the list.
  assert.strictEqual(headers.get('X-PasevSU-Attachments-Count'), '2');
  assert.strictEqual(headers.get('X-PasevSU-Attachment-1'), `a.txt=${sha256Hex(first)}`);
  assert.strictEqual(headers.get('X-PasevSU-Attachment-2'), `b.bin=${sha256Hex(second)}`);
  assert.strictEqual(
    headers.get('X-PasevSU-Attachments-Error'),
    undefined,
    'a readable attachment must not also be reported as a failure'
  );

  const expectedRoot = referenceMerkle([bodyHash, sha256Hex(first), sha256Hex(second)]);
  assert.strictEqual(headers.get('X-PasevSU-Merkle-Root'), expectedRoot);
});

check('an unreadable attachment is published as a failure, not as an empty chain', async () => {
  // A file the user attached, that the recipient receives, and that no header
  // mentions: the chain would look complete while covering nothing. Say it out loud.
  const { listeners } = loadExtension({
    attachments: { 8: { name: 'locked.pdf', bytes: Buffer.from('x'), throws: new Error('EPERM') } },
  });

  const details = {
    isPlainText: true,
    body: 'unreadable file',
    attachments: [{ id: 8, name: 'locked.pdf' }],
    customHeaders: [],
  };
  const { details: out } = await listeners[0]({}, details);
  const headers = headerMap(out.customHeaders);

  assert.strictEqual(headers.get('X-PasevSU-Attachments-Count'), '0');
  assert.strictEqual(headers.get('X-PasevSU-Attachments-SHA256'), undefined);
  assert.match(headers.get('X-PasevSU-Attachments-Error'), /^locked\.pdf=EPERM$/);
});

check('the manifest carries the SHA3-512 slots the gateway fills', async () => {
  const bytes = Buffer.from('sealed later');
  const { listeners, added } = loadExtension({
    attachments: { 3: { name: 'c.txt', bytes } },
    listed: [{ id: 3, name: 'c.txt' }],
  });

  const details = { isPlainText: true, body: 'plain', attachments: [], customHeaders: [] };
  await listeners[0]({ id: 9 }, details);
  const parsed = JSON.parse(await added[0].attachment.file.text());

  // Web Crypto has no SHA3-512, so the key is present and null: the shape is the
  // same whichever component built the manifest, and `psemp-gateway seal` can see
  // exactly what it still has to compute.
  assert.ok('message_sha3_512' in parsed, 'the manifest always has the SHA3-512 slot');
  assert.strictEqual(parsed.message_sha3_512, null);
  assert.ok('sha3_512' in parsed.attachments[0]);
  assert.strictEqual(parsed.attachments[0].sha3_512, null);
});

check('the files are enumerated with listAttachments, not the send snapshot', async () => {
  const bytes = Buffer.from('attached proof file');
  const { listeners, added, order } = loadExtension({
    attachments: { 42: { name: 'proof.txt', bytes } },
    // What Thunderbird actually reports at send time: the user attached a file, but
    // the ComposeDetails snapshot says nothing about it.
    listed: [{ id: 42, name: 'proof.txt', size: bytes.length }],
  });

  const details = { isPlainText: true, body: 'with attachment', attachments: [], customHeaders: [] };
  const { details: out } = await listeners[0]({ id: 3 }, details);
  const headers = headerMap(out.customHeaders);

  assert.ok(order.includes('listAttachments'), 'the compose tab is asked for its files');
  assert.strictEqual(
    headers.get('X-PasevSU-Attachments-SHA256'),
    `proof.txt=${sha256Hex(bytes)}`,
    'an empty details.attachments must not erase a real attachment from the evidence chain'
  );

  const parsed = JSON.parse(await added[0].attachment.file.text());
  assert.strictEqual(parsed.attachments.length, 1, 'the manifest lists the attached file');
  assert.strictEqual(parsed.attachments[0].filename, 'proof.txt');
  assert.strictEqual(parsed.attachments[0].sha256, sha256Hex(bytes));
});

check("this add-on's own manifest is not counted as a user attachment", async () => {
  const bytes = Buffer.from('user file');
  const { listeners, added } = loadExtension({
    attachments: { 5: { name: 'doc.pdf', bytes } },
    // A second onBeforeSend (or a retry) sees the manifest added a moment ago.
    listed: [{ id: 5, name: 'doc.pdf' }, { id: 6, name: MANIFEST }],
  });

  const details = { isPlainText: true, body: 'second pass', attachments: [], customHeaders: [] };
  const { details: out } = await listeners[0]({ id: 4 }, details);

  const headers = headerMap(out.customHeaders);
  assert.strictEqual(headers.get('X-PasevSU-Attachments-SHA256'), `doc.pdf=${sha256Hex(bytes)}`);
  const parsed = JSON.parse(await added[0].attachment.file.text());
  assert.deepStrictEqual(
    parsed.attachments.map((a) => a.filename),
    ['doc.pdf'],
    'the manifest must not hash itself'
  );
});

check('the manifest is attached with addAttachment and its own hash is published', async () => {
  const { listeners, added } = loadExtension();
  const details = { isPlainText: true, body: 'manifest check', attachments: [], customHeaders: [] };
  const { details: out } = await listeners[0]({ id: 7 }, details);

  // details.attachments is begin*-only, so it must stay untouched: an entry pushed
  // there is dropped by Thunderbird and the manifest would silently never be sent.
  assert.strictEqual(added.length, 1, 'exactly one manifest attachment added');
  assert.strictEqual(added[0].tabId, 7, 'added to the compose tab being sent');
  assert.strictEqual(added[0].attachment.file.name, MANIFEST);
  assert.deepStrictEqual(Array.from(out.attachments || []), [], 'begin*-only field left alone');

  const text = await added[0].attachment.file.text();
  const headers = headerMap(out.customHeaders);
  assert.strictEqual(
    headers.get('X-PasevSU-Manifest-SHA256'),
    sha256Hex(text),
    'Manifest-SHA256 must be the hash of the bytes actually attached'
  );

  const parsed = JSON.parse(text);
  assert.strictEqual(parsed.framework, 'PasevSU');
  assert.strictEqual(parsed.message_sha256, headers.get('X-PasevSU-Body-SHA256'));
  assert.strictEqual(parsed.merkle_root, headers.get('X-PasevSU-Merkle-Root'));
  assert.strictEqual(parsed.evidence_id, headers.get('X-PasevSU-Evidence-ID'));
  assert.deepStrictEqual(parsed.attachments, []);
});

check('a refused manifest attachment still sends, and the failure is recorded', async () => {
  const { listeners, writes, errors, added } = loadExtension({
    addAttachmentThrows: new Error('addAttachment refused'),
  });
  const details = { isPlainText: true, body: 'refused', attachments: [], customHeaders: [] };
  const out = await listeners[0]({ id: 1 }, details);

  assert.strictEqual(added.length, 0);
  assert.match(
    String(writes.psempManifestError),
    /addAttachment refused/,
    'the options page needs to be able to say the manifest was not attached'
  );
  assert.ok(errors.length > 0, 'the failure is logged, not swallowed');
  // The message must still go out with its headers.
  const headers = headerMap(out.details.customHeaders);
  assert.ok(headers.get('X-PasevSU-Merkle-Root'), 'headers still injected');
  assert.ok(!out.cancel, 'never cancels the send');
});

check('an unreadable attachment is skipped without aborting the send', async () => {
  const { listeners, warnings } = loadExtension({
    attachments: { 5: { name: 'ok.txt', bytes: Buffer.from('readable') } },
  });
  const details = {
    isPlainText: true,
    body: 'partial',
    attachments: [
      { id: 4, name: 'broken.txt' }, // no entry -> getAttachmentFile throws
      { id: 5, name: 'ok.txt' },
    ],
    customHeaders: [],
  };
  const { details: out } = await listeners[0]({}, details);
  const headers = headerMap(out.customHeaders);

  assert.match(headers.get('X-PasevSU-Attachments-SHA256'), /^ok\.txt=/);
  assert.ok(!headers.get('X-PasevSU-Attachments-SHA256').includes('broken.txt'));
  assert.ok(warnings.some((line) => /broken\.txt/.test(line)), 'the skip must be logged');
});

check('existing custom headers are preserved, not replaced', async () => {
  const { listeners } = loadExtension();
  const details = {
    isPlainText: true,
    body: 'keep mine',
    attachments: [],
    customHeaders: ['X-Existing: keep me'],
  };
  const { details: out } = await listeners[0]({}, details);
  assert.strictEqual(out.customHeaders[0], 'X-Existing: keep me');
  assert.ok(out.customHeaders.length > 1);
});

check('a fingerprint is normalised to bare uppercase hex', async () => {
  const { listeners } = loadExtension({
    stored: { pgpFingerprint: 'abcd ef01 2345 6789 abcd ef01 2345 6789 abcd ef01' },
  });
  const details = { isPlainText: true, body: 'fp', attachments: [], customHeaders: [] };
  const { details: out } = await listeners[0]({}, details);
  const headers = headerMap(out.customHeaders);
  assert.strictEqual(
    headers.get('X-PasevSU-PGP-Fingerprint'),
    'ABCDEF0123456789ABCDEF0123456789ABCDEF01'
  );
});

check('enableOts=false drops the marker header', async () => {
  const { listeners } = loadExtension({ stored: { enableOts: false } });
  const details = { isPlainText: true, body: 'no marker', attachments: [], customHeaders: [] };
  const { details: out } = await listeners[0]({}, details);
  assert.ok(!headerMap(out.customHeaders).has('X-PasevSU-OTS'));
});

check('a delivery receipt is requested by default, addressed to the sender', async () => {
  // Reported defect "the delivery-receipt feature does not exist". Like every other
  // header here it must be on without being asked for per message, so the default
  // is enableReceipt: true and the address comes from the identity being sent from.
  const { listeners, writes } = loadExtension();

  const details = {
    isPlainText: true,
    body: 'please confirm receipt',
    attachments: [],
    customHeaders: [],
    from: 'pasev@example.org',
  };
  const { details: out } = await listeners[0]({}, details);
  const headers = headerMap(out.customHeaders);

  assert.strictEqual(headers.get('X-PasevSU-Receipt'), 'requested');
  assert.strictEqual(headers.get('Disposition-Notification-To'), 'pasev@example.org');
  assert.strictEqual(writes.psempReceiptError, null, 'a working receipt leaves no problem behind');
});

check('the receipt falls back to the configured address and a Recipient object', async () => {
  const { listeners } = loadExtension({ stored: { receiptAddress: 'fallback@example.org' } });

  const withoutFrom = { isPlainText: true, body: 'a', attachments: [], customHeaders: [] };
  const first = await listeners[0]({}, withoutFrom);
  assert.strictEqual(
    headerMap(first.details.customHeaders).get('Disposition-Notification-To'),
    'fallback@example.org',
    'a snapshot without `from` still gets a receipt, via the configured address'
  );

  const objectFrom = {
    isPlainText: true,
    body: 'b',
    attachments: [],
    customHeaders: [],
    from: { email: 'object@example.org' },
  };
  const second = await listeners[0]({}, objectFrom);
  assert.strictEqual(
    headerMap(second.details.customHeaders).get('Disposition-Notification-To'),
    'object@example.org'
  );
});

check('no address means no receipt header, and the reason is recorded', async () => {
  const { listeners, writes } = loadExtension();
  const details = { isPlainText: true, body: 'nobody', attachments: [], customHeaders: [] };
  const { details: out } = await listeners[0]({}, details);

  const headers = headerMap(out.customHeaders);
  assert.ok(!headers.has('Disposition-Notification-To'), 'a receipt with no address is not sent');
  assert.ok(!headers.has('X-PasevSU-Receipt'));
  // A code, not a sentence: the options page owns the words and translates them.
  assert.strictEqual(writes.psempReceiptError, 'no-address');
});

check('enableReceipt=false drops both receipt headers', async () => {
  const { listeners } = loadExtension({ stored: { enableReceipt: false } });
  const details = {
    isPlainText: true,
    body: 'no receipt',
    attachments: [],
    customHeaders: [],
    from: 'pasev@example.org',
  };
  const { details: out } = await listeners[0]({}, details);
  const headers = headerMap(out.customHeaders);

  assert.ok(!headers.has('Disposition-Notification-To'));
  assert.ok(!headers.has('X-PasevSU-Receipt'));
});

check('the HTML body falls back to plainTextBody', async () => {
  const { listeners } = loadExtension();
  const details = {
    isPlainText: false,
    body: '<p>rich</p>',
    plainTextBody: 'rich',
    attachments: [],
    customHeaders: [],
  };
  const { details: out } = await listeners[0]({}, details);
  assert.strictEqual(
    headerMap(out.customHeaders).get('X-PasevSU-Body-SHA256'),
    sha256Hex('rich')
  );
});

check('a realistic compose snapshot is never echoed back as the return value', async () => {
  // This is the shape Thunderbird actually hands to onBeforeSend: a full
  // getComposeDetails() snapshot. Returning it is functionally a
  // setComposeDetails() write of every property, and the ones marked read-only or
  // gated behind accountsRead make that write throw, which aborts the send with no
  // dialog and no message — exactly the silent failure this check exists to stop.
  const { listeners } = loadExtension();
  const details = {
    isPlainText: false,
    body: '<p>snapshot</p>',
    plainTextBody: 'snapshot',
    subject: 'snapshot',
    to: ['pasevdenislav@gmail.com'],
    cc: [],
    bcc: [],
    from: { email: 'pasevdenislav@gmail.com' },
    identityId: 'id8',
    isModified: true,
    deliveryFormat: 'auto',
    deliveryStatusNotification: false,
    attachVCard: false,
    attachPublicPGPKey: false,
    overrideDefaultFcc: false,
    additionalFccFolder: '',
    newsgroups: [],
    followupTo: [],
    customHeaders: [{ name: 'X-Foreign', value: 'kept' }],
    attachments: [{ id: 1, name: 'doc.txt', size: 12 }],
  };
  const frozen = JSON.stringify(details);
  const result = await listeners[0]({}, details);

  assert.deepStrictEqual(Array.from(Object.keys(result.details)), [
    'customHeaders',
  ], 'nothing but customHeaders may be returned');
  const names = headerNames(result.details.customHeaders);
  assert.ok(names.includes('X-Foreign'), 'foreign headers must survive');
  assert.ok(names.includes('X-PasevSU-Merkle-Root'), 'our headers must be added');
  assert.strictEqual(JSON.stringify(details), frozen, 'the snapshot must not be mutated');
});

check('a storage failure still sends the message unmodified', async () => {
  const { listeners, errors } = loadExtension({ storageGetThrows: true });
  const details = {
    isPlainText: true,
    body: 'unchanged',
    attachments: [],
    customHeaders: ['X-Existing: keep me'],
  };
  const result = await listeners[0]({}, details);
  assert.ok(!result.cancel, 'must never cancel');
  // `{}` means "no changes" — the send proceeds. Echoing the snapshot back would
  // abort it (see 'a realistic compose snapshot is never echoed back' above).
  assert.deepStrictEqual(Array.from(Object.keys(result || {})), [], 'must return no changes at all');
  assert.deepStrictEqual(Array.from(details.customHeaders), ['X-Existing: keep me']);
  assert.ok(errors.some((line) => /injection failed/.test(line)), 'the failure must be logged');
});

check('a send records a breadcrumb proving the listener fired', async () => {
  const { listeners, writes } = loadExtension();
  const details = {
    isPlainText: true,
    body: 'breadcrumb',
    attachments: [],
    customHeaders: [],
  };
  const result = await listeners[0]({}, details);

  // Without this record, "did the extension stamp anything?" could only be answered
  // by finding the message again in a Sent folder — which Send Later can bypass and
  // an IMAP server may never write to local disk.
  const record = writes.psempLastSend;
  assert.ok(record, 'psempLastSend must be written on every send');
  assert.strictEqual(record.bodySha256, sha256Hex('breadcrumb'));
  assert.strictEqual(record.merkleRoot, referenceMerkle([sha256Hex('breadcrumb')]));
  assert.match(record.manifestSha256, HEX64);
  assert.match(record.evidenceId, /^[0-9a-f-]{36}$/);
  assert.match(record.at, /^\d{4}-\d\d-\d\dT/);
  assert.strictEqual(record.attachmentCount, 0);
  assert.deepStrictEqual(Array.from(record.headers), headerNames(result.details.customHeaders));
  assert.strictEqual(writes.psempSendCount, 1);
});

check('the send counter increments instead of restarting at one', async () => {
  const { listeners, writes } = loadExtension({ stored: { psempSendCount: 41 } });
  const details = { isPlainText: true, body: 'again', attachments: [], customHeaders: [] };
  await listeners[0]({}, details);
  assert.strictEqual(writes.psempSendCount, 42);
});

check('a failed scan leaves no breadcrumb claiming a stamped send', async () => {
  const { listeners, writes } = loadExtension({ storageGetThrows: true });
  const details = { isPlainText: true, body: 'x', attachments: [], customHeaders: [] };
  const result = await listeners[0]({}, details);
  assert.ok(!result.cancel, 'must never cancel');
  assert.deepStrictEqual(Array.from(Object.keys(result || {})), [], 'must return no changes at all');
  assert.strictEqual(writes.psempLastSend, undefined);
  assert.strictEqual(writes.psempSendCount, undefined);
});

check('background.js stays a pure MailExtension (no Node, no remote code)', () => {
  assert.ok(!/\brequire\s*\(/.test(BARE_CODE), 'require() is not available in a MailExtension');
  assert.ok(!/\bimport\s+.*\bfrom\b/.test(BARE_CODE), 'no ES module imports');
  assert.ok(!/\bprocess\./.test(BARE_CODE), 'no Node process object');
  assert.ok(
    /crypto\.subtle\.digest\(\s*["']SHA-256["']/.test(BARE_CODE),
    'must use Web Crypto SHA-256'
  );
  assert.ok(!/["'](?:md5|sha1)["']/i.test(BARE_CODE), 'MD5/SHA1 must not appear');
});

check('every header name is a syntactically valid field name', () => {
  const { listeners, order } = loadExtension();
  assert.ok(order.includes('addListener'));
  assert.ok(listeners.length === 1);
  // Field name ABNF: printable ASCII except colon; kept to a conservative subset.
  const fieldName = /^[A-Za-z0-9-]{1,78}$/;
  const names = [
    'X-PasevSU-Version',
    'X-PasevSU-Framework',
    'X-PasevSU-Origin',
    'X-PasevSU-Organization',
    'X-PasevSU-Evidence-ID',
    'X-PasevSU-Body-SHA256',
    'X-PasevSU-Attachments-SHA256',
    'X-PasevSU-Manifest-SHA256',
    'X-PasevSU-Merkle-Root',
    'X-PasevSU-PGP-Fingerprint',
    'X-PasevSU-OTS',
    'X-PasevSU-Message-ID',
    'X-PasevSU-Sha256',
    'X-PasevSU-Cripto-Engine',
    'X-PasevSU-Cripto-title',
  ];
  for (const name of names) {
    assert.match(name, fieldName, `${name} is not a valid field name`);
    assert.ok(CODE.includes(name), `${name} is not written by background.js`);
  }
});

check('the digest block lists body, every file and the timestep in one value', async () => {
  const first = Buffer.from('first attachment bytes');
  const second = Buffer.from('second attachment bytes');
  const { listeners, added } = loadExtension({
    attachments: {
      7: { name: 'a.txt', bytes: first },
      9: { name: 'b.bin', bytes: second },
    },
  });

  const details = {
    isPlainText: true,
    body: 'body text',
    attachments: [
      { id: 7, name: 'a.txt' },
      { id: 9, name: 'b.bin' },
    ],
    customHeaders: [],
  };
  const { details: out } = await listeners[0]({}, details);
  const headers = headerMap(out.customHeaders);

  const block = headers.get('X-PasevSU-Sha256');
  assert.strictEqual(typeof block, 'string', 'X-PasevSU-Sha256 must be emitted');
  const rows = block.split(',');

  // The requested shape, in this order: body, one row per file, then the timestep.
  assert.strictEqual(rows[0], `body - ${sha256Hex('body text')}`);
  assert.strictEqual(rows[1], `a.txt - ${sha256Hex(first)}`);
  assert.strictEqual(rows[2], `b.bin - ${sha256Hex(second)}`);
  assert.strictEqual(rows.length, 4, 'exactly body + 2 files + timestep');
  assert.match(rows[3], /^timestep - \d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'last row is the timestep');

  // The stamp is not decoration: it must be the same instant written into the
  // manifest, otherwise the seal and the header describe different messages.
  const manifestFile = added.find((entry) => entry.attachment.file.name === MANIFEST);
  assert.ok(manifestFile, 'the manifest must still be attached');
  const manifest = JSON.parse(await manifestFile.attachment.file.text());
  assert.strictEqual(rows[3], `timestep - ${manifest.timestamp}`);
});

check('the crypto engine code is 25 digits and opens the encrypted title', async () => {
  const first = Buffer.from('first attachment bytes');
  const { listeners } = loadExtension({
    attachments: { 7: { name: 'index,odd.txt', bytes: first } },
  });

  const details = {
    isPlainText: true,
    body: 'body text',
    attachments: [{ id: 7, name: 'index,odd.txt' }],
    customHeaders: [],
  };
  const { details: out } = await listeners[0]({}, details);
  const headers = headerMap(out.customHeaders);

  const engine = headers.get('X-PasevSU-Cripto-Engine');
  assert.match(engine, /^[0-9]{25}$/, 'the engine code is 25 digits');

  const merkle = headers.get('X-PasevSU-Merkle-Root');
  const plain = headers.get('X-PasevSU-Sha256');
  const title = headers.get('X-PasevSU-Cripto-title');
  assert.match(title, /^gcm1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  // Parity with the gateway, not a round-trip against itself: the code and the
  // ciphertext are produced by api.js and must match what the extension emitted.
  // Two independent implementations agreeing is the point of a derived code.
  const gateway = require('../api.js');
  assert.strictEqual(
    gateway.cryptoEngineCode({ merkleRoot: merkle, bodySha256: sha256Hex('body text') }),
    engine,
    'the extension and the gateway derived different engine codes'
  );
  assert.deepStrictEqual(
    Array.from(gateway.decryptDigestBlock(engine, title, { merkleRoot: merkle })),
    plain.split(','),
    'the encrypted title does not open to the readable block'
  );

  // A wrong code must not silently return the plaintext.
  const wrong = engine === '0000000000000000000000000' ? '1111111111111111111111111' : '0000000000000000000000000';
  assert.throws(
    () => gateway.decryptDigestBlock(wrong, title, { merkleRoot: merkle }),
    /./,
    'a foreign code must not open the title'
  );

  // A file name that contains the row separator is escaped, so the block still
  // parses into the documented number of rows.
  assert.match(plain, /index_odd\.txt - /, 'a comma in a file name must not split the row');
});

check('the message id is long, non-standard and per-message', async () => {
  const { listeners } = loadExtension();
  const details = { isPlainText: true, body: 'body text', attachments: [], customHeaders: [] };
  const once = headerMap((await listeners[0]({}, details)).details.customHeaders);
  const twice = headerMap((await listeners[0]({}, details)).details.customHeaders);

  const id = once.get('X-PasevSU-Message-ID');
  // X- prefixed: ComposeDetails.customHeaders rejects any other name, and a
  // rejected setComposeDetails() aborts the send with no dialog.
  assert.ok(!once.has('Message-ID'), 'a bare Message-ID would abort the send');
  assert.match(id, /^<PasevSU\.\d{14}\.[0-9a-f-]{36}\+[0-9a-f]{6}_[0-9a-f]{6}~[0-9a-f]{6}\.[0-9a-f]{6}@forensic\.evidence\.pasevsu>$/);
  assert.ok(id.length > 90, `expected a long message id, got ${id.length} chars`);
  assert.notStrictEqual(id, twice.get('X-PasevSU-Message-ID'), 'each send gets its own evidence id');
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
