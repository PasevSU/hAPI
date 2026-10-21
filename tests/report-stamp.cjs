'use strict';
// Фаза 11 / RS-05: реален RFC 3161 обхват за отчетите (без мрежа — TSA се инжектира).
//
// Проверява се онова, което прави обхвата проверяем, а не „изглежда подпечатан“:
//   1. без TSA адрес нищо не се измисля — всички полета са „not established“;
//   2. START иска точно digest-а на манифеста, който отчетът показва;
//   3. STOP иска sha256("<START digest>|<START token sha256>") — обвързан е със START;
//   4. отказ или изкривен imprint не се броят за успех;
//   5. рендерът слага записите В обхвата (след START, преди STOP).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const M = require('../hapi_enterprise/report-manifest.js');
const R = require('../hapi_enterprise/report-render.js');
const S = require('../hapi_enterprise/report-stamp.js');
const example = require('../hapi_enterprise/ui/manifest.example.json');

const manifest = M.normalize(example);
const evidenceDigest = M.digest(manifest);
const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

const granted = (digest, tokenHex, extra = {}) => ({
  url: 'https://tsa.example/',
  algorithm: 'SHA256',
  digest,
  nonce: 'n0nce',
  status: 0,
  statusText: 'granted',
  granted: true,
  failInfo: null,
  token: {
    bytes: 1024,
    sha256: tokenHex,
    genTime: '2026-10-21T10:00:00.000Z',
    serialNumber: '0x01',
    imprintMatches: true,
  },
  tokenDer: Buffer.from('der'),
  ...extra,
});

