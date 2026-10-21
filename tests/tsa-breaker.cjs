'use strict';
// Сценарий: предпазител (circuit breaker) за RFC 3161 TSA.
//
// Мъртъв TSA не бива да изяжда всяка заявка: след N последователни неуспеха адресът
// се прескача за cooldown периода, а резервираният (втори) TSA продължава да работи.
// Проверява се и през API: 502 при реални откази → 503 „cooldown“, когато всички
// адреси са отворени, плюс видимо състояние в GET /admin/api/v2/rfc3161.
const { stopChild } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// ── Минимален DER writer за фалшив TSA (само за теста) ──────────────────────
const derLength = (n) => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let value = n;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const int = (value) => {
  const bytes = [];
  let rest = value;
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  return tlv(0x02, Buffer.from(bytes.length ? bytes : [0]));
};
const octet = (buffer) => tlv(0x04, Buffer.from(buffer));
const bool = (value) => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
const oid = (dotted) => {
  const parts = dotted.split('.').map(Number);
  const out = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const stack = [];
    let rest = part;
    do {
      stack.unshift(rest & 0x7f);
      rest = Math.floor(rest / 128);
    } while (rest > 0);
    stack.forEach((byte, index) => out.push(index < stack.length - 1 ? byte | 0x80 : byte));
  }
  return tlv(0x06, Buffer.from(out));
};
const findDigest = (buffer) => {
  for (let i = 0; i < buffer.length - 2; i++) {
    if (buffer[i] === 0x04 && buffer[i + 1] === 0x20) return buffer.subarray(i + 2, i + 34).toString('hex');
  }
  throw Error('messageImprint digest not found in TSQ');
};
const grantedReply = (digestHex) => {
  const imprint = seq(seq(oid('2.16.840.1.101.3.4.2.1'), tlv(0x05, Buffer.alloc(0))), octet(Buffer.from(digestHex, 'hex')));
  const tstInfo = seq(
    int(1),
    oid('1.3.6.1.4.1.13762.3'),
    imprint,
    int(20261021),
    tlv(0x18, Buffer.from('20261021123000Z', 'ascii')),
    seq(bool(true)),
  );
  const token = seq(oid('1.2.840.113549.1.7.2'), tlv(0xa0, seq(int(3), seq(oid('1.2.840.113549.1.7.1'), tlv(0xa0, octet(tstInfo))))));
  return seq(seq(int(0)), token);
};

// Порт, на който никой не слуша (веднага ECONNREFUSED — бърз и детерминиран отказ).
const DEAD = 'http://127.0.0.1:9/';
const DIGEST = 'cd'.repeat(32);

