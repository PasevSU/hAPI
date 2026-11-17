#!/usr/bin/env node
/*
 * `cli.js stamp-sent` — the OpenTimestamps bridge.
 *
 * A timestamp is a statement about bytes: "this existed at time T". Pointing one at
 * a message whose headers disagree with its manifest would publish a broken message
 * as if it were proven, which is worse than having no proof at all. So the command
 * verifies first and refuses to stamp a broken chain.
 *
 * The fixtures come from `test/check-sent.cjs` — the same builder that produces a
 * message from the real `background.js` — so this suite exercises the guard on the
 * only kind of message that can reach it in practice.
 *
 *   node psemp-gateway/test/stamp-sent.cjs
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { runExtension, buildMessage } = require('./check-sent.cjs');
const { sha256Hex } = require('./lib/extension.cjs');

const CLI = path.join(__dirname, '..', 'cli.js');

/**
 * `runExtension` already hands back a Map, but keyed with the header name's own
 * case (`X-PasevSU-Manifest-SHA256`), because that is what Thunderbird preserves.
 * RFC 5322 names are case-insensitive, so the lookup is too.
 */
function headerValue(map, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of map) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}


/** Run the CLI and return its exit code plus parsed JSON output. */
function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, 'stamp-sent', ...args], { encoding: 'utf8' });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = null;
  }
  return { code: result.status, json, stderr: result.stderr || '', stdout: result.stdout || '' };
}

/** A scratch directory that is removed even when the assertions fail. */
function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psemp-stamp-sent-'));
  return Promise.resolve(fn(dir)).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

/* --- checks --------------------------------------------------------------- */
const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

check('the newest message is found in a profile and its chain is stamped', async () =>
  withTemp(async (dir) => {
    const { headers, manifestBytes } = await runExtension();
    const message = buildMessage({ headers, manifestBytes });
    // A one-file "Sent" mbox, so the profile reader is exercised rather than bypassed.
    const profile = path.join(dir, 'profile');
    fs.mkdirSync(path.join(profile, 'Mail', 'Local Folders'), { recursive: true });
    const sent = path.join(profile, 'Mail', 'Local Folders', 'Sent');
    fs.writeFileSync(sent, `From - Mon Jan 01 00:00:00 2026\n${message}\n`);

    const out = path.join(dir, 'out');
    const { code, json, stderr } = runCli(['--profile', profile, '--out', out]);
    assert.ok(json, `the command must print JSON, got: ${stderr || 'nothing'}`);
    assert.strictEqual(json.status, undefined, 'a verified chain must not report a refusal');
    assert.strictEqual(code, 0, 'a verified chain must exit 0');

    assert.ok(json.manifest, 'a manifest must be written');
    const written = fs.readFileSync(json.manifest);
    // The point of copying the part bytes instead of re-serialising the parsed
    // object: the file the proof covers hashes to what the message claims.
    assert.strictEqual(
      sha256Hex(written),
      headerValue(headers, 'X-PasevSU-Manifest-SHA256'),
      'the written manifest must hash to X-PasevSU-Manifest-SHA256'
    );
    assert.ok(fs.existsSync(json.message), 'the raw message must be kept beside the proof');
    assert.strictEqual(json.evidenceId, json.evidenceId && json.evidenceId.trim());
    assert.ok(json.stamp && typeof json.stamp === 'object', 'the OTS adapter must report something');
    return `manifest ${json.manifestSha256.slice(0, 12)}… ots=${json.stamp.status}`;
  }));

check('a message with no evidence headers is refused, not stamped', async () =>
  withTemp(async (dir) => {
    const file = path.join(dir, 'plain.eml');
    fs.writeFileSync(file, 'From: a@example.test\nTo: b@example.test\nSubject: plain\n\nbody\n');
    const out = path.join(dir, 'out');

    const { code, json } = runCli(['--file', file, '--out', out]);
    assert.ok(json, 'a refusal must still be reported as JSON');
    assert.strictEqual(json.status, 'refused');
    assert.ok(Array.isArray(json.failures) && json.failures.length > 0, 'the refusal must say why');
    assert.strictEqual(json.stamped, null, 'a refused run must not report a proof');
    assert.notStrictEqual(code, 0, 'a refusal must exit non-zero');
    assert.strictEqual(fs.existsSync(out), false, 'a refused run must not create the output directory');
    return `${json.failures.length} failure(s), nothing written`;
  }));

check('an attachment altered after the manifest was built is refused', async () =>
  withTemp(async (dir) => {
    const pdf = { name: 'document.pdf', bytes: Buffer.from('the real attachment') };
    const { headers, manifestBytes } = await runExtension({ files: [pdf] });
    // Same name, different bytes: exactly what a swapped file looks like on the wire.
    const tampered = { name: 'document.pdf', bytes: Buffer.from('a different file') };
    const message = buildMessage({ headers, manifestBytes, attachmentParts: [tampered] });

    const file = path.join(dir, 'tampered.eml');
    fs.writeFileSync(file, message);
    const out = path.join(dir, 'out');

    const { code, json } = runCli(['--file', file, '--out', out]);
    assert.ok(json);
    assert.strictEqual(json.status, 'refused', 'a swapped attachment must be refused');
    assert.ok(
      json.failures.some((line) => line.includes('document.pdf')),
      `the refusal must name the file, got: ${json.failures.join(' | ')}`
    );
    assert.notStrictEqual(code, 0);
    assert.strictEqual(fs.existsSync(out), false);
    return 'tampered attachment named in the refusal';
  }));

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
