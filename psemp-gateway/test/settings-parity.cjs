#!/usr/bin/env node
/*
 * PSEMP shared-settings parity.
 *
 * The two halves of the framework must describe the same six settings or the user
 * ends up with a header claiming a framework the other half never wrote. The file
 * `psemp-gateway/settings.default.json` is the meeting point, so this test pins the
 * key set and the key ORDER across four places at once:
 *
 *   psemp-gateway/api.js                DEFAULTS (the gateway)
 *   psemp-gateway/settings.default.json (the shared file)
 *   thunderbird-extension/background.js DEFAULTS (what is actually written)
 *   thunderbird-extension/options.js    DEFAULTS (what the options page edits)
 *
 * Importing a settings file must copy the six keys but NOT `origin`: origin names
 * the producer, so the extension always writes `Thunderbird` and the gateway always
 * writes `PSEMP-Gateway`. That single divergence is asserted, not ignored.
 *
 *   node psemp-gateway/test/settings-parity.cjs
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../api.js');

const ROOT = path.join(__dirname, '..', '..');
const EXT = path.join(ROOT, 'thunderbird-extension');
const KEYS = ['version', 'framework', 'origin', 'organization', 'pgpFingerprint', 'enableOts'];

const checks = [];
async function check(name, fn) {
  checks.push({ name, detail: await fn() });
}

/** Pull the keys out of a `const DEFAULTS = { … };` block without executing it. */
function defaultsKeys(file) {
  const text = fs.readFileSync(file, 'utf8');
  const block = /const DEFAULTS = \{([\s\S]*?)\n\};/.exec(text);
  assert.ok(block, `${path.basename(file)} has no DEFAULTS block`);
  return block[1]
    .split('\n')
    .map((line) => /^\s{2}([A-Za-z0-9_]+):/.exec(line))
    .filter(Boolean)
    .map((match) => match[1]);
}

/**
 * Run the options page script against a stub DOM so the import path is exercised
 * as the browser would run it, not re-implemented here.
 */
function loadOptionsPage() {
  const handlers = new Map();
  const elements = new Map();
  const writes = [];
  const stored = {};

  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: '',
        checked: false,
        textContent: '',
        files: null,
        addEventListener: (type, handler) => {
          handlers.set(`${id}:${type}`, handler);
        },
        click: () => {},
      });
    }
    return elements.get(id);
  }

  const storage = {
    get: async (defaults) => Object.assign({}, defaults, stored),
    set: async (values) => {
      Object.assign(stored, values);
      writes.push(values);
    },
  };

  const sandbox = {
    console,
    browser: { storage: { local: storage } },
    document: {
      getElementById: element,
      addEventListener: (type, handler) => {
        handlers.set(`document:${type}`, handler);
      },
      createElement: () => ({ href: '', download: '', click: () => {} }),
    },
    window: { setTimeout: () => 0 },
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    Blob: class Blob {
      constructor(parts) {
        this.parts = parts;
      }
    },
    setTimeout,
  };

  const source = fs.readFileSync(path.join(EXT, 'options.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'options.js' });

  return { handlers, element, writes, stored };
}

async function settle(predicate, label) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function main() {
  await check('gateway-keys', () => {
    assert.deepStrictEqual(Object.keys(api.DEFAULTS), KEYS);
    return 'api.js DEFAULTS';
  });

  await check('settings-file-keys', () => {
    const file = JSON.parse(fs.readFileSync(api.SETTINGS_PATH, 'utf8'));
    assert.deepStrictEqual(Object.keys(file), KEYS, 'settings.default.json key set/order');
    assert.deepStrictEqual(api.loadSettings(), file, 'loadSettings must return the file verbatim');
    return 'settings.default.json';
  });

  await check('extension-background-keys', () => {
    assert.deepStrictEqual(defaultsKeys(path.join(EXT, 'background.js')), KEYS);
    return 'background.js DEFAULTS';
  });

  await check('extension-options-keys', () => {
    assert.deepStrictEqual(defaultsKeys(path.join(EXT, 'options.js')), KEYS);
    return 'options.js DEFAULTS';
  });

  await check('origin-is-the-only-divergence', () => {
    const file = JSON.parse(fs.readFileSync(api.SETTINGS_PATH, 'utf8'));
    const bg = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
    for (const key of KEYS.filter((name) => name !== 'origin')) {
      assert.deepStrictEqual(
        file[key],
        api.DEFAULTS[key],
        `${key} must agree between the gateway defaults and the shared file`,
      );
      assert.ok(bg.includes(`${key}:`), `background.js must declare ${key}`);
    }
    assert.strictEqual(api.DEFAULTS.origin, 'PSEMP-Gateway');
    assert.match(bg, /origin: "Thunderbird"/, 'the extension announces itself as Thunderbird');
    return 'gateway=PSEMP-Gateway, extension=Thunderbird';
  });

  const page = loadOptionsPage();
  page.handlers.get('document:DOMContentLoaded')();
  await settle(() => page.element('version').value !== '', 'the options page to load');

  await check('options-page-loads-stored-values', () => {
    assert.strictEqual(page.element('version').value, api.DEFAULTS.version);
    assert.strictEqual(page.element('enableOts').checked, api.DEFAULTS.enableOts);
    return 'form reflects storage';
  });

  await check('import-copies-the-six-keys-but-not-origin', async () => {
    const imported = {
      version: '2.5',
      framework: 'Forensic-Mail',
      origin: 'PSEMP-Gateway',
      organization: 'PasevSU',
      pgpFingerprint: 'a1b2 c3d4: e5f6',
      enableOts: false,
    };
    page.element('importFile').files = [{ text: async () => JSON.stringify(imported) }];
    page.handlers.get('importFile:change')({ target: page.element('importFile') });
    await settle(() => page.writes.length > 0, 'the import to write storage');

    const written = page.writes[page.writes.length - 1];
    assert.ok(!Object.prototype.hasOwnProperty.call(written, 'origin'), 'origin must never be imported');
    assert.strictEqual(written.version, '2.5');
    assert.strictEqual(written.pgpFingerprint, 'A1B2C3D4E5F6', 'the fingerprint is normalized on import');
    assert.strictEqual(written.enableOts, false);
    assert.strictEqual(page.element('version').value, '2.5', 'the form is refreshed after import');
    return 'origin stripped, fingerprint normalized';
  });

  await check('import-rejects-a-non-settings-file', async () => {
    const before = page.writes.length;
    page.element('status').textContent = '';
    page.element('importFile').files = [{ text: async () => '{not json' }];
    page.handlers.get('importFile:change')({ target: page.element('importFile') });
    await settle(() => page.element('status').textContent !== '', 'the error status');
    assert.match(page.element('status').textContent, /Not a settings file/);
    assert.strictEqual(page.writes.length, before, 'a broken file must not touch storage');
    return 'parse error reported, nothing written';
  });

  console.log('settings-parity:');
  for (const entry of checks) console.log(`  ok  ${entry.name} — ${entry.detail}`);
  console.log('settings-parity: OK');
}

main().catch((error) => {
  console.error('settings-parity: FAILED');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
