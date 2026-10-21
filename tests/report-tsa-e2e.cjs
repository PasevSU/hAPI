'use strict';
// RS-05, край-до-край: отчет → истински TSA (тук локален) → .tsr на диска → проверка.
//
// Този тест пази едно твърдение от CHANGELOG: „токените от отчет се пазят като .tsr
// и ги покрива /rfc3161/verify“. Проверява се по веригата:
//   1. POST /reports/render с `tsa: true` издава PDF и връща X-TSA-*;
//   2. на диска има един START и един STOP запис, а дигитите им са преизчислими;
//   3. /rfc3161/verify ги признава за валидни;
//   4. подправен .tsr се хваща (409), след което се възстановява.
const { stopChild } = require('./helpers.cjs');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

// ── независим DER writer за локалния TSA ────────────────────────────────────
const derLen = (n) => (n < 0x80 ? Buffer.from([n]) : Buffer.from([0x81, n]));
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
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
function grantedReply(digestHex, serial) {
  const imprint = seq(seq(oid('2.16.840.1.101.3.4.2.1'), tlv(0x05, Buffer.alloc(0))), octet(Buffer.from(digestHex, 'hex')));
  const tstInfo = seq(
    int(serial),
    oid('1.3.6.1.4.1.13762.3'),
    imprint,
    int(serial),
    tlv(0x18, Buffer.from('20261021123000Z', 'ascii')),
  );
  const token = seq(oid('1.2.840.113549.1.7.2'), tlv(0xa0, seq(int(3), seq(oid('1.2.840.113549.1.7.1'), tlv(0xa0, octet(tstInfo))))));
  return { tsr: seq(seq(int(0)), token), token };
}

