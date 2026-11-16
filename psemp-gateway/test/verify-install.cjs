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

const quiet = { log() {}, error() {} };

/**
 * Build a profile that should pass, then optionally break one thing.
 *
 * `registered` and `expanded` are the header lists the composer is told about;
 * `xpiAge` backdates the installed .xpi by that many milliseconds.
 */
function makeProfile({ registered, expanded, xpiAge = 0, withUserJs = true } = {}) {
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
  const xpi = path.join(profile, 'extensions', `${ID}.xpi`);
  fs.writeFileSync(xpi, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (xpiAge > 0) {
    const when = new Date(Date.now() - xpiAge);
    fs.utimesSync(xpi, when, when);
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
