import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  createSha256File,
  createTimestamp,
  inspectTimestamp,
  scanPendingOts,
  upgradeTimestamp,
  verifyTimestamp
} from './ots-manager.js';

const require = createRequire(import.meta.url);

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pasevsu-ots-test-'));
}

test('inspects a real OpenTimestamps proof without network access', () => {
  const runtimeRoot = path.dirname(require.resolve('opentimestamps/package.json'));
  const proof = path.join(runtimeRoot, 'examples', 'hello-world.txt.ots');
  const result = inspectTimestamp(proof);

  assert.match(result.fileHash, /^[a-f0-9]{64}$/);
  assert.equal(result.complete, true);
  assert.match(result.info, /BitcoinBlockHeaderAttestation/);
});

test('rejects a mismatched original before making any calendar request', async () => {
  const runtimeRoot = path.dirname(require.resolve('opentimestamps/package.json'));
  const proof = path.join(runtimeRoot, 'examples', 'hello-world.txt.ots');
  const directory = temporaryDirectory();
  const wrongFile = path.join(directory, 'wrong.txt');
  fs.writeFileSync(wrongFile, 'not the timestamped contents');

  try {
    await assert.rejects(
      verifyTimestamp(proof, { file: wrongFile }),
      /does not match original/i
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('verifies a real proof against an Esplora-compatible block response', async () => {
  const ots = require('opentimestamps');
  const runtimeRoot = path.dirname(require.resolve('opentimestamps/package.json'));
  const proof = path.join(runtimeRoot, 'examples', 'hello-world.txt.ots');
  const original = path.join(runtimeRoot, 'examples', 'hello-world.txt');
  const detached = ots.DetachedTimestampFile.deserialize(fs.readFileSync(proof));
  const attestations = [...detached.timestamp.allAttestations()]
    .filter(([, attestation]) => attestation instanceof ots.Notary.BitcoinBlockHeaderAttestation);
  assert.ok(attestations.length > 0, 'fixture must include a Bitcoin block attestation');

  const blocks = new Map();
  for (const [message, attestation] of attestations) {
    blocks.set(attestation.height, {
      hash: `test-block-${attestation.height}`,
      merkle_root: Buffer.from(message).reverse().toString('hex'),
      timestamp: 1430000000
    });
  }
  const server = createServer((request, response) => {
    const match = request.url.match(/^\/block-height\/(\d+)$/);
    if (match) {
      const block = blocks.get(Number(match[1]));
      response.writeHead(block ? 200 : 404);
      response.end(block?.hash || 'not found');
      return;
    }
    const block = [...blocks.values()].find(candidate => request.url === `/block/${candidate.hash}`);
    response.writeHead(block ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(block || { error: 'not found' }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const explorerUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const result = await verifyTimestamp(proof, {
      file: original,
      ignoreBitcoinNode: true,
      esplora: { url: explorerUrl, timeout: 2000 }
    });
    assert.equal(result.verified, true);
    assert.equal(result.attestations.bitcoin.height, attestations[0][1].height);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('refuses to replace an existing proof when creating a timestamp', async () => {
  const directory = temporaryDirectory();
  const input = path.join(directory, 'evidence.txt');
  fs.writeFileSync(input, 'evidence');
  fs.writeFileSync(`${input}.ots`, 'existing proof');

  try {
    await assert.rejects(createTimestamp(input), /already exists/);
    assert.equal(fs.readFileSync(`${input}.ots`, 'utf8'), 'existing proof');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('does not save a proof when every calendar rejects the timestamp request', async () => {
  const directory = temporaryDirectory();
  const input = path.join(directory, 'evidence.txt');
  fs.writeFileSync(input, 'non-sensitive calendar integration test');
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    response.writeHead(503);
    response.end('calendar unavailable');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const calendar = `http://127.0.0.1:${address.port}`;

  try {
    await assert.rejects(
      createTimestamp(input, { calendars: [calendar], whitelist: [calendar] }),
      /No usable calendar attestation/
    );
    assert.equal(requests, 1);
    assert.equal(fs.existsSync(`${input}.ots`), false);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('creates and serializes a real OTS proof from a local calendar response', async () => {
  const ots = require('opentimestamps');
  const directory = temporaryDirectory();
  const input = path.join(directory, 'evidence.txt');
  fs.writeFileSync(input, 'local calendar integration test');
  let allowUpgrade = false;
  let calendar;
  const server = createServer((request, response) => {
    const respondWithAttestation = digest => {
      const timestamp = new ots.Timestamp(digest);
      timestamp.attestations.push(allowUpgrade
        ? new ots.Notary.BitcoinBlockHeaderAttestation(800000)
        : new ots.Notary.PendingAttestation(calendar));
      const context = new ots.Context.StreamSerialization();
      timestamp.serialize(context);
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(Buffer.from(context.getOutput()));
    };
    if (request.method === 'GET') {
      const commitment = request.url.split('/').at(-1);
      respondWithAttestation([...Buffer.from(commitment, 'hex')]);
      return;
    }
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => respondWithAttestation([...Buffer.concat(chunks)]));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  calendar = `http://127.0.0.1:${server.address().port}`;

  try {
    const created = await createTimestamp(input, { calendars: [calendar], m: 1 });
    assert.equal(created.otsPath, `${input}.ots`);
    assert.equal(created.status, 'pending');
    assert.equal(inspectTimestamp(created.otsPath).attestationCount, 1);
    const originalProof = fs.readFileSync(created.otsPath);
    allowUpgrade = true;
    const upgraded = await upgradeTimestamp(created.otsPath, { calendars: [calendar] });
    assert.equal(upgraded.status, 'complete', JSON.stringify(upgraded));
    assert.equal(upgraded.verified, false);
    assert.deepEqual(upgraded.blockHeights, [800000]);
    assert.ok(upgraded.backupPath);
    assert.deepEqual(fs.readFileSync(upgraded.backupPath), originalProof);
    assert.notDeepEqual(fs.readFileSync(created.otsPath), originalProof);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('creates an idempotent SHA-256 sidecar and detects conflicting sidecars', () => {
  const directory = temporaryDirectory();
  const input = path.join(directory, 'evidence.txt');
  fs.writeFileSync(input, 'evidence');

  try {
    const sidecar = createSha256File(input);
    assert.match(fs.readFileSync(sidecar, 'utf8'), new RegExp(`^${crypto.createHash('sha256').update('evidence').digest('hex')}  evidence\\.txt\\n$`));
    assert.equal(createSha256File(input), sidecar);
    fs.writeFileSync(sidecar, 'incorrect\n');
    assert.throws(() => createSha256File(input), /different content/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('scans only direct .ots files and reports missing originals', async () => {
  const directory = temporaryDirectory();
  fs.writeFileSync(path.join(directory, 'one.ots'), 'proof');
  fs.writeFileSync(path.join(directory, 'ignored.txt'), 'text');
  fs.mkdirSync(path.join(directory, 'nested'));
  fs.writeFileSync(path.join(directory, 'nested', 'two.ots'), 'proof');

  try {
    assert.deepEqual(scanPendingOts(directory), [path.join(directory, 'one.ots')]);
    assert.deepEqual(await verifyTimestamp(path.join(directory, 'missing.ots')), {
      verified: false,
      error: 'FILE_NOT_FOUND',
      path: path.join(directory, 'missing.ots')
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects malformed proof files instead of reporting a false verification', async () => {
  const directory = temporaryDirectory();
  const proof = path.join(directory, 'broken.ots');
  fs.writeFileSync(proof, 'not an OpenTimestamps proof');

  try {
    await assert.rejects(upgradeTimestamp(proof), /Invalid OpenTimestamps proof/);
    assert.throws(() => inspectTimestamp(proof), /Invalid OpenTimestamps proof/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