(async () => {
  process.env.TSA_BREAKER_THRESHOLD = '2';
  process.env.TSA_BREAKER_COOLDOWN_MS = '60000';
  const tsa = require('../hapi_enterprise/tsa-client');
  tsa.resetBreaker();

  // ── 1. Прагът се брои, след което адресът се прескача ────────────────────
  for (let i = 1; i <= 2; i++) {
    await assert.rejects(
      () => tsa.stamp({ url: DEAD, digestHex: DIGEST, timeoutMs: 2000 }),
      (e) => e.code !== 'TSA_CIRCUIT_OPEN',
      `опит ${i} трябва да е истински отказ, не cooldown`,
    );
  }
  const open = tsa.breakerSnapshot();
  const deadEntry = open.find((entry) => entry.url === DEAD);
  assert.ok(deadEntry, `няма запис за ${DEAD}: ${JSON.stringify(open)}`);
  assert.equal(deadEntry.open, true, 'след два неуспеха предпазителят е отворен');
  assert.ok(deadEntry.retryAt, 'има време за повторен опит');

  const skipped = await tsa
    .stamp({ url: DEAD, digestHex: DIGEST, timeoutMs: 2000 })
    .then(() => null)
    .catch((e) => e);
  assert.ok(skipped, 'третият опит също е отказ');
  assert.equal(skipped.code, 'TSA_CIRCUIT_OPEN', `код: ${skipped.code}`);
  assert.equal(skipped.status, 503);
  assert.equal(skipped.attempts[0].skipped, true, 'адресът е прескочен, не извикан');

  // ── 2. Ръчно нулиране връща истинските опити ─────────────────────────────
  tsa.resetBreaker(DEAD);
  const again = await tsa
    .stamp({ url: DEAD, digestHex: DIGEST, timeoutMs: 2000 })
    .then(() => null)
    .catch((e) => e);
  assert.ok(again);
  assert.equal(again.code, undefined, 'след нулиране пак има реален опит');
  assert.equal(again.attempts[0].skipped, undefined);

  // ── 3. Резервираност: мъртвият се прескача, живият TSA печели ────────────
  const fake = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      res.setHeader('content-type', 'application/timestamp-reply');
      res.end(grantedReply(findDigest(Buffer.concat(chunks))));
    });
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const liveUrl = `http://127.0.0.1:${fake.address().port}/`;
  try {
    tsa.resetBreaker();
    process.env.TSA_BREAKER_THRESHOLD = '1';
    const first = await tsa.stamp({ url: `${DEAD},${liveUrl}`, digestHex: DIGEST, timeoutMs: 2000 });
    assert.equal(first.url, liveUrl, 'живият TSA печели');
    assert.equal(first.granted, true);
    assert.equal(first.attempts[0].ok, false, 'мъртвият остава в attempts');
    const second = await tsa.stamp({ url: `${DEAD},${liveUrl}`, digestHex: DIGEST, timeoutMs: 2000 });
    assert.equal(second.url, liveUrl);
    assert.equal(second.attempts[0].skipped, true, 'при втория опит мъртвият вече е в cooldown');
    assert.equal(second.attempts[1].ok, true);
  } finally {
    await new Promise((resolve) => fake.close(resolve));
  }

  // ── 4. През API: 502 → 503 и видимо състояние ────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-breaker-'));
  const port = 36200 + Math.floor(Math.random() * 500);
  const token = 'tsa-breaker-admin-token-0123456789';
  const base = `http://127.0.0.1:${port}`;
  const call = async (route, { method = 'GET', body } = {}) => {
    const res = await fetch(base + route, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let value = null;
    try {
      value = await res.json();
    } catch {
      value = null;
    }
    return { status: res.status, value };
  };
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      OPTIONS_PATH: path.join(dir, 'missing-options.json'),
      PORT: String(port),
      ADMIN_TOKEN: token,
      TSA_ENABLED: 'true',
      TSA_START_URL: DEAD,
      TSA_STOP_URL: DEAD,
      TSA_BREAKER_THRESHOLD: '2',
      TSA_BREAKER_COOLDOWN_MS: '60000',
    },
    stdio: 'ignore',
  });
  try {
    let ready = false;
    for (let i = 0; i < 140; i++) {
      try {
        if ((await fetch(base + '/health')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, 'сървърът стартира');

    const start = () => call('/admin/api/v2/rfc3161', { method: 'POST', body: { phase: 'start', digest: 'ab'.repeat(32) } });
    assert.equal((await start()).status, 502, 'първият отказ е 502 (TSA не отговаря)');
    assert.equal((await start()).status, 502, 'вторият отказ също е 502');
    const third = await start();
    assert.equal(third.status, 503, JSON.stringify(third.value));
    assert.match(String(third.value.error), /cooldown/i);

    const status = await call('/admin/api/v2/rfc3161');
    assert.equal(status.status, 200);
    assert.ok(Array.isArray(status.value.breaker), 'GET връща състоянието на предпазителя');
    const entry = status.value.breaker.find((item) => item.url === DEAD);
    assert.ok(entry && entry.open === true, JSON.stringify(status.value.breaker));
    assert.equal(status.value.records.length, 0, 'няма записан .tsr при отказ');

    console.log('PASS tsa breaker: праг, cooldown 503, резервираност и видимо състояние');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
