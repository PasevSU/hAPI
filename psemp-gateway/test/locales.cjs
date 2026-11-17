#!/usr/bin/env node
/*
 * PSEMP localisation.
 *
 * The third defect came from the field: "there is no delivery-receipt feature in
 * German". The feature existed — the German catalogue did not, so `__MSG_*__`
 * fell back to English and the receipt controls read like a foreign language.
 *
 * A key present in one catalogue and missing from another is exactly that defect,
 * so this test pins the three catalogues against each other, against the manifest
 * and against the options page:
 *
 *   thunderbird-extension/_locales/<lang>/messages.json  key sets, placeholders, markup
 *   thunderbird-extension/manifest.json                  name/description/default_locale
 *   thunderbird-extension/options.html                   which keys the page asks for
 *
 * Dead keys fail too: a key nothing references is a rename that left a stale
 * translation behind. And because Thunderbird silently falls back to the default
 * locale, "it works in English" is not evidence — the German receipt text is
 * asserted to be German.
 *
 *   node psemp-gateway/test/locales.cjs
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const EXT = path.join(ROOT, 'thunderbird-extension');
const LOCALES = path.join(EXT, '_locales');
const LANGUAGES = ['bg', 'de', 'en'];
const RECEIPT_KEYS = [
  'labelReceipt',
  'labelReceiptAddress',
  'receiptAddressHint',
  'receiptError',
  'receiptNote',
];

const checks = [];
async function check(name, fn) {
  checks.push({ name, detail: await fn() });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function catalogue(language) {
  return readJson(path.join(LOCALES, language, 'messages.json'));
}

/** `data-i18n="key"` and `data-i18n-html="key"` — the keys the page asks for statically. */
function pageKeys() {
  const html = fs.readFileSync(path.join(EXT, 'options.html'), 'utf8');
  const keys = new Set();
  for (const match of html.matchAll(/data-i18n(?:-html)?="([A-Za-z0-9_]+)"/g)) keys.add(match[1]);
  return keys;
}

/**
 * Keys composed at runtime — `t("armedOk", …)`, `t("saved")` — plus the `FALLBACK`
 * map that keeps the page readable when `browser.i18n` is unavailable. They live in
 * options.js because they carry values, so a static scan of the HTML cannot see them.
 */
function scriptKeys() {
  const source = fs.readFileSync(path.join(EXT, 'options.js'), 'utf8');
  const keys = new Set([...source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)].map((match) => match[1]));
  const fallback = /const FALLBACK = \{([\s\S]*?)\n\};/.exec(source);
  assert.ok(fallback, 'options.js has no FALLBACK block');
  for (const match of fallback[1].matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)) keys.add(match[1]);
  return keys;
}

/** `__MSG_name__` references inside the manifest. */
function manifestKeys() {
  const manifest = readJson(path.join(EXT, 'manifest.json'));
  const keys = new Set();
  const walk = (value) => {
    if (typeof value === 'string') {
      const match = /^__MSG_([A-Za-z0-9_]+)__$/.exec(value);
      if (match) keys.add(match[1]);
    } else if (value && typeof value === 'object') {
      for (const inner of Object.values(value)) walk(inner);
    }
  };
  walk(manifest);
  return keys;
}

