#!/usr/bin/env node
/*
 * PSEMP install verification.
 *
 * `tools/verify-install.cjs` is the only thing that looks at the Thunderbird
 * profile and says whether the installed copy will stamp a message. It compares
 * three lists that have to agree: what `background.js` pushes, what `api.js`
 * promises, and what `mail.compose.other.header` keeps.
 *
 * The risk with a checker like this is that it reports success from lists that
 * happen to match while something else is broken, so every failure it claims to
 * catch is provoked here with a throwaway profile:
 *
 *   - a name registered that nothing writes (a renamed header left behind);
 *   - a header written but never registered (the composer drops it silently);
 *   - an installed .xpi older than the source (the headers changed, the running
 *     code did not);
 *   - an .xpi that is current while the client still runs the previous build (the
 *     cache in extensions.json is only refreshed at start);
 *   - a profile with no user.js at all.
 *
 *   node psemp-gateway/test/verify-install.cjs
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { main, emittedNames, contractNames, prefList } = require('../tools/verify-install.cjs');

const ROOT = path.join(__dirname, '..', '..');
const ID = JSON.parse(fs.readFileSync(path.join(ROOT, 'thunderbird-extension', 'manifest.json'), 'utf8'))
  .browser_specific_settings.gecko.id;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * A stored (uncompressed) zip holding `entries`, so the fixture is a real archive
 * and the verifier's central-directory reader has something honest to walk.
 */
function zipBytes(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const crc = crc32(body);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(body.length, 24);
    header.writeUInt16LE(nameBuf.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, eocd]);
}

const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'thunderbird-extension', 'manifest.json'), 'utf8'));

/**
 * The archive the installer is supposed to produce, carrying the real source
 * bytes so the content-identity check has something honest to compare.
 *
 * `backslash` recreates the Windows-separator packing fault, `withLocales: false`
 * the missing default_locale tree, and `tamper` a file that is the right name and
 * a newer build time but the wrong content.
 */
