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
  // The extension reassigns details.customHeaders from inside the vm, so both
  // sides must be normalised out of that realm before deepStrictEqual.
  assert.deepStrictEqual(
    Array.from(result.details.customHeaders),
    Array.from(details.customHeaders)
  );

  const names = headerNames(result.details.customHeaders);
  // No attachments and no fingerprint configured, so those two are omitted.
  assert.deepStrictEqual(names, [
    'X-PasevSU-Version',
    'X-PasevSU-Framework',
    'X-PasevSU-Origin',
    'X-PasevSU-Organization',
    'X-PasevSU-Evidence-ID',
    'X-PasevSU-Body-SHA256',
    'X-PasevSU-Manifest-SHA256',
    'X-PasevSU-Merkle-Root',
    'X-PasevSU-OTS',
  ]);

  const headers = headerMap(result.details.customHeaders);
  assert.strictEqual(headers.get('X-PasevSU-Body-SHA256'), sha256Hex('Hello evidence'));
  assert.strictEqual(headers.get('X-PasevSU-Origin'), 'Thunderbird');
  assert.strictEqual(headers.get('X-PasevSU-Organization'), 'PasevSU');
  assert.strictEqual(headers.get('X-PasevSU-OTS'), 'pending');
  assert.match(headers.get('X-PasevSU-Evidence-ID'), /^[0-9a-f-]{36}$/);
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

  const expectedRoot = referenceMerkle([bodyHash, sha256Hex(first), sha256Hex(second)]);
  assert.strictEqual(headers.get('X-PasevSU-Merkle-Root'), expectedRoot);
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

check('a storage failure still sends the message unmodified', async () => {
  const { listeners, errors } = loadExtension({ storageGetThrows: true });
  const details = {
    isPlainText: true,
    body: 'unchanged',
    attachments: [],
    customHeaders: ['X-Existing: keep me'],
  };
  const result = await listeners[0]({}, details);
  assert.ok(result && result.details, 'must still return { details }');
  assert.ok(!result.cancel, 'must never cancel');
  assert.deepStrictEqual(result.details.customHeaders, ['X-Existing: keep me']);
  assert.ok(errors.some((line) => /injection failed/.test(line)), 'the failure must be logged');
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
  ];
  for (const name of names) {
    assert.match(name, fieldName, `${name} is not a valid field name`);
    assert.ok(CODE.includes(name), `${name} is not written by background.js`);
  }
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
