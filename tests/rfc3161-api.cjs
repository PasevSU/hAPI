'use strict';
// RFC 3161 START / STOP през административното API: TSQ към истински TSA
// (тук — локален фалшив TSA), запис на .tsr + метаданни, затварящ digest за STOP,
// отказ от TSA → 502 без запис, ролева защита.
const { stopChild, freePort } = require('./helpers.cjs');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

// ── независим DER writer за фалшивия TSA ────────────────────────────────────
const len = (n) => (n < 0x80 ? Buffer.from([n]) : Buffer.from([0x81, n]));
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), len(content.length), content]);
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
const octet = (buf) => tlv(0x04, Buffer.from(buf));
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
function findDigest(buffer) {
  for (let i = 0; i < buffer.length - 2; i++) {
    if (buffer[i] === 0x04 && buffer[i + 1] === 0x20) return buffer.subarray(i + 2, i + 34).toString('hex');
  }
  throw Error('messageImprint digest not found in TSQ');
}
function grantedReply(digestHex) {
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
  return { tsr: seq(seq(int(0)), token), token };
}
const rejectedReply = () => seq(seq(int(2), seq(tlv(0x0c, Buffer.from('bad request', 'utf8'))), tlv(0x03, Buffer.from([0x06, 0x40]))));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-rfc3161-'));
  const port = await freePort();
  const adminPort = await freePort();
  const token = 'rfc3161-test-admin-token-1234567890';
  const base = `http://127.0.0.1:${port}`;
  const admin = `http://127.0.0.1:${adminPort}`;
  const digest = 'ab'.repeat(32);
  let mode = 'granted';
  const seen = [];
  let child;

  const fake = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ path: req.url, type: req.headers['content-type'], bytes: body.length });
      res.setHeader('content-type', 'application/timestamp-reply');
      if (mode === 'rejected') return res.end(rejectedReply());
      const reply = grantedReply(findDigest(body));
      res.end(reply.tsr);
    });
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const fakeUrl = `http://127.0.0.1:${fake.address().port}/`;

  const call = async (url, { method = 'GET', body, bearer } = {}) => {
    const res = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
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

  try {
    child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
      env: {
        ...process.env,
        DATA_DIR: dir,
        OPTIONS_PATH: path.join(dir, 'missing-options.json'),
        PORT: String(port),
        ADMIN_TOKEN: token,
        INGRESS_MODE: 'true',
        ADMIN_PORT: String(adminPort),
        ADMIN_BIND_HOST: '127.0.0.1',
        TSA_ENABLED: 'true',
        TSA_START_URL: fakeUrl,
        TSA_STOP_URL: fakeUrl,
      },
      stdio: 'ignore',
    });
    for (let i = 0; i < 120; i++) {
      try {
        if ((await call(base + '/health')).status === 200) break;
      } catch { }
      await new Promise((r) => setTimeout(r, 50));
    }

    // 1. Ingress listener без профили → администраторски права по подразбиране.
    assert.equal((await call(admin + '/admin/api/v2/rfc3161')).status, 200);

    // 2. Невалидна фаза/дигит.
    assert.equal((await call(admin + '/admin/api/v2/rfc3161', { method: 'POST', body: { phase: 'middle' }, bearer: token })).status, 400);
    assert.equal(
      (await call(admin + '/admin/api/v2/rfc3161', { method: 'POST', body: { phase: 'start', digest: 'xyz' }, bearer: token })).status,
      400,
    );

    // 3. START: TSA отговаря с токен → запис .tsr + метаданни.
    const start = await call(admin + '/admin/api/v2/rfc3161', { method: 'POST', body: { phase: 'start', digest }, bearer: token });
    assert.equal(start.status, 201);
    assert.equal(start.value.phase, 'start');
    assert.equal(start.value.digest, digest);
    assert.equal(start.value.statusText, 'granted');
    assert.equal(start.value.url, fakeUrl, 'използва TSA_START_URL от средата');
    assert.equal(start.value.token.imprintMatches, true);
    assert.equal(start.value.token.genTime, '2026-10-21T12:30:00.000Z');
    assert.match(start.value.file, /^start-.*\.tsr$/);
    const tsaDir = path.join(dir, 'tsa');
    const files = fs.readdirSync(tsaDir);
    assert.ok(files.includes(start.value.file), 'файлът .tsr е на диска');
    assert.ok(files.includes(start.value.file.replace(/\.tsr$/, '.json')), 'метаданните са до токена');
    const stored = fs.readFileSync(path.join(tsaDir, start.value.file));
    assert.equal(crypto.createHash('sha256').update(stored).digest('hex'), start.value.token.sha256, '.tsr съдържа точно токена');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(tsaDir, start.value.file)).mode & 0o777, 0o600);
    }
    assert.equal(seen[0].type, 'application/timestamp-query');

    // 4. STOP без digest → затварящ хеш от START (digest + token sha256).
    const stop = await call(admin + '/admin/api/v2/rfc3161', { method: 'POST', body: { phase: 'stop' }, bearer: token });
    assert.equal(stop.status, 201);
    assert.equal(stop.value.phase, 'stop');
    assert.deepEqual(stop.value.closesDigest, { startDigest: digest, startTokenSha256: start.value.token.sha256 });
    assert.equal(
      stop.value.digest,
      crypto.createHash('sha256').update(digest + '|' + start.value.token.sha256).digest('hex'),
      'STOP подпечатва затварящия хеш',
    );
    assert.equal(stop.value.token.imprintMatches, true);
    assert.equal(stop.value.url, fakeUrl, 'използва TSA_STOP_URL от средата');

    // 5. Списък: най-новият запис е STOP.
    const list = await call(admin + '/admin/api/v2/rfc3161', { bearer: token });
    assert.equal(list.status, 200);
    assert.equal(list.value.records.length, 2);
    assert.equal(list.value.records[0].phase, 'stop');
    assert.equal(list.value.records[1].phase, 'start');
    assert.deepEqual(list.value.tsa, { start: fakeUrl, stop: fakeUrl });

    // 6. Отказ на TSA → 502, без нов .tsr.
    mode = 'rejected';
    const before = fs.readdirSync(tsaDir).length;
    const refused = await call(admin + '/admin/api/v2/rfc3161', { method: 'POST', body: { phase: 'start', digest }, bearer: token });
    assert.equal(refused.status, 502);
    assert.match(refused.value.error, /rejection|refused/i);
    assert.equal(fs.readdirSync(tsaDir).length, before, 'при отказ не се записва файл');

    // 7. Недостъпен TSA → 502 (без да гърми процесът).
    const unreachable = await call(admin + '/admin/api/v2/rfc3161', {
      method: 'POST',
      body: { phase: 'start', digest, url: 'http://127.0.0.1:1/' },
      bearer: token,
    });
    assert.equal(unreachable.status, 502);
    assert.equal((await call(base + '/health')).status, 200, 'сървърът е жив след грешка на TSA');

    // 8. Резервираност: първият TSA е недостъпен, вторият отговаря.
    mode = 'granted';
    const fallback = await call(admin + '/admin/api/v2/rfc3161', {
      method: 'POST',
      body: { phase: 'start', digest, url: 'http://127.0.0.1:1/,' + fakeUrl },
      bearer: token,
    });
    assert.equal(fallback.status, 201, 'вторият TSA поема при отказ на първия');
    assert.equal(fallback.value.url, fakeUrl);
    assert.equal(fallback.value.attempts.length, 2);
    assert.equal(fallback.value.attempts[0].ok, false);
    assert.equal(fallback.value.attempts[1].ok, true);
    console.log('PASS rfc3161 API: START/STOP токени, .tsr + метаданни, затварящ digest, отказ без запис, admin gate');
  } finally {
    await stopChild(child);
    await new Promise((resolve) => fake.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