function xpiEntries({ backslash = false, withLocales = true, tamper = null } = {}) {
  const names = ['manifest.json', 'background.js', 'options.html', 'options.js'];
  if (withLocales) names.push(`_locales/${MANIFEST.default_locale}/messages.json`);
  return names.map((name) => {
    const source = path.join(ROOT, 'thunderbird-extension', name.replace(/\//g, path.sep));
    const data = name === tamper ? Buffer.from('previous build\n', 'utf8') : fs.readFileSync(source);
    return { name: backslash ? name.replace(/\//g, '\\') : name, data };
  });
}

/**
 * Build a profile that should pass, then optionally break one thing.
 *
 * `registered` and `expanded` are the header lists the composer is told about;
 * `xpiAge` backdates the installed .xpi by that many milliseconds.
 *
 * `loadedVersion` is the version recorded in extensions.json - what the running
 * client believes it loaded. `null` leaves the file out entirely (a profile
 * Thunderbird never started), and `loadedRaw` writes it verbatim so a corrupt
 * cache can be provoked.
 */
function makeProfile({
  registered,
  expanded,
  xpiAge = 0,
  withUserJs = true,
  xpi = {},
  loadedVersion = MANIFEST.version,
  loadedRaw = null,
} = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'psemp-install-'));
  const names = emittedNames();
  const toCompose = registered === undefined ? names : registered;
  const toExpand = expanded === undefined ? names.map((name) => name.toLowerCase()) : expanded;
  const lines = [
    'user_pref("general.useragent.locale", "en-US");',
    `user_pref("mail.compose.other.header", "${toCompose.join(',')}");`,
    `user_pref("mailnews.headers.extraExpandedHeaders", "${toExpand.join(' ')}");`,
    'user_pref("xpinstall.signatures.required", false);',
    'user_pref("extensions.autoDisableScopes", 0);',
  ];
  if (withUserJs) fs.writeFileSync(path.join(profile, 'user.js'), `${lines.join('\n')}\n`);

  fs.mkdirSync(path.join(profile, 'extensions'), { recursive: true });
  const xpiPath = path.join(profile, 'extensions', `${ID}.xpi`);
  fs.writeFileSync(xpiPath, zipBytes(xpiEntries(xpi)));
  if (xpiAge > 0) {
    const when = new Date(Date.now() - xpiAge);
    fs.utimesSync(xpiPath, when, when);
  }
  if (loadedRaw !== null) {
    fs.writeFileSync(path.join(profile, 'extensions.json'), loadedRaw);
  } else if (loadedVersion !== null) {
    const cache = { addons: [{ id: ID, version: loadedVersion, active: true, userDisabled: false }] };
    fs.writeFileSync(path.join(profile, 'extensions.json'), `${JSON.stringify(cache, null, 2)}\n`);
  }
  return profile;
}

function run(profile) {
  const said = [];
  const code = main([profile], { log: (line) => said.push(line), error: (line) => said.push(line) });
  return { code, said, text: said.join('\n') };
}

const checks = [];

checks.push({
  name: 'the extension and the gateway name the same headers, in the same order',
  fn() {
    const emitted = emittedNames();
    assert.ok(emitted.length > 0, 'background.js was parsed but nothing was found');
    assert.deepStrictEqual(emitted, contractNames(), 'api.js HEADER_NAMES drifted from background.js');
    assert.strictEqual(new Set(emitted).size, emitted.length, 'a header name is emitted twice');
    return `${emitted.length} headers`;
  },
});

checks.push({
  name: 'a correctly wired profile passes',
  fn() {
    const profile = makeProfile();
    try {
      const { code, text } = run(profile);
      assert.strictEqual(code, 0, `expected a pass, got:\n${text}`);
      assert.match(text, /RESULT: ALL CHECKS OK/);
      assert.doesNotMatch(text, /FAIL/, 'a passing run still printed a FAIL row');
      return 'exit 0';
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  },
});

checks.push({
  name: 'a registered name that nothing writes is a failure',
  fn() {
    const profile = makeProfile({ registered: [...emittedNames(), 'X-PasevSU-Retired'] });
    try {
      const { code, text } = run(profile);
      assert.strictEqual(code, 1, `a stale name must fail, got exit ${code}:\n${text}`);
      assert.match(text, /FAIL no name is registered that nothing writes.*X-PasevSU-Retired/s);
      return 'exit 1';
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  },
});

checks.push({
  name: 'a header written but not registered is a failure',
  fn() {
    const names = emittedNames();
    const profile = makeProfile({ registered: names.slice(0, -1), expanded: names.slice(0, -1).map((n) => n.toLowerCase()) });
    try {
      const { code, text } = run(profile);
      assert.strictEqual(code, 1, `a dropped registration must fail, got exit ${code}:\n${text}`);
      assert.match(text, /FAIL every header the extension writes is registered/);
      assert.ok(text.includes(names[names.length - 1]), 'the missing name is not named in the report');
      return `caught ${names[names.length - 1]}`;
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  },
});

checks.push({
  name: 'an installed .xpi older than the source is a failure',
  fn() {
    const profile = makeProfile({ xpiAge: 24 * 60 * 60 * 1000 });
    try {
      const { code, text } = run(profile);
      assert.strictEqual(code, 1, `a stale build must fail, got exit ${code}:\n${text}`);
      assert.match(text, /FAIL the installed \.xpi is at least as new as background\.js/);
      assert.match(text, /rebuild with thunderbird-extension\/tools\/install\.ps1/);
      return 'exit 1';
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  },
});

checks.push({
  name: 'an .xpi whose entries use Windows separators is a failure',
  fn() {
    const profile = makeProfile({ xpi: { backslash: true } });
    try {
      const { code, text } = run(profile);
      assert.strictEqual(code, 1, `backslash entries must fail, got exit ${code}:\n${text}`);
      assert.match(text, /FAIL no archive entry uses a backslash/);
      return 'exit 1';
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  },
});

checks.push({
  name: 'an .xpi that leaves out the default_locale tree is a failure',
  fn() {
    const profile = makeProfile({ xpi: { withLocales: false } });
    try {
      const { code, text } = run(profile);
      assert.strictEqual(code, 1, `a missing _locales tree must fail, got exit ${code}:\n${text}`);
      assert.match(text, /FAIL the archive carries the default_locale tree/);
      return 'exit 1';
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  },
});

checks.push({
  name: 'an .xpi that carries a previous build is a failure even when it is newer',
  fn() {
    const profile = makeProfile({ xpi: { tamper: 'background.js' } });
    try {
      const { code, text } = run(profile);
      assert.strictEqual(code, 1, `a stale payload must fail, got exit ${code}:\n${text}`);
      assert.doesNotMatch(text, /FAIL the installed \.xpi is at least as new/, 'the timestamp check must still pass');
      assert.match(text, /FAIL the archive carries the current source, not a previous build\s+background\.js/);
      assert.match(text, /RESULT: 1 FAILED/, `only the payload check may fail:\n${text}`);
      return 'exit 1';
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  },
});

checks.push({
  name: 'a client still running a previous build is a failure',
  fn() {
    // The exact drift measured in the wild: a healthy .xpi on disk, a stale entry
    // in the cache, and a fixed defect that stays broken because the client only
    // re-reads an add-on at start.
    const profile = makeProfile({ loadedVersion: '0.0.1' });
    try {
      const { code, text } = run(profile);
      assert.strictEqual(code, 1, `a stale loaded version must fail, got exit ${code}:\n${text}`);
      assert.match(text, new RegExp(`FAIL the running client has loaded ${MANIFEST.version.replace(/\./g, '\\.')}`));
      assert.match(text, /loaded 0\.0\.1, on disk/);
      assert.match(text, /quit and reopen Thunderbird/);
      assert.match(text, /RESULT: 1 FAILED/, `only the version check may fail:\n${text}`);
      return 'exit 1';
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  },
});

checks.push({
  name: 'a profile Thunderbird never started is not judged on its cache',
  fn() {
    const profile = makeProfile({ loadedVersion: null });
    try {
      const { code, text } = run(profile);
      assert.strictEqual(code, 0, `a missing extensions.json must not be a verdict, got exit ${code}:\n${text}`);
      assert.match(text, /SKIP the running client has loaded/);
      assert.match(text, /Thunderbird has not started with this profile/);
      return 'exit 0, skipped';
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  },
});

checks.push({
  name: 'a corrupt extensions.json is skipped, not a crash',
  fn() {
    const profile = makeProfile({ loadedRaw: '{ not json' });
    try {
      const { code, text } = run(profile);
      assert.strictEqual(code, 0, `an unreadable cache must not fail the run, got exit ${code}:\n${text}`);
      assert.match(text, /SKIP the running client has loaded/);
      assert.match(text, /extensions\.json is not valid JSON/);
      return 'exit 0, skipped';
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  },
});

checks.push({
  name: 'each run reports only its own findings, not the previous run',
  fn() {
    const broken = makeProfile({ xpi: { backslash: true } });
    const good = makeProfile();
    try {
      assert.strictEqual(run(broken).code, 1, 'the broken profile must fail');
      const { code, text } = run(good);
      assert.strictEqual(code, 0, `a good profile after a bad one must pass, got:\n${text}`);
      assert.doesNotMatch(text, /FAIL/, 'findings leaked between runs');
      return 'no leakage';
    } finally {
      fs.rmSync(broken, { recursive: true, force: true });
      fs.rmSync(good, { recursive: true, force: true });
    }
  },
});

checks.push({
  name: 'a profile with no user.js is refused rather than judged',
  fn() {
    const profile = makeProfile({ withUserJs: false });
    try {
      const { code, text } = run(profile);
      assert.strictEqual(code, 2, `a missing user.js must not be a verdict, got exit ${code}:\n${text}`);
      assert.match(text, /never installed/);
      return 'exit 2';
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  },
});

checks.push({
  name: 'a directory that is not a profile is refused',
  fn() {
    const { code } = run(path.join(os.tmpdir(), 'psemp-not-a-profile'));
    assert.strictEqual(code, 2, `expected exit 2, got ${code}`);
    return 'exit 2';
  },
});

checks.push({
  name: 'both pref list styles are parsed, commas and whitespace',
  fn() {
    const source = [
      'user_pref("mail.compose.other.header", "A,B, C");',
      'user_pref("mailnews.headers.extraExpandedHeaders", "a b  c");',
    ].join('\n');
    assert.deepStrictEqual(prefList(source, 'mail\\.compose\\.other\\.header'), ['A', 'B', 'C']);
    assert.deepStrictEqual(prefList(source, 'mailnews\\.headers\\.extraExpandedHeaders'), ['a', 'b', 'c']);
    assert.deepStrictEqual(prefList(source, 'not\\.there'), [], 'a missing pref must be an empty list, not a crash');
    return 'comma + whitespace';
  },
});

/* --- runner --------------------------------------------------------------- */
(async () => {
  let failed = 0;
  console.log(path.basename(__filename));
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
  if (failed > 0) process.exitCode = 1;
})();