const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-report-tsa-'));
  const port = 33500 + Math.floor(Math.random() * 1000);
  const token = 'report-tsa-admin-token-2026-r5';
  const base = `http://127.0.0.1:${port}`;
  const M = require('../hapi_enterprise/report-manifest.js');
  const manifest = require('../hapi_enterprise/ui/manifest.example.json');
  const evidenceDigest = M.digest(M.normalize(manifest));
  const seen = [];
  let serial = 0;
  let child;

  const tsa = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const digest = findDigest(Buffer.concat(chunks));
      serial += 1;
      seen.push(digest);
      res.writeHead(200, { 'content-type': 'application/timestamp-reply' });
      res.end(grantedReply(digest, serial).tsr);
    });
  });
  await new Promise((resolve) => tsa.listen(0, '127.0.0.1', resolve));
  const tsaUrl = `http://127.0.0.1:${tsa.address().port}/`;

  const post = async (url, body) => {
    const res = await fetch(base + url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    const isJson = String(res.headers.get('content-type') || '').includes('json');
    return { res, body: isJson ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };

  try {
    child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
      env: {
        ...process.env,
        DATA_DIR: dir,
        OPTIONS_PATH: path.join(dir, 'missing-options.json'),
        PORT: String(port),
        ADMIN_TOKEN: token,
        TSA_ENABLED: 'true',
        TSA_START_URL: tsaUrl,
        TSA_STOP_URL: tsaUrl,
      },
      stdio: 'ignore',
    });
    let ready = false;
    for (let i = 0; i < 140; i++) {
      try {
        if ((await fetch(base + '/health')).ok) {
          ready = true;
          break;
        }
      } catch { }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, 'сървърът трябва да стартира');

    // 1. Отчетът е издаден и носи реалния обхват.
    const rendered = await post('/admin/api/v2/reports/render', { manifest, tsa: true });
    assert.equal(rendered.res.status, 201);
    assert.equal(rendered.res.headers.get('x-tsa-status'), 'granted');
    assert.equal(rendered.res.headers.get('x-tsa-evidence-sha256'), evidenceDigest);
    assert.equal(seen.length, 2, 'две TSA заявки: START и STOP');
    assert.equal(seen[0], evidenceDigest, 'START подпечатва digest-а на манифеста');
    const pdf = rendered.body;
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.equal(rendered.res.headers.get('x-pdf-sha256'), crypto.createHash('sha256').update(pdf).digest('hex'));

    // 2. Записите на диска са преизчислими: STOP е обвързан със START токена.
    const tsaDir = path.join(dir, 'tsa');
    const records = fs
      .readdirSync(tsaDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(tsaDir, name), 'utf8')));
    assert.equal(records.length, 2, 'един START и един STOP запис');
    const start = records.find((r) => r.phase === 'start');
    const stop = records.find((r) => r.phase === 'stop');
    assert.ok(start && stop, 'двете фази са записани');
    assert.equal(start.source, 'report');
    assert.equal(start.digest, evidenceDigest);
    assert.equal(stop.digest, sha256(evidenceDigest + '|' + start.token.sha256), 'STOP затваря START токена');
    assert.equal(stop.closingDigest, stop.digest);
    for (const record of [start, stop]) {
      const file = path.join(tsaDir, record.file);
      const bytes = fs.readFileSync(file);
      assert.equal(
        crypto.createHash('sha256').update(bytes).digest('hex'),
        record.token.sha256,
        `записаният .tsr съвпада с отпечатъка (${record.phase})`,
      );
    }

    // 3. Проверката на доказателствата покрива и отчетните токени.
    const verified = await post('/admin/api/v2/rfc3161/verify', {});
    assert.equal(verified.res.status, 200);
    assert.equal(verified.body.checked, 2);
    assert.equal(verified.body.valid, 2);
    assert.equal(verified.body.invalid, 0);

    // 3б. Одитът съдържа това, което CHANGELOG твърди: report.tsa.ok и report.render
    // с отпечатъка на готовия PDF. Без тази проверка „влиза в одита“ е обещание, не факт.
    const auditLines = fs
      .readFileSync(path.join(dir, 'audit.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const tsaOk = auditLines.find((entry) => entry.event === 'report.tsa.ok');
    assert.ok(tsaOk, 'одитът трябва да има report.tsa.ok');
    assert.equal(tsaOk.start, start.token.sha256);
    assert.equal(tsaOk.stop, stop.token.sha256);
    assert.equal(tsaOk.evidenceDigest, evidenceDigest);
    const renderedEvent = auditLines.find((entry) => entry.event === 'report.render');
    assert.ok(renderedEvent, 'одитът трябва да има report.render');
    assert.equal(renderedEvent.pdfSha256, rendered.res.headers.get('x-pdf-sha256'));
    assert.equal(renderedEvent.tsa, 'ok');
    // Веригата остава валидна след тези записи.
    const chain = await fetch(base + '/admin/api/audit/verify', { headers: { authorization: 'Bearer ' + token } });
    assert.equal(chain.status, 200);
    assert.equal((await chain.json()).integrity, 'HASH_CHAIN_VALID');

    // 4. Подправен токен се хваща, а след възстановяване проверката отново минава.
    const victim = path.join(tsaDir, start.file);
    const original = fs.readFileSync(victim);
    const tampered = Buffer.from(original);
    tampered[tampered.length - 1] ^= 0xff;
    fs.writeFileSync(victim, tampered);
    const caught = await post('/admin/api/v2/rfc3161/verify', {});
    assert.equal(caught.res.status, 409, 'подправеният .tsr не минава за валиден');
    assert.equal(caught.body.invalid, 1);
    assert.ok(caught.body.files.some((f) => f.status === 'tampered'));
    fs.writeFileSync(victim, original);
    const restored = await post('/admin/api/v2/rfc3161/verify', {});
    assert.equal(restored.res.status, 200);
    assert.equal(restored.body.invalid, 0);

    console.log('report-tsa-e2e OK: отчет → TSA → .tsr → verify (и хваща подправен токен)');
  } finally {
    stopChild(child);
    await new Promise((resolve) => tsa.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
