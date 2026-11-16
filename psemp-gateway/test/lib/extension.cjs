/*
 * Shared harness for the MailExtension tests.
 *
 * `background.js` is not read as text by the tests that matter — it is RUN inside a
 * vm with a stub `browser`, exactly as Thunderbird loads it, and then the registered
 * listener is driven. Keeping the loader here means the injection test and the
 * sent-mail checker cannot drift apart in how they stand the extension up.
 *
 * The reference Merkle implementation uses node:crypto on purpose: if the extension
 * and the harness are ever changed in the same wrong direction, `extension-arming`
 * fails instead of agreeing with itself.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..', '..');
const SOURCE = path.join(ROOT, 'thunderbird-extension', 'background.js');
const CODE = fs.readFileSync(SOURCE, 'utf8');

// Comments are prose here (the header note itself says "no require()"), so the
// purity checks look at code only.
const BARE_CODE = CODE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const HEX64 = /^[0-9a-f]{64}$/;
const MANIFEST_FILENAME = 'PasevSU_Manifest.json';

/**
 * The add-on version from manifest.json — what `X-PasevSU-Build` must report.
 * Read from the real file, not a literal: a stale copy would let the extension and
 * the assertion drift apart while both stayed green.
 */
function addonVersion() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'thunderbird-extension', 'manifest.json'), 'utf8')
  );
  return manifest.version;
}

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** The Merkle rule from the spec, implemented without Web Crypto. */
function referenceMerkle(hexLeaves) {
  let level = [...hexLeaves].sort();
  if (level.length === 0) return '';
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] === undefined ? left : level[i + 1];
      next.push(sha256Hex(Buffer.from(left + right, 'utf8')));
    }
    level = next;
  }
  return level[0];
}

/**
 * Load background.js into a fresh context.
 * @param {{stored?: object, attachments?: object, storageGetThrows?: boolean,
 *          addAttachmentThrows?: Error|null, listed?: Array<object>|null}} options
 */
function loadExtension({ stored = {}, attachments = {}, storageGetThrows = false, addAttachmentThrows = null, listed = null, noRuntime = false } = {}) {
  const order = [];
  const listeners = [];
  const writes = {};
  const warnings = [];
  const errors = [];
  const added = [];

  const browser = {
    // `runtime.getManifest()` is the only way an extension can name its own build.
    // The stub originally omitted it, which is why nothing ever reported one: the
    // code path was never exercised, so its absence looked like a design choice.
    // `noRuntime` reproduces that older environment, to prove a send still works.
    ...(noRuntime
      ? {}
      : {
          runtime: {
            getManifest() {
              order.push('runtime.getManifest');
              return { version: addonVersion() };
            },
          },
        }),
    storage: {
      local: {
        async get(defaults) {
          order.push('storage.get');
          if (storageGetThrows) throw new Error('storage unavailable');
          return Object.assign({}, defaults, stored);
        },
        async set(values) {
          // `order` keeps the historical first-key shape so existing assertions stay
          // meaningful, but every key is recorded: a single set() can carry several
          // (the send breadcrumb writes a counter and the record together).
          Object.assign(writes, values);
          order.push(`storage.set:${Object.keys(values)[0]}`);
        },
      },
    },
    compose: {
      async getAttachmentFile(id) {
        const entry = attachments[id];
        if (!entry) throw new Error(`no such attachment ${id}`);
        if (entry.throws) throw entry.throws;
        return new File([entry.bytes], entry.name);
      },
      // The only call that reports the files the message actually carries. The
      // `details` a listener receives is a getComposeDetails() snapshot, whose
      // attachments property is documented "Only used in the begin* functions".
      async listAttachments(_tabId) {
        order.push('listAttachments');
        return listed ? listed.slice() : [];
      },
      // The only path Thunderbird honours for a new attachment during a send.
      async addAttachment(tabId, attachment) {
        order.push('addAttachment');
        if (addAttachmentThrows) throw addAttachmentThrows;
        added.push({ tabId, attachment });
        return { id: `added-${added.length}`, name: attachment.file.name };
      },
      onBeforeSend: {
        addListener(fn) {
          order.push('addListener');
          listeners.push(fn);
        },
      },
    },
  };

  const context = vm.createContext({
    browser,
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    File,
    console: {
      warn: (...args) => warnings.push(args.join(' ')),
      error: (...args) => errors.push(args.join(' ')),
      log: () => {},
    },
  });

  vm.runInContext(CODE, context, { filename: SOURCE });

  return { order, listeners, writes, warnings, errors, added };
}

// Thunderbird >= 100 requires `{ name, value }` objects. Reading a string here
// would hide exactly the defect that aborted every send (0.69.x, Thunderbird 160).
function requireHeaderObject(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError(
      `customHeaders entry must be { name, value }, got ${typeof entry}: ${JSON.stringify(entry)}`
    );
  }
  if (typeof entry.name !== 'string' || typeof entry.value !== 'string') {
    throw new TypeError(`customHeaders entry needs string name and value: ${JSON.stringify(entry)}`);
  }
  return entry;
}

function headerMap(customHeaders) {
  const map = new Map();
  for (const entry of customHeaders) {
    const header = requireHeaderObject(entry);
    map.set(header.name.trim(), header.value.trim());
  }
  return map;
}

function headerNames(customHeaders) {
  // Array.from strips the vm realm's Array prototype, which deepStrictEqual rejects.
  return Array.from(customHeaders, (entry) => requireHeaderObject(entry).name.trim());
}

module.exports = {
  ROOT,
  SOURCE,
  CODE,
  BARE_CODE,
  HEX64,
  MANIFEST_FILENAME,
  sha256Hex,
  referenceMerkle,
  addonVersion,
  loadExtension,
  headerMap,
  headerNames,
};
