#!/usr/bin/env node
/*
 * PSEMP gateway OTS runtime test.
 *
 * The gateway must timestamp without an npm install. packages/07-ots ships
 * opentimestamps.min.js, but it is the BROWSER build: it probes `window` while
 * loading and publishes its API on `window.OpenTimestamps`, so the UMD
 * `module.exports` comes back empty. ots-manager.js now shims the browser globals
 * and reads the API back off `window`. Before that, runtime() only looked for the
 * npm package, otsStatus() always answered OTS_RUNTIME_MISSING, and every .ots
 * degraded to a bare "pending" marker.
 *
 * Only the SHA-256 sidecar check is fully offline. The stamp step contacts calendar
 * servers, so both outcomes are accepted: an attested (normally still pending) proof,
 * or the explicit "no usable attestation" error when nothing is reachable.
 *
 *   node psemp-gateway/test/ots-runtime.cjs
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const api = require('../api.js');

const OTS_DIR = path.join(__dirname, '..', 'packages', '07-ots');

async function main() {
  // 1. The gateway reports the runtime as available, from the vendored bundle.
  const status = api.otsStatus();
  assert.ok(
    status.available,
    `OTS runtime reported unavailable: ${status.reason} ${status.detail || ''}`
  );
  assert.strictEqual(status.reason, null);
  assert.ok(
    String(status.entry).endsWith('opentimestamps.min.js'),
    `OTS did not resolve to the vendored bundle: ${status.entry}`
  );
  assert.ok(fs.existsSync(status.entry), 'resolved OTS entry does not exist');

  const manager = await import(pathToFileURL(path.join(OTS_DIR, 'ots-manager.js')).href);

  // 2. ots-manager.js gets past its runtime gate. createTimestamp() calls runtime()
  //    before touching the filesystem, so a missing input proves the gate opened:
  //    the failure must be ENOENT from readFileSync, never a bundle/runtime error.
  const missing = path.join(os.tmpdir(), `psemp-ots-missing-${process.pid}.bin`);
  assert.ok(!fs.existsSync(missing), 'scratch path must not exist');
  await assert.rejects(
    () => manager.createTimestamp(missing),
    (error) => {
      assert.ok(
        !/OpenTimestamps runtime is missing/.test(error.message),
        `runtime gate is still closed: ${error.message}`
      );
      assert.ok(
        /ENOENT/.test(error.message),
        `expected ENOENT past the runtime gate, got: ${error.message}`
      );
      return true;
    }
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psemp-ots-'));
  try {
    // 3. The full stamp path runs with the vendored runtime: bytes are hashed,
    //    DetachedTimestampFile.fromBytes() and stamp() both run, and calendars are
    //    contacted. With no reachable calendar OTS cannot attest and
    //    createTimestamp() says so instead of writing an empty proof; with a
    //    reachable one it writes a real, normally still pending, proof. Either
    //    outcome is accepted — what must never appear is a runtime error.
    const file = path.join(tmpDir, 'evidence.txt');
    fs.writeFileSync(file, 'PSEMP evidence bytes', 'utf8');
    const expectedHash = api.sha256Hex(Buffer.from('PSEMP evidence bytes', 'utf8'));
    let stamped = null;
    try {
      stamped = await manager.createTimestamp(file);
    } catch (error) {
      assert.match(
        error.message,
        /No usable calendar attestation/,
        `stamp path failed for an unexpected reason: ${error.message}`
      );
      assert.ok(!fs.existsSync(`${file}.ots`), 'a proof was written without an attestation');
    }
    if (stamped) {
      assert.ok(
        stamped.status === 'pending' || stamped.status === 'complete',
        `unexpected proof status: ${stamped.status}`
      );
      assert.strictEqual(stamped.otsPath, `${file}.ots`);
      assert.ok(stamped.bytes > 0, 'a proof was written with no bytes');
      assert.ok(fs.existsSync(stamped.otsPath), 'the proof file is missing');
      assert.strictEqual(stamped.hash, expectedHash, 'the proof covers the wrong bytes');
    }

    // 4. The SHA-256 sidecar needs no OTS runtime and no network, and is idempotent.
    const sidecar = manager.createSha256File(file);
    assert.strictEqual(sidecar, `${file}.sha256`);
    assert.strictEqual(
      fs.readFileSync(sidecar, 'utf8'),
      `${api.sha256Hex(Buffer.from('PSEMP evidence bytes', 'utf8'))}  evidence.txt\n`
    );
    assert.strictEqual(manager.createSha256File(file), sidecar);

    // 5. A calendar that refuses must be NAMED. The bundle's browser HTTP layer
    //    cannot open a socket at all, so ots.stamp() used to reject with
    //    "Cannot read properties of undefined (reading 'protocol')" and
    //    allSettled swallowed it: every calendar looked like "no timestamp
    //    returned", the caller only saw the generic "No usable calendar
    //    attestation", and no proof was ever written. With the fetch path the
    //    status code and the calendar URL survive into the error. Offline and
    //    deterministic: the server is this process.
    const refusing = require('node:http').createServer((request, response) => {
      response.writeHead(503, { 'Content-Type': 'text/plain' });
      response.end('calendar unavailable');
    });
    await new Promise((resolve) => refusing.listen(0, '127.0.0.1', resolve));
    const { port } = refusing.address();
    const calendarUrl = `http://127.0.0.1:${port}`;
    const unreachable = path.join(tmpDir, 'no-calendar.txt');
    fs.writeFileSync(unreachable, 'PSEMP evidence bytes', 'utf8');
    try {
      await assert.rejects(
        () => manager.createTimestamp(unreachable, { calendars: [calendarUrl], m: 1 }),
        (error) => {
          assert.match(
            error.message,
            /No usable calendar attestation/,
            `unexpected failure shape: ${error.message}`
          );
          assert.match(
            error.message,
            /HTTP 503/,
            `the calendar status was lost: ${error.message}`
          );
          assert.ok(
            error.message.includes(calendarUrl),
            `the failing calendar was not named: ${error.message}`
          );
          return true;
        }
      );
      assert.ok(!fs.existsSync(`${unreachable}.ots`), 'a proof was written by a refusing calendar');
    } finally {
      await new Promise((resolve) => refusing.close(resolve));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('ots-runtime: OK');
  console.log('  vendored bundle  opentimestamps.min.js (browser build + window shim)');
  console.log('  otsStatus()      available');
  console.log('  runtime gate     open (fails at readFileSync, not at the runtime)');
  console.log('  stamp path       reached the attestation stage (real OTS, not a marker)');
  console.log('  sha256 sidecar   written and idempotent');
}

main().catch((error) => {
  console.error('ots-runtime: FAILED');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