(async () => {
  // 1. Без TSA адрес: обхватът е обявен за неподпечатан, без нито един измислен ред.
  const none = await S.stampReport(manifest, {});
  assert.equal(none.requested, false);
  assert.equal(none.ok, false);
  assert.equal(none.evidenceDigest, evidenceDigest);
  const noneFields = new Map(none.start.fields);
  assert.equal(noneFields.get('Marker'), 'START');
  assert.equal(noneFields.get('Evidence-Set SHA-256'), evidenceDigest.toUpperCase());
  assert.equal(noneFields.get('Verification Status'), S.NOT_REQUESTED);
  assert.equal(noneFields.get('Token SHA-256'), 'not established — no TSA call in this run');
  assert.equal(none.stop.token, null);
  assert.match(new Map(none.stop.fields).get('Verification Status'), /^NOT REQUESTED/);

  // 1б. Неподдържан алгоритъм се отказва, преди да се обади на TSA.
  let called = 0;
  const badAlg = await S.stampReport(manifest, {
    startUrl: 'https://tsa.example/',
    algorithm: 'MD5',
    stamp: async () => {
      called += 1;
      return granted(evidenceDigest, TOKEN_A);
    },
  });
  assert.equal(called, 0, 'неподдържан алгоритъм не бива да стига до TSA');
  assert.equal(badAlg.requested, false);
  assert.match(badAlg.error, /algorithm/i);

  // 2. Успешен обхват: START иска digest-а на манифеста, STOP — затварящия хеш.
  const calls = [];
  const ok = await S.stampReport(manifest, {
    startUrl: 'https://tsa-start.example/',
    stopUrl: 'https://tsa-stop.example/',
    stamp: async (options) => {
      calls.push(options);
      return calls.length === 1 ? granted(options.digestHex, TOKEN_A) : granted(options.digestHex, TOKEN_B);
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].digestHex, evidenceDigest, 'START подпечатва манифеста');
  const expectedClosing = sha256(evidenceDigest + '|' + TOKEN_A);
  assert.equal(calls[1].digestHex, expectedClosing, 'STOP подпечатва затварящия хеш');
  assert.equal(ok.ok, true);
  assert.equal(ok.closingDigest, expectedClosing);
  assert.equal(ok.start.token.sha256, TOKEN_A);
  assert.equal(ok.stop.token.sha256, TOKEN_B);

  const okStart = new Map(ok.start.fields);
  assert.equal(okStart.get('Message Imprint (SHA-256)'), evidenceDigest.toUpperCase());
  assert.equal(okStart.get('Token SHA-256'), TOKEN_A.toUpperCase());
  assert.equal(okStart.get('TSA URL'), 'https://tsa.example/');
  assert.equal(okStart.get('TSA genTime'), '2026-10-21T10:00:00.000Z');
  assert.match(okStart.get('Verification Status'), /granted/);
  const okStop = new Map(ok.stop.fields);
  assert.equal(okStop.get('STOP Closing Message Imprint'), expectedClosing.toUpperCase());
  assert.equal(okStop.get('START Anchor Used by STOP'), TOKEN_A.toUpperCase());
  assert.equal(okStop.get('Token SHA-256'), TOKEN_B.toUpperCase());

  // 3. Отказ на TSA: има запис за опита, но няма токен и няма STOP заявка.
  const rejectedCalls = [];
  const refused = await S.stampReport(manifest, {
    startUrl: 'https://tsa.example/',
    stamp: async (options) => {
      rejectedCalls.push(options);
      return { ...granted(options.digestHex, TOKEN_A), granted: false, status: 2, statusText: 'rejection', token: null, tokenDer: null };
    },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.start.token, null);
  assert.equal(rejectedCalls.length, 1, 'след отказан START няма STOP заявка');
  assert.match(new Map(refused.start.fields).get('Verification Status'), /^FAILED — TSA refused/);
  assert.equal(new Map(refused.start.fields).get('Token SHA-256'), 'not established — the TSA call did not produce a token');
  assert.match(new Map(refused.stop.fields).get('Verification Status'), /^NOT REQUESTED/);

  // 4. Токен с чужд imprint не е успех, дори когато TSA казва granted.
  const mismatch = await S.stampReport(manifest, {
    startUrl: 'https://tsa.example/',
    stamp: async (options) => {
      const r = granted(options.digestHex, TOKEN_A);
      r.token.imprintMatches = false;
      return r;
    },
  });
  assert.equal(mismatch.ok, false);
  assert.match(new Map(mismatch.start.fields).get('Verification Status'), /^REJECTED/);

  // 5. Мрежова грешка: отчита се като провал, не като липса на токен по подразбиране.
  const broken = await S.stampReport(manifest, {
    startUrl: 'https://tsa.example/',
    stamp: async () => {
      throw Object.assign(Error('connect ECONNREFUSED'), { status: 502 });
    },
  });
  assert.equal(broken.ok, false);
  assert.match(new Map(broken.start.fields).get('Verification Status'), /ECONNREFUSED/);

  // 6. Рендер: записите стоят В обхвата си — START записът след заглавието START и преди
  // заглавието STOP; STOP записът е част от секцията STOP. Без записи няма такива таблици.
  const withStamps = R.toPdfBlocks(manifest, { stamps: ok });
  const indexOfHeading = (blocks, text) => blocks.findIndex((b) => b.type === 'h3' && b.text === text);
  const markerTable = (blocks, marker) =>
    blocks.findIndex((b) => b.type === 'table' && b.rows.some((r) => r[0] === 'Marker' && r[1] === marker));
  const startHeading = indexOfHeading(withStamps, 'RFC 3161 START');
  const stopHeading = indexOfHeading(withStamps, 'RFC 3161 STOP');
  const startTable = markerTable(withStamps, 'START');
  const stopTable = markerTable(withStamps, 'STOP');
  assert.ok(startTable > -1 && stopTable > -1, 'START и STOP записите трябва да са налични');
  assert.ok(startTable > startHeading, 'START записът е в секцията START');
  assert.ok(startTable < stopHeading, 'START записът е в обхвата (преди STOP)');
  assert.ok(stopTable > stopHeading, 'STOP записът е част от секцията STOP');
  assert.ok(
    withStamps[startTable].rows.some((r) => r[0] === 'Token SHA-256' && r[1] === TOKEN_A.toUpperCase()),
    'START записът носи отпечата на токена',
  );
  assert.equal(withStamps.filter((b) => b.type === 'h3')[0].text, 'RFC 3161 START');
  assert.equal(withStamps.filter((b) => b.type === 'h3').at(-1).text, 'RFC 3161 STOP');

  const withoutStamps = R.toPdfBlocks(manifest, {});
  assert.equal(markerTable(withoutStamps, 'START'), -1, 'без TSA няма запис за START');
  assert.equal(markerTable(withoutStamps, 'STOP'), -1, 'без TSA няма запис за STOP');

  // 7. PDF-ът се строи и с реални записи (нищо не хвърля по пътя).
  const pdf = R.renderPdf(manifest, { stamps: ok });
  assert.ok(Buffer.isBuffer(pdf) && pdf.subarray(0, 5).toString() === '%PDF-');

  // 8. Край-до-край с локален TSA: истински DER през HTTP, без инжектиран заместител.
  // Така се проверява целият път TimeStampReq → TSA → TimeStampResp → полета → PDF.
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const imprint = imprintOf(body);
      seen.push(imprint);
      res.writeHead(200, { 'content-type': 'application/timestamp-reply' });
      res.end(timestampReply(imprint));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const tsaUrl = `http://127.0.0.1:${server.address().port}/`;
  try {
    const live = await S.stampReport(manifest, { startUrl: tsaUrl, stopUrl: tsaUrl });
    assert.equal(live.ok, true, 'локалният TSA трябва да издаде токен: ' + live.error);
    assert.equal(seen.length, 2, 'две TSA заявки: START и STOP');
    assert.equal(seen[0], evidenceDigest, 'START заявката носи digest-а на манифеста');
    assert.equal(seen[1], sha256(evidenceDigest + '|' + live.start.token.sha256), 'STOP заявката носи затварящия хеш');
    assert.equal(new Map(live.start.fields).get('Token SHA-256'), live.start.token.sha256.toUpperCase());
    assert.match(new Map(live.stop.fields).get('Verification Status'), /granted/);
    const livePdf = R.renderPdf(manifest, { stamps: live });
    assert.equal(livePdf.subarray(0, 5).toString(), '%PDF-');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    require('../hapi_enterprise/tsa-client.js').resetBreaker(tsaUrl);
  }

  console.log('report-stamp OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

// ── минимален DER за локалния TSA (само в теста) ────────────────────────────
const OID_SHA256 = Buffer.from('0609608648016503040201', 'hex');
const OID_TSTINFO = Buffer.from('06092a864886f70d010701', 'hex');
const OID_SIGNED = Buffer.from('06092a864886f70d010702', 'hex');
const OID_POLICY = Buffer.from('06082b06010401eb4203', 'hex');

function derLength(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let value = n;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const octet = (buf) => tlv(0x04, Buffer.from(buf));
const smallInt = (value) => tlv(0x02, Buffer.from([value]));
const generalized = (text) => tlv(0x18, Buffer.from(text, 'ascii'));

// Digest-ът, който клиентът е поискал: единственият OCTET STRING с дължина 32 в заявката.
function imprintOf(request) {
  for (let i = 0; i < request.length - 2; i++) {
    if (request[i] !== 0x04) continue;
    const length = request[i + 1];
    if (length === 32) return request.subarray(i + 2, i + 2 + 32).toString('hex');
  }
  throw Error('no SHA-256 message imprint in the TimeStampReq');
}

function timestampReply(digestHex) {
  const messageImprint = seq(seq(OID_SHA256, tlv(0x05, Buffer.alloc(0))), octet(Buffer.from(digestHex, 'hex')));
  const tstInfo = seq(smallInt(1), OID_POLICY, messageImprint, smallInt(4711), generalized('20261021120000Z'));
  const eContent = seq(OID_TSTINFO, tlv(0xa0, octet(tstInfo)));
  const signedData = seq(smallInt(3), eContent);
  const token = seq(OID_SIGNED, tlv(0xa0, signedData));
  return seq(seq(smallInt(0)), token);
}
