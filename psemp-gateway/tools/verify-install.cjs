#!/usr/bin/env node
/**
 * Check that a Thunderbird profile is really wired up for PSEMP headers.
 *
 * An add-on can be installed and still never stamp a message: the profile can
 * register the add-on disabled, `mail.compose.other.header` can be missing, the
 * composer can be told about a superset or a subset of the names the code
 * writes, or the installed .xpi can still be the previous build. None of that
 * shows up until someone reads a sent message and finds no headers.
 *
 * This compares three lists that must agree, in order:
 *
 *   background.js  the names the extension actually pushes, in push order
 *   api.js         HEADER_NAMES, the contract the gateway verifies
 *   <profile>      mail.compose.other.header, what the composer will keep
 *
 * Usage:
 *   node psemp-gateway/tools/verify-install.cjs
 *   node psemp-gateway/tools/verify-install.cjs <thunderbird-profile-dir>
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { defaultProfile } = require('./check-sent.cjs');

const ROOT = path.join(__dirname, '..', '..');
const EXTENSION = path.join(ROOT, 'thunderbird-extension');
const GATEWAY = path.join(ROOT, 'psemp-gateway');

const checks = [];
let failed = 0;
let skipped = 0;

function ok(label, condition, detail) {
  checks.push({ ok: Boolean(condition), label, detail });
  if (!condition) failed += 1;
}

function skip(label, why) {
  checks.push({ skipped: true, label, detail: why });
  skipped += 1;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

/**
 * File names stored in a zip, read from its central directory.
 *
 * Returns null when the archive cannot be walked, so a corrupt pack fails loudly
 * instead of passing as "no backslashed entries found".
 */
function zipEntryNames(zip) {
  const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocdAt = zip.lastIndexOf(EOCD);
  if (eocdAt < 0) return null;
  const count = zip.readUInt16LE(eocdAt + 10);
  let at = zip.readUInt32LE(eocdAt + 16);
  const names = [];
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) return null;
    const nameLength = zip.readUInt16LE(at + 28);
    names.push(zip.slice(at + 46, at + 46 + nameLength).toString('utf8'));
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return names;
}

/** Files the running extension needs; all of them must be inside the archive. */
const requiredEntries = ['manifest.json', 'background.js', 'options.html', 'options.js'];

/**
 * The names background.js emits, in the order it emits them.
 *
 * Headers must be built through buildHeader(name, value): Thunderbird >= 100
 * types customHeaders as `{ name, value }` objects, and a "Name: value" string
 * aborts the send. Reading buildHeader() calls therefore also proves the shape.
 */
