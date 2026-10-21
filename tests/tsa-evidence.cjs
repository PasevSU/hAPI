'use strict';
// Сценарий: животът на RFC 3161 доказателствата.
//
//   • всеки START записва .tsr + .json и след това се поддържа архивът — пазят се
//     последните TSA_KEEP записа (по подразбиране 200), за да не расте безкрайно;
//   • POST/GET /admin/api/v2/rfc3161/verify преизчислява SHA-256 на всеки .tsr и го
//     сравнява с отпечатъка от записа → 200 при всички валидни, 409 при подправен,
//     изчезнал или нечетим файл (доказателството не минава „на доверие“);
//   • маршрутът е административен (401 без токен).
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
  const imprint = seq(
    seq(oid('2.16.840.1.101.3.4.2.1'), tlv(0x05, Buffer.alloc(0))),
    octet(Buffer.from(digestHex, 'hex')),
  );
  const tstInfo = seq(
    int(1),
    oid('1.3.6.1.4.1.13762.3'),
    imprint,
    int(20261021),
    tlv(0x18, Buffer.from('20261021123000Z', 'ascii')),
    seq(bool(true)),
  );
  const token = seq(
    oid('1.2.840.113549.1.7.2'),
    tlv(0xa0, seq(int(3), seq(oid('1.2.840.113549.1.7.1'), tlv(0xa0, octet(tstInfo))))),
  );
  return seq(seq(int(0)), token);
};

(async () => {
  const fake = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      res.setHeader('content-type', 'application/timestamp-reply');
      res.end(grantedReply(findDigest(Buffer.concat(chunks))));
    });
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const fakeUrl = `http://127.0.0.1:${fake.address().port}/`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-tsa-evidence-'));
  const tsaDir = path.join(dir, 'tsa');
  const port = 39100 + Math.floor(Math.random() * 400);
  const token = 'tsa-evidence-admin-token-0123456789';
  const base = `http://127.0.0.1:${port}`;

  const call = async (route, { method = 'GET', headers = {} } = {}) => {
    const res = await fetch(base + route, { method, headers: { Authorization: 'Bearer ' + token, ...headers } });
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
      TSA_START_URL: fakeUrl,
      TSA_STOP_URL: fakeUrl,
      TSA_KEEP: '2',
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

    // 1. Маршрутът за проверка е административен.
    const anon = await fetch(base + '/admin/api/v2/rfc3161/verify');
    assert.equal(anon.status, 401, 'без токен няма проверка на доказателства');

    // 2. Три START-а с TSA_KEEP=2 → пазят се само последните две двойки файлове.
    for (let i = 1; i <= 3; i++) {
      const digest = i.toString(16).padStart(2, '0').repeat(32);
      const res = await fetch(base + '/admin/api/v2/rfc3161', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: 'start', digest }),
      });
      assert.equal(res.status, 201, `START ${i} трябва да мине`);
      const record = await res.json();
      assert.match(record.token.sha256, /^[a-f0-9]{64}$/);
    }

    const tsaFiles = () => fs.readdirSync(tsaDir).sort();
    const afterThree = tsaFiles();
    assert.equal(afterThree.filter((n) => n.endsWith('.tsr')).length, 2, `очаквам 2 .tsr: ${afterThree.join(',')}`);
    assert.equal(afterThree.filter((n) => n.endsWith('.json')).length, 2, 'записите вървят по двойки с токените');

    const listing = await call('/admin/api/v2/rfc3161');
    assert.equal(listing.value.records.length, 2, 'GET връща само пазените записи');

    // 3. Проверка: всички съхранени токени съвпадат с отпечатъците си.
    const verify = await call('/admin/api/v2/rfc3161/verify', { method: 'POST' });
    assert.equal(verify.status, 200, JSON.stringify(verify.value));
    assert.equal(verify.value.checked, 2);
    assert.equal(verify.value.invalid, 0);
    assert.equal(verify.value.keep, 2);
    for (const item of verify.value.files) {
      assert.equal(item.status, 'valid');
      assert.equal(item.actual, item.expected, 'изчисленият хеш съвпада с записания');
      assert.ok(item.bytes > 0);
    }

    // 4. Подправен .tsr → 409 и ясно кой файл е компрометиран.
    const victim = verify.value.files[0];
    const victimPath = path.join(tsaDir, victim.file);
    fs.writeFileSync(victimPath, Buffer.concat([fs.readFileSync(victimPath), Buffer.from('tampered')]));
    const tampered = await call('/admin/api/v2/rfc3161/verify', { method: 'POST' });
    assert.equal(tampered.status, 409, JSON.stringify(tampered.value));
    assert.equal(tampered.value.invalid, 1);
    const flagged = tampered.value.files.find((f) => f.file === victim.file);
    assert.equal(flagged.status, 'tampered');
    assert.notEqual(flagged.actual, flagged.expected);

    // 5. Изчезнал .tsr → 409 със status 'missing'.
    const other = tampered.value.files.find((f) => f.file !== victim.file);
    fs.unlinkSync(path.join(tsaDir, other.file));
    const missing = await call('/admin/api/v2/rfc3161/verify');
    assert.equal(missing.status, 409);
    assert.equal(missing.value.files.find((f) => f.file === other.file).status, 'missing');

    // 6. Новият START пак поддържа архива в лимита.
    const fresh = await fetch(base + '/admin/api/v2/rfc3161', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'start', digest: 'ee'.repeat(32) }),
    });
    assert.equal(fresh.status, 201);
    assert.equal(tsaFiles().filter((n) => n.endsWith('.json')).length, 2, 'архивът остава в лимита');

    console.log(
      'PASS tsa evidence: TSA_KEEP поддръжка, SHA-256 проверка на .tsr, подправен и изчезнал токен',
    );
  } finally {
    await stopChild(child);
    await new Promise((resolve) => fake.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
