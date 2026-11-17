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
const fs = require('node:fs');
const path = require('node:path');

const {
  SOURCE,
  CODE,
  BARE_CODE,
  HEX64,
  MANIFEST_FILENAME: MANIFEST,
  sha256Hex,
  referenceMerkle,
  addonVersion,
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
    ['customHeaders', 'subject', 'body'],
    'details must carry ONLY the writable properties that changed'
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
    'X-PasevSU-Build',
    'X-PasevSU-Framework',
    'X-PasevSU-Origin',
    'X-PasevSU-Organization',
    'X-PasevSU-WAR',
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
    'X-PasevSU-Created',
    'X-PasevSU-Expires',
    'X-PasevSU-Nonce',
    'X-PasevSU-Sequence',
    'X-PasevSU-Canary',
    'X-PasevSU-Headers-SHA256',
  ]);

  const headers = headerMap(result.details.customHeaders);
  assert.strictEqual(headers.get('X-PasevSU-Attachments-Count'), '0');
  assert.strictEqual(headers.get('X-PasevSU-Body-SHA256'), sha256Hex('Hello evidence'));
  assert.strictEqual(headers.get('X-PasevSU-Origin'), 'Thunderbird');
  assert.strictEqual(headers.get('X-PasevSU-Organization'), 'PasevSU');
  assert.strictEqual(headers.get('X-PasevSU-OTS'), 'pending');
  assert.match(headers.get('X-PasevSU-Evidence-ID'), /^[0-9a-f-]{36}$/);

  /*
   * "винаги да се вписва": the war marker is not a setting. It closes the Subject,
   * it closes the body, and X-PasevSU-WAR restates what it points at. The value is a
   * REQUIREMENT — only a signature from the named address proves the message — never
   * a claim that this add-on signed anything (Thunderbird's OpenPGP does that).
   */
  const war = headers.get('X-PasevSU-WAR');
  assert.match(war, /pasevdenislav@gmail\.com/, 'the war header must name the signer');
  assert.match(war, /RFC 4880 and 3156/, 'the war header must name the signature standard');
  assert.match(war, /FORBIDDEN/, 'the war header must state the forwarding prohibition');
  assert.strictEqual(
    result.details.subject,
    '{{ PasevSU-WAR }}',
    'an empty authored Subject must become just the marker'
  );
  assert.ok(
    result.details.body.startsWith('Hello evidence'),
    'the authored body must be preserved verbatim, with the notice appended after it'
  );
  assert.ok(
    result.details.body.includes('{{ PasevSU-WAR }}'),
    'the prohibition must be stated inside the email itself, not only in the headers'
  );
  // The digest identifies what the sender WROTE, so appending the notice must not move it.
  assert.strictEqual(
    headers.get('X-PasevSU-Body-SHA256'),
    sha256Hex('Hello evidence'),
    'the body digest must be taken before the notice is appended'
  );
});

check('a re-fired beforeSend does not stack the marker or the notice', async () => {
  /*
   * Thunderbird may fire onBeforeSend more than once for one message (re-open, Send
   * Later, retry) — measured at THREE times for a single real send. Two markers or two
   * footers would be visible to the recipient, and, worse, every pass minted its own
   * evidenceId and attached its own manifest, so the message carried three manifests
   * while the headers named only the last one.
   *
   * The answer is therefore not "de-duplicate the second pass" but "do not run it at
   * all": a message that already carries our evidence header is sent exactly as it is,
   * which the extension declares by returning `{}` (no changes to apply).
   */
  const { listeners, order } = loadExtension();
  const details = {
    isPlainText: true,
    subject: 'Case 2026',
    body: 'authored',
    attachments: [],
    customHeaders: [],
  };
  const first = await listeners[0]({}, details);
  assert.ok(first.details, 'the first pass must produce the stamped message');

  const second = await listeners[0]({}, first.details);
  // Compared by keys, not deepStrictEqual: the listener runs inside a vm realm, whose
  // Object.prototype is not this realm's, so a plain `{}` would fail prototype equality.
  assert.deepStrictEqual(Object.keys(second), [], 'a re-fired pass must return no changes, so the send proceeds untouched');
  assert.deepStrictEqual(
    first.details.customHeaders.filter((h) => h.name === 'X-PasevSU-WAR').length,
    1,
    'the marker is written once'
  );
  assert.strictEqual(
    (first.details.subject.match(/\{\{ PasevSU-WAR \}\}/g) || []).length,
    1,
    'the subject marker is written once'
  );
  assert.ok(
    order.includes('storage.set:psempRestamps'),
    'the skipped pass is recorded, so a triple fire is visible instead of silent'
  );
});

