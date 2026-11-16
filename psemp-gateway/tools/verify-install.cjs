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
const NAME = /X-PasevSU-[A-Za-z0-9-]+/g;

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

/** The names background.js pushes, in the order it pushes them. */
function emittedNames() {
  const seen = [];
  for (const line of read(path.join(EXTENSION, 'background.js')).split('\n')) {
    if (!/headers\.push\(/.test(line)) continue;
    for (const name of line.match(NAME) || []) if (!seen.includes(name)) seen.push(name);
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