function emittedNames() {
  const source = read(path.join(EXTENSION, 'background.js'));
  const seen = [];
  for (const match of source.matchAll(
    /buildHeader\(\s*['"](X-PasevSU-[A-Za-z0-9-]+)['"]/g
  )) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

/** HEADER_NAMES from api.js, in declaration order. */
function contractNames() {
  const source = read(path.join(GATEWAY, 'api.js'));
  const start = source.indexOf('const HEADER_NAMES');
  const block = source.slice(start, source.indexOf('});', start));
  return [...block.matchAll(/'(X-PasevSU-[A-Za-z0-9-]+)'/g)].map((match) => match[1]);
}

/** A pref list from user.js, split on the commas or whitespace it uses. */
function prefList(userJs, key) {
  const match = userJs.match(new RegExp(`user_pref\\("${key}",\\s*"([^"]*)"\\)`));
  return match ? match[1].split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean) : [];
}

function prefKeys(userJs) {
  return [...userJs.matchAll(/^\s*user_pref\("([^"]+)"/gm)].map((match) => match[1]);
}

function main(argv, { log = console.log, error = console.error } = {}) {
  const profile = argv[0] || defaultProfile();
  if (!profile || !fs.existsSync(profile)) {
    error('No Thunderbird profile found. Pass one: verify-install.cjs <profile-dir>');
    return 2;
  }
  const userJsPath = path.join(profile, 'user.js');
  if (!fs.existsSync(userJsPath)) {
    error(`${userJsPath} does not exist - the side-load prefs were never installed.`);
    return 2;
  }

  const manifest = JSON.parse(read(path.join(EXTENSION, 'manifest.json')));
  const id = manifest.browser_specific_settings.gecko.id;
  const userJs = read(userJsPath);
  const emitted = emittedNames();
  const contract = contractNames();
  const registered = prefList(userJs, 'mail\\.compose\\.other\\.header');
  const expanded = prefList(userJs, 'mailnews\\.headers\\.extraExpandedHeaders').map((name) => name.toLowerCase());
  const expected = contract.length;

  log(`profile : ${profile}`);
  log(`add-on  : ${id} ${manifest.version}`);
  log(`emitted : ${emitted.length}  ${emitted.join(' | ')}`);
  log(`contract: ${contract.length}  ${contract.join(' | ')}`);
  log(`profile : ${registered.length}  ${registered.join(' | ')}`);
  log('');

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  ok(`background.js pushes ${expected} distinct names`, emitted.length === expected, String(emitted.length));
  ok(`api.js declares ${expected} names`, contract.length === expected, String(contract.length));
  ok(`user.js registers ${expected} names`, registered.length === expected, String(registered.length));
  ok('background.js order matches api.js order', same(emitted, contract));
  ok('background.js order matches user.js order', same(emitted, registered));

  const unregistered = emitted.filter((name) => !registered.includes(name));
  ok('every header the extension writes is registered', unregistered.length === 0, unregistered.join(',') || 'none');
  const stale = registered.filter((name) => !emitted.includes(name));
  ok('no name is registered that nothing writes', stale.length === 0, stale.join(',') || 'none');
  ok(
    'extraExpandedHeaders covers every header',
    emitted.every((name) => expanded.includes(name.toLowerCase())),
    `${expanded.length} entries`,
  );

  ok('mail.compose.other.header is set', registered.length > 0);
  ok('xpinstall.signatures.required = false', /user_pref\("xpinstall\.signatures\.required",\s*false\)/.test(userJs));
  ok(
    'extensions.autoDisableScopes = 0, so a side-loaded add-on is not disabled',
    /user_pref\("extensions\.autoDisableScopes",\s*0\)/.test(userJs),
  );

  const bytes = fs.readFileSync(userJsPath);
  let crlf = 0;
  for (let i = 0; i < bytes.length - 1; i += 1) if (bytes[i] === 13 && bytes[i + 1] === 10) crlf += 1;
  ok('user.js is LF only', crlf === 0, `crlf=${crlf}`);
  ok('user.js has no BOM', !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf));
  const lastByte = [...bytes].reverse().find((byte) => byte !== 0x20 && byte !== 0x0a && byte !== 0x0d && byte !== 0x09);
  ok("user.js ends with ';'", lastByte === 0x3b);

  // The backup proves the prefs were appended rather than replacing the file.
  const backups = fs
    .readdirSync(profile)
    .filter((name) => /^user\.js\.backup-/.test(name))
    .sort();
  if (!backups.length) {
    skip('original prefs preserved', 'no user.js.backup-* to compare against');
    skip('no duplicate user_pref keys', 'no user.js.backup-* to compare against');
  } else {
    const before = prefKeys(read(path.join(profile, backups[backups.length - 1])));
    const after = prefKeys(userJs);
    const lost = before.filter((key) => !after.includes(key));
    const dups = after.filter((key, index) => after.indexOf(key) !== index);
    ok(`all ${before.length} original prefs preserved`, lost.length === 0, lost.join(',') || 'none');
    ok('no duplicate user_pref keys', dups.length === 0, dups.join(',') || 'none');
    const added = after.filter((key) => !before.includes(key));
    log(`prefs added: ${added.length}  ${added.join(', ') || 'none'}`);
  }

  const xpi = path.join(profile, 'extensions', `${id}.xpi`);
  ok('the add-on is installed in the profile', fs.existsSync(xpi));
  if (fs.existsSync(xpi)) {
    const zip = fs.readFileSync(xpi);
    ok('the installed .xpi is a zip', zip[0] === 0x50 && zip[1] === 0x4b, `${zip.length} bytes`);
    // A stale build is the failure this tool exists to catch: the headers change
    // but the installed copy still runs the previous code.
    ok(
      `the installed .xpi is at least as new as background.js (${manifest.version})`,
      fs.statSync(xpi).mtimeMs >= fs.statSync(path.join(EXTENSION, 'background.js')).mtimeMs,
      'rebuild with thunderbird-extension/tools/install.ps1 if this fails',
    );

    // Thunderbird deletes a side-loaded .xpi it cannot parse, leaving no trace in
    // extensions.json - the add-on just vanishes on the next start. Two packing
    // faults caused exactly that: nested entries written with Windows separators
    // ("_locales\en\messages.json"), and a manifest that declares default_locale
    // while the _locales tree is left out of the archive.
    const entries = zipEntryNames(zip);
    ok('the installed .xpi has a readable file list', entries !== null);
    if (entries) {
      const backslashed = entries.filter((name) => name.includes('\\'));
      ok('no archive entry uses a backslash', backslashed.length === 0, backslashed.join(', ') || 'none');
      const missing = requiredEntries.filter((name) => !entries.includes(name));
      ok(
        `the archive carries every required file (${requiredEntries.length})`,
        missing.length === 0,
        missing.join(', ') || 'none',
      );
      if (manifest.default_locale) {
        ok(
          `the archive carries the default_locale tree (${manifest.default_locale})`,
          entries.includes(`_locales/${manifest.default_locale}/messages.json`),
          'Thunderbird deletes the add-on when __MSG_*__ cannot resolve',
        );
      }
    }
  }

  log('');
  for (const check of checks) {
    const mark = check.skipped ? 'SKIP' : check.ok ? 'OK  ' : 'FAIL';
    log(`${mark} ${check.label}${check.detail ? `  ${check.detail}` : ''}`);
  }

  log('');
  if (failed > 0) {
    log(`RESULT: ${failed} FAILED${skipped ? `, ${skipped} skipped` : ''}`);
    return 1;
  }
  log(`RESULT: ALL CHECKS OK${skipped ? ` (${skipped} skipped - not verified)` : ''}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main, emittedNames, contractNames, prefList };