check("the add-on's own manifest is never hashed as a user attachment", async () => {
  /*
   * Defence in depth for the one path the guard cannot see: listAttachments() is
   * unavailable (older build) or empty, so the stamp check comes up blind and the
   * pass proceeds on details.attachments — which may still name the manifest a
   * previous pass left behind. Hashing it would put our own envelope in the evidence
   * chain, and the manifest would then disagree with itself.
   */
  const bytes = Buffer.from('user file');
  const { listeners, added } = loadExtension({
    attachments: { 5: { name: 'doc.pdf', bytes } },
    listed: null,
  });

  const details = {
    isPlainText: true,
    body: 'second pass',
    attachments: [{ id: 5, name: 'doc.pdf' }, { id: 6, name: MANIFEST }],
    customHeaders: [],
  };
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

check('the WAR texts are byte-identical in both engines', () => {
  /*
   * The twin rule was prose before this check: both engines CLAIMED to state the same
   * thing, and had already drifted into three different wordings (plus a third in
   * PROTOCOL.md). Identity only holds if it is compared, so read the extension's
   * constants straight out of the source and compare them with the gateway's.
   */
  const start = CODE.indexOf('const WAR_MARKER');
  const end = CODE.indexOf('function hexFromBuffer');
  assert.ok(start >= 0 && end > start, 'the WAR constants must sit together, before the hashing helpers');

  const names = [
    'WAR_MARKER',
    'WAR_SIGNER',
    'WAR_STANDARD',
    'WAR_HEADER_TEXT',
    'WAR_NOTICE_TEXT',
    'WAR_NOTICE_HTML',
  ];
  const probe = `${CODE.slice(start, end)}\n;({${names.join(', ')}})`;
  const extension = vm.runInNewContext(probe, {}, { filename: 'background.js#war' });
  const gateway = require('../api.js');

  for (const name of names) {
    assert.strictEqual(
      extension[name],
      gateway[name],
      `${name} drifted between thunderbird-extension/background.js and psemp-gateway/api.js`
    );
  }

  // Shape the bytes have to keep, independently of the wording.
  const { WAR_MARKER, WAR_HEADER_TEXT, WAR_NOTICE_TEXT, WAR_NOTICE_HTML } = extension;
  assert.strictEqual(WAR_HEADER_TEXT, WAR_HEADER_TEXT.trim(), 'the header value must not be padded');
  assert.ok(!/[\r\n]/.test(WAR_HEADER_TEXT), 'the header value must be one line');
  assert.ok(WAR_HEADER_TEXT.endsWith(WAR_MARKER), 'the header value must end with the marker');
  assert.strictEqual(
    WAR_NOTICE_TEXT.split(WAR_MARKER).length - 1,
    1,
    'the notice must carry the marker exactly once, so endsWith can strip it'
  );
  assert.ok(
    WAR_NOTICE_TEXT.startsWith(`\n\n${WAR_MARKER}\n`) && WAR_NOTICE_TEXT.endsWith('\n'),
    'the notice must be a self-delimiting block that begins after a blank line'
  );
  for (const [name, value, allowed] of [
    ['WAR_HEADER_TEXT', WAR_HEADER_TEXT, '[^\\x20-\\x7E]'],
    ['WAR_NOTICE_TEXT', WAR_NOTICE_TEXT, '[^\\x20-\\x7E\\n]'],
    ['WAR_NOTICE_HTML', WAR_NOTICE_HTML, '[^\\x20-\\x7E\\n]'],
  ]) {
    assert.ok(
      !new RegExp(allowed).test(value),
      `${name} must stay ASCII; non-ASCII needs RFC 2047 encoding`
    );
  }
  // The prohibition has to survive in all three places, not just in the one we test first.
  assert.match(WAR_NOTICE_HTML, /FORWARDING THIS EMAIL IS STRICTLY FORBIDDEN/);
  assert.match(WAR_NOTICE_HTML, /pasevdenislav@gmail\.com/);
  assert.match(WAR_NOTICE_HTML, /RFC 4880 and 3156/);
});

check('the documentation quotes the canonical WAR bytes and nothing retired', () => {
  /*
   * The drift did not stop at the two engines: PROTOCOL.md described a THIRD wording
   * that neither of them emitted, so a verifier reading only the spec would compute a
   * footer that never existed. A spec that paraphrases is worse than no spec, so the
   * two documents that quote the value are held to the exact bytes, and the phrasings
   * this change retired are refused everywhere.
   */
  const root = path.join(__dirname, '..', '..');
  const gateway = require('../api.js');
  const deindent = (text) => text.replace(/^[ \t]+/gm, '');

  for (const relative of ['psemp-gateway/PROTOCOL.md', 'thunderbird-extension/README.md']) {
    const text = deindent(fs.readFileSync(path.join(root, relative), 'utf8'));
    assert.ok(
      text.includes(gateway.WAR_HEADER_TEXT),
      `${relative} must quote WAR_HEADER_TEXT exactly, not a paraphrase`
    );
    // The notice minus its two leading blank lines, which the docs spell out as
    // "<blank line>" so the block stays readable.
    assert.ok(
      text.includes(gateway.WAR_NOTICE_TEXT.split('\n').slice(2).join('\n')),
      `${relative} must quote the notice body exactly`
    );
  }

  // The retired wordings. `\s+` because a paraphrase wraps differently in each file,
  // and the needles are kept apart from the prose above so a rewrite cannot accidentally
  // satisfy both sides. This file is skipped: it holds them on purpose.
  const retired = [
    /Identity is proven only by an/i,
    /A message without that signature is not ours/i,
    /--- \{\{ PasevSU-WAR \}\} ---/,
  ];
  const readme = path.join(root, 'psemp-gateway', 'README.md');
  const files = [
    ...fs
      .readdirSync(path.join(root, 'psemp-gateway'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => path.join(root, 'psemp-gateway', name)),
    ...fs
      .readdirSync(path.join(root, 'thunderbird-extension'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => path.join(root, 'thunderbird-extension', name)),
  ];
  assert.ok(files.includes(readme), 'the gateway README must be in the scanned set');
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of retired) {
      assert.ok(
        !pattern.test(text),
        `${path.relative(root, file)} still carries a retired WAR wording (${pattern})`
      );
    }
  }
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

check("a manifest already in the message stops a second stamping pass", async () => {
  const bytes = Buffer.from('user file');
  const { listeners, added } = loadExtension({
    attachments: { 5: { name: 'doc.pdf', bytes } },
    // A second onBeforeSend (or a retry) sees the manifest added a moment ago.
    listed: [{ id: 5, name: 'doc.pdf' }, { id: 6, name: MANIFEST }],
  });

  const details = { isPlainText: true, body: 'second pass', attachments: [], customHeaders: [] };
  const out = await listeners[0]({ id: 4 }, details);

  // A manifest already in the message proves a pass completed, so this one declines to
  // run: an empty result leaves the message exactly as the earlier pass stamped it.
  assert.deepStrictEqual(Object.keys(out), [], 'a pass that sees the manifest must not stamp again');
  assert.strictEqual(added.length, 0, 'no second manifest is attached');
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

  /*
   * PSEMP 1.1 — the manifest and the headers must describe ONE nonce. The gateway
   * reads the nonce out of the manifest and refuses the message if it has seen it
   * before, so any disagreement here would either make every send look like a
   * replay or let a replayed copy through as first-use.
   */
  assert.match(parsed.replay.nonce, /^[0-9a-f]{32}$/, 'the nonce must be 128-bit hex');
  assert.strictEqual(parsed.replay.single_use, true);
  assert.strictEqual(headers.get('X-PasevSU-Nonce'), parsed.replay.nonce);
  assert.strictEqual(headers.get('X-PasevSU-Created'), parsed.replay.issued_at);
  assert.strictEqual(headers.get('X-PasevSU-Expires'), parsed.replay.expires_at);
  assert.strictEqual(headers.get('X-PasevSU-Sequence'), String(parsed.replay.sequence));
  assert.strictEqual(
    parsed.replay.expires_at,
    new Date(Date.parse(parsed.replay.issued_at) + 3600 * 1000).toISOString(),
    'the freshness window must be one hour'
  );
  assert.match(headers.get('X-PasevSU-Canary'), /^PASEVSU-\d{4}-\d{2}-\d{2}-[0-9A-F]{8}$/);
  assert.strictEqual(parsed.provenance.framework, 'PasevSU');

  // Cross-engine: the metadata digest written by Web Crypto in the extension must
  // recompute with node:crypto here, or the gateway's verifier would reject every
  // message the extension produced.
  const { headers_sha256: declared, ...signedRecord } = parsed.signed_headers;
  assert.strictEqual(sha256Hex(JSON.stringify(signedRecord)), declared);
  assert.strictEqual(headers.get('X-PasevSU-Headers-SHA256'), declared);
  return `${parsed.replay.nonce.slice(0, 8)}… seq ${parsed.replay.sequence}`;
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

check('a value that cannot be a fingerprint is not published as one', async () => {
  /*
   * Measured on a real send: `X-PasevSU-PGP-Fingerprint` carried 28 hex digits — the
   * case ID pasted into the wrong field. Normalisation only upper-cased, so the claim
   * reached the wire, and the verifier then compared a key ID against the signer's real
   * fingerprint and reported the message as untrusted. A claim that is provably not a
   * fingerprint is worse than no claim, so it is dropped and recorded for the options
   * page instead.
   */
  const cases = [
    ['CB506C11850F99BBBBA54D09C6A8', 'wrong-length'],
    ['97151EA3065D5EC6', 'key-id-not-fingerprint'],
    ['not a fingerprint at all', 'not-hex'],
  ];
  for (const [value, expected] of cases) {
    const { listeners, writes, errors } = loadExtension({ stored: { pgpFingerprint: value } });
    const details = { isPlainText: true, body: 'fp', attachments: [], customHeaders: [] };
    const { details: out } = await listeners[0]({}, details);
    assert.ok(
      !headerMap(out.customHeaders).has('X-PasevSU-PGP-Fingerprint'),
      `${expected}: the impossible claim must not reach the wire`
    );
    assert.ok(
      writes.psempFingerprintIssue === expected,
      `${expected}: the reason is recorded so the options page can show it`
    );
    assert.ok(
      errors.some((line) => line.includes('pgpFingerprint')),
      `${expected}: and logged`
    );
  }
});

check('a 64-hex (v6) fingerprint is accepted like a v4 one', async () => {
  const v6 = 'A'.repeat(64);
  const { listeners } = loadExtension({ stored: { pgpFingerprint: v6.toLowerCase() } });
  const details = { isPlainText: true, body: 'fp', attachments: [], customHeaders: [] };
  const { details: out } = await listeners[0]({}, details);
  assert.strictEqual(headerMap(out.customHeaders).get('X-PasevSU-PGP-Fingerprint'), v6);
});

check('enableOts=false drops the marker header', async () => {
  const { listeners } = loadExtension({ stored: { enableOts: false } });
  const details = { isPlainText: true, body: 'no marker', attachments: [], customHeaders: [] };
  const { details: out } = await listeners[0]({}, details);
  assert.ok(!headerMap(out.customHeaders).has('X-PasevSU-OTS'));
});

check('the case label rides along, and an empty one leaves no header', async () => {
  // The original brief asked for a per-case label (`X-hAPI-Case-ID`) that a recipient
  // could read without opening the manifest. It was dropped in the rename to the
  // X-PasevSU-* contract, so nothing downstream could tell two cases apart.
  const unset = loadExtension({ stored: {} });
  const blank = await unset.listeners[0]({}, {
    isPlainText: true,
    body: 'no case',
    attachments: [],
    customHeaders: [],
  });
  assert.ok(
    !headerMap(blank.details.customHeaders).has('X-PasevSU-Case-ID'),
    'an empty caseId must be omitted, not sent blank'
  );

  const { listeners } = loadExtension({ stored: { caseId: 'CASE-2026-001' } });
  const { details: out } = await listeners[0]({}, {
    isPlainText: true,
    body: 'no case',
    attachments: [],
    customHeaders: [],
  });
  assert.strictEqual(headerMap(out.customHeaders).get('X-PasevSU-Case-ID'), 'CASE-2026-001');
});

check('a delivery receipt is requested by default, through the native field', async () => {
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
  // The request itself is Thunderbird's own `Disposition-Notification-To`, added when
  // ComposeDetails.returnReceipt is true. Putting that name in customHeaders is rejected
  // by the platform and silently kills the send, so it must never appear there.
  assert.strictEqual(out.returnReceipt, true, 'the receipt must be requested natively');
  assert.ok(
    !headers.has('Disposition-Notification-To'),
    'a standard field must never be placed in customHeaders'
  );
  assert.strictEqual(writes.psempLastSend.receiptTo, 'pasev@example.org');
  assert.strictEqual(writes.psempReceiptError, null, 'a working receipt leaves no problem behind');
});

check('the receipt falls back to the configured address and a Recipient object', async () => {
  const { listeners, writes } = loadExtension({ stored: { receiptAddress: 'fallback@example.org' } });

  const withoutFrom = { isPlainText: true, body: 'a', attachments: [], customHeaders: [] };
  const first = await listeners[0]({}, withoutFrom);
  assert.strictEqual(first.details.returnReceipt, true);
  assert.strictEqual(
    writes.psempLastSend.receiptTo,
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
  assert.strictEqual(second.details.returnReceipt, true);
  assert.strictEqual(writes.psempLastSend.receiptTo, 'object@example.org');
});

check('no address means no receipt request, and the reason is recorded', async () => {
  const { listeners, writes } = loadExtension();
  const details = { isPlainText: true, body: 'nobody', attachments: [], customHeaders: [] };
  const { details: out } = await listeners[0]({}, details);

  const headers = headerMap(out.customHeaders);
  assert.ok(!headers.has('Disposition-Notification-To'), 'a receipt with no address is not sent');
  assert.ok(!headers.has('X-PasevSU-Receipt'));
  assert.strictEqual(out.returnReceipt, undefined, 'no address must not request a receipt natively');
  assert.strictEqual(writes.psempLastSend.receiptTo, null);
  // A code, not a sentence: the options page owns the words and translates them.
  assert.strictEqual(writes.psempReceiptError, 'no-address');
});

check('enableReceipt=false drops the receipt request entirely', async () => {
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
  assert.strictEqual(out.returnReceipt, undefined);
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
    'subject',
    // The receipt request is a native boolean, not a header: `Disposition-Notification-To`
    // is not an admissible custom header name and writing it there kills the send.
    'returnReceipt',
    'body',
  ], 'nothing but the writable properties that change may be returned');
  assert.strictEqual(
    result.details.subject,
    `snapshot {{ PasevSU-WAR }}`,
    'the marker must be appended to the authored Subject with exactly one space'
  );
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
    'X-PasevSU-WAR',
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
    'X-PasevSU-Created',
    'X-PasevSU-Expires',
    'X-PasevSU-Nonce',
    'X-PasevSU-Sequence',
    'X-PasevSU-Canary',
    'X-PasevSU-Headers-SHA256',
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
  assert.match(
    id,
    /^<PasevSU\.\d{14}\.[0-9a-f-]{36}\+[0-9a-f]{6}_[0-9a-f]{6}~[0-9a-f]{6}\.[0-9a-f]{6}@forensic\.evidence\.pasevsu-dev\.com>$/
  );
  assert.ok(id.length > 90, `expected a long message id, got ${id.length} chars`);
  assert.notStrictEqual(id, twice.get('X-PasevSU-Message-ID'), 'each send gets its own evidence id');
});

/*
 * The recipient's only way to tell which build stamped a message. `Version` is the
 * user-set config/format version (default "1.0" per the brief), so two very different
 * builds both said "1.0" — exactly the confusion that made a stale prototype look
 * current. `Build` comes from the manifest, so it cannot go stale by being forgotten.
 */
check('the build header reports the add-on version, not the config version', async () => {
  const { listeners } = loadExtension();
  const details = { isPlainText: true, body: 'body text', attachments: [], customHeaders: [] };
  const headers = headerMap((await listeners[0]({}, details)).details.customHeaders);

  const build = headers.get('X-PasevSU-Build');
  assert.strictEqual(build, addonVersion(), 'Build must be the manifest version');
  assert.strictEqual(
    headers.get('X-PasevSU-Version'),
    '1.0',
    'Version stays the config/format version, independent of the build'
  );
  assert.notStrictEqual(build, headers.get('X-PasevSU-Version'), 'the two must be distinguishable');
  return `build ${build}`;
});

/*
 * A missing `runtime` must cost the Build header and nothing else. The send has to
 * survive it: an environment without the API is the older stub, not a broken message.
 */
check('a missing runtime drops only the build header', async () => {
  const { listeners } = loadExtension({ noRuntime: true });
  const details = { isPlainText: true, body: 'body text', attachments: [], customHeaders: [] };
  const result = await listeners[0]({}, details);

  assert.ok(result && result.details, 'the listener must still return details');
  assert.ok(!result.cancel, 'the send must not be cancelled');
  const headers = headerMap(result.details.customHeaders);
  assert.ok(!headers.has('X-PasevSU-Build'), 'no build header without a manifest');
  assert.strictEqual(headers.get('X-PasevSU-Version'), '1.0', 'the rest is unaffected');
  assert.ok(headers.has('X-PasevSU-Merkle-Root'), 'the evidence headers are still emitted');
  return 'send unaffected';
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