/** Placeholder names referenced in a message body: `$time$`, `$count$`, … */
function placeholderRefs(message) {
  return new Set([...message.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map((match) => match[1]));
}

/** Unique HTML tag names in a message, so markup cannot silently disappear. */
function tags(message) {
  return [...new Set([...message.matchAll(/<\/?([a-z0-9]+)/g)].map((match) => match[1]))].sort();
}

async function main() {
  const english = catalogue('en');
  const englishKeys = Object.keys(english).sort();
  const used = new Set([...pageKeys(), ...scriptKeys(), ...manifestKeys()]);

  await check('locale-directories', () => {
    const found = fs
      .readdirSync(LOCALES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepStrictEqual(found, LANGUAGES, `expected ${LANGUAGES.join(', ')}`);
    for (const language of LANGUAGES) {
      assert.ok(
        fs.existsSync(path.join(LOCALES, language, 'messages.json')),
        `_locales/${language}/messages.json is missing`
      );
    }
    return `${found.length} catalogues`;
  });

  await check('default-locale-is-the-english-catalogue', () => {
    const manifest = readJson(path.join(EXT, 'manifest.json'));
    assert.strictEqual(manifest.default_locale, 'en', 'Thunderbird needs default_locale with __MSG_*__');
    assert.ok(LANGUAGES.includes(manifest.default_locale), 'default_locale names a real catalogue');
    return manifest.default_locale;
  });

  await check('manifest-name-and-description-are-localised', () => {
    const manifest = readJson(path.join(EXT, 'manifest.json'));
    assert.match(manifest.name || '', /^__MSG_[A-Za-z0-9_]+__$/, 'name must come from the catalogue');
    assert.match(
      manifest.description || '',
      /^__MSG_[A-Za-z0-9_]+__$/,
      'description must come from the catalogue'
    );
    const keys = manifestKeys();
    for (const language of LANGUAGES) {
      const data = catalogue(language);
      for (const key of keys) {
        assert.ok(data[key], `${language} is missing manifest key "${key}"`);
        assert.ok(data[key].message, `${language}.${key} is empty`);
      }
    }
    return [...keys].join(', ');
  });

  await check('key-sets-are-identical', () => {
    for (const language of LANGUAGES) {
      const keys = Object.keys(catalogue(language)).sort();
      assert.deepStrictEqual(keys, englishKeys, `${language} key set differs from en`);
    }
    return `${englishKeys.length} keys in ${LANGUAGES.length} catalogues`;
  });

  await check('every-key-is-translated-and-well-formed', () => {
    for (const language of LANGUAGES) {
      const data = catalogue(language);
      for (const key of englishKeys) {
        const entry = data[key];
        assert.strictEqual(typeof entry.message, 'string', `${language}.${key}.message must be a string`);
        assert.ok(entry.message.trim().length > 0, `${language}.${key} is blank`);
        const declared = Object.keys(entry.placeholders || {}).sort();
        const referenced = [...placeholderRefs(entry.message)].sort();
        assert.deepStrictEqual(
          referenced,
          declared,
          `${language}.${key} declares [${declared}] but uses [${referenced}]`
        );
        const englishDeclared = Object.keys(english[key].placeholders || {}).sort();
        assert.deepStrictEqual(
          declared,
          englishDeclared,
          `${language}.${key} must declare the same placeholders as en`
        );
      }
    }
    return `${englishKeys.length} keys × ${LANGUAGES.length}`;
  });

  await check('the-page-and-manifest-only-ask-for-known-keys', () => {
    const unknown = [...used].filter((key) => !english[key]);
    assert.deepStrictEqual(unknown, [], `referenced but not in _locales/en/messages.json: ${unknown}`);
    return `${used.size} references`;
  });

  await check('no-catalogue-key-is-dead', () => {
    const dead = englishKeys.filter((key) => !used.has(key));
    assert.deepStrictEqual(dead, [], `translated but never referenced: ${dead}`);
    return 'every key is reachable';
  });

  await check('markup-parity', () => {
    const markup = englishKeys.filter((key) => tags(english[key].message).length > 0);
    for (const language of LANGUAGES.slice(0, 2)) {
      const data = catalogue(language);
      for (const key of markup) {
        assert.deepStrictEqual(
          tags(data[key].message),
          tags(english[key].message),
          `${language}.${key} lost markup compared with en`
        );
      }
    }
    return `${markup.length} keys keep their tags`;
  });

  await check('german-carries-the-receipt-feature', () => {
    const german = catalogue('de');
    for (const key of RECEIPT_KEYS) {
      assert.ok(german[key], `de is missing "${key}"`);
      assert.notStrictEqual(
        german[key].message,
        english[key].message,
        `de.${key} is still the English text`
      );
    }
    assert.match(german.labelReceipt.message, /Lesebestätigung/, 'the German label names the receipt');
    assert.match(german.receiptNote.message, /Lesebestätigung/, 'the German note explains the receipt');
    assert.match(german.receiptAddressHint.message, /Identität/, 'the hint is German');
    return `de.${RECEIPT_KEYS.length} receipt strings`;
  });

  await check('bulgarian-carries-the-receipt-feature', () => {
    const bulgarian = catalogue('bg');
    for (const key of RECEIPT_KEYS) {
      assert.ok(bulgarian[key], `bg is missing "${key}"`);
      assert.notStrictEqual(bulgarian[key].message, english[key].message, `bg.${key} is still English`);
    }
    assert.match(bulgarian.labelReceipt.message, /разписк/i, 'the Bulgarian label names the receipt');
    assert.match(bulgarian.receiptNote.message, /разписк/i, 'the Bulgarian note explains it');
    return `bg.${RECEIPT_KEYS.length} receipt strings`;
  });

  await check('no-locale-leaves-the-english-page-behind', () => {
    // "Version" and "Framework" are the German nouns too; identical text there is a
    // correct translation, not a leftover. Anything longer than a word or two that
    // still matches English is a genuine miss, so the allowlist cannot hide one.
    const sharedWords = new Set(['labelVersion', 'labelFramework']);
    const untranslated = [];
    for (const language of LANGUAGES.slice(0, 2)) {
      const data = catalogue(language);
      for (const key of englishKeys.filter((name) => /^(label|section)/.test(name) || /Note$|Hint$/.test(name))) {
        if (sharedWords.has(key)) continue;
        if (data[key].message === english[key].message) untranslated.push(`${language}.${key}`);
      }
    }
    assert.deepStrictEqual(untranslated, [], `left in English: ${untranslated}`);
    for (const key of sharedWords) {
      assert.ok(english[key], `allowlisted key "${key}" does not exist`);
      assert.ok(
        english[key].message.split(' ').length <= 2,
        `"${key}" is a phrase, not a shared noun — translate it`
      );
    }
    return `labels, sections and notes translated (${sharedWords.size} shared nouns allowed)`;
  });

  console.log('locales:');
  for (const entry of checks) console.log(`  ok  ${entry.name} — ${entry.detail}`);
  console.log('locales: OK');
}

main().catch((error) => {
  console.error('locales: FAILED');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
