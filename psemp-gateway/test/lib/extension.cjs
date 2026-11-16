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
 *          addAttachmentThrows?: Error|null}} options
 */
function loadExtension({ stored = {}, attachments = {}, storageGetThrows = false, addAttachmentThrows = null } = {}) {
  const order = [];
  const listeners = [];
  const writes = {};
  const warnings = [];
  const errors = [];
  const added = [];

  const browser = {
    storage: {
      local: {
        async get(defaults) {
          order.push('storage.get');
          if (storageGetThrows) throw new Error('storage unavailable');
          return Object.assign({}, defaults, stored);
        },
        async set(values) {
          writes[Object.keys(values)[0]] = values[Object.keys(values)[0]];
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

function headerMap(customHeaders) {
  const map = new Map();
  for (const line of customHeaders) {
    const at = line.indexOf(':');
    map.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return map;
}

function headerNames(customHeaders) {
  // Array.from strips the vm realm's Array prototype, which deepStrictEqual rejects.
  return Array.from(customHeaders, (line) => line.slice(0, line.indexOf(':')).trim());
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
  loadExtension,
  headerMap,
  headerNames,
};
