'use strict';
// RFC 3161 клиент: DER на TimeStampReq, разбор на TimeStampResp (PKIStatusInfo,
// messageImprint, genTime) и валидация на входа. Тестът има собствен DER енкодер,
// за да не се проверява парсерът само със собствения си writer.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const tsa = require('../hapi_enterprise/tsa-client');

// ── независим DER writer ─────────────────────────────────────────────────────
const len = (n) => (n < 0x80 ? Buffer.from([n]) : Buffer.from([0x81, n]));
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), len(content.length), content]);
const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const int = (value) => {
  if (Buffer.isBuffer(value)) return tlv(0x02, value);
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
const genTime = (text) => tlv(0x18, Buffer.from(text, 'ascii'));
const utf8 = (text) => tlv(0x0c, Buffer.from(text, 'utf8'));
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

// ── независим DER reader ────────────────────────────────────────────────────
function read(buf, offset = 0) {
  const tag = buf[offset];
  let cursor = offset + 1;
  let length = buf[cursor++];
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + buf[cursor++];
  }
  return { tag, start: cursor, end: cursor + length, content: buf.subarray(cursor, cursor + length) };
}
function children(buf, node) {
  const out = [];
  let offset = node.start;
  while (offset < node.end) {
    const child = read(buf, offset);
    out.push(child);
    offset = child.end;
  }
  return out;
}

// ── TimeStampReq ────────────────────────────────────────────────────────────
const digest = 'ab'.repeat(32);
const nonce = Buffer.from('0102030405060708', 'hex');
const built = tsa.buildRequest({ digestHex: digest, algorithm: 'SHA256', nonce });
const request = read(built.der);
const requestKids = children(built.der, request);
assert.equal(request.tag, 0x30, 'TimeStampReq е SEQUENCE');
assert.equal(requestKids.length, 4, 'version + imprint + nonce + certReq');
assert.equal(Buffer.from(requestKids[0].content).readUInt8(0), 1, 'version = 1');
const imprint = children(built.der, requestKids[1]);
assert.equal(imprint.length, 2, 'messageImprint = algorithm + digest');
assert.equal(Buffer.from(imprint[1].content).toString('hex'), digest, 'digest се пренася без промяна');
assert.equal(Buffer.from(requestKids[2].content).toString('hex'), nonce.toString('hex'), 'nonce е този, който подаваме');
assert.equal(requestKids[3].tag, 0x01, 'certReq е BOOLEAN');
assert.equal(Buffer.from(requestKids[3].content)[0], 0xff, 'certReq = TRUE');
assert.equal(built.nonceHex, nonce.toString('hex'));
assert.equal(built.algorithm, 'SHA256');

const legacyBuf = tsa.buildRequest({ digestHex: digest, certReq: false }).der;
const legacy = read(legacyBuf);
assert.equal(children(legacyBuf, legacy).length, 3, 'certReq=false се пропуска (DER DEFAULT)');
const sha512Buf = tsa.buildRequest({ digestHex: 'cd'.repeat(64), algorithm: 'SHA512' }).der;
const sha512 = read(sha512Buf);
const sha512Imprint = children(sha512Buf, children(sha512Buf, sha512)[1]);
assert.equal(Buffer.from(sha512Imprint[1].content).length, 64, 'SHA-512 digest е 64 байта');
assert.throws(() => tsa.buildRequest({ digestHex: 'ab', algorithm: 'SHA256' }), /SHA256 digest/);
assert.throws(() => tsa.buildRequest({ digestHex: 'zz'.repeat(32) }), /hex/);
assert.throws(() => tsa.normalizeAlgorithm('MD5'), /Unsupported/);

// ── TimeStampResp (granted + токен) ─────────────────────────────────────────
function buildToken(digestHex, { time = '20261021120000Z', status = 0 } = {}) {
  const messageImprint = seq(seq(oid('2.16.840.1.101.3.4.2.1'), tlv(0x05, Buffer.alloc(0))), octet(Buffer.from(digestHex, 'hex')));
  const tstInfo = seq(int(1), oid('1.3.6.1.4.1.13762.3'), messageImprint, int(4711), genTime(time), seq(bool(true)));
  const eContent = seq(oid('1.2.840.113549.1.7.1'), tlv(0xa0, octet(tstInfo)));
  const signedData = seq(int(3), eContent);
  const token = seq(oid('1.2.840.113549.1.7.2'), tlv(0xa0, signedData));
  return { tsr: seq(seq(int(status)), token), token };
}

const granted = buildToken(digest);
const parsed = tsa.parseResponse(granted.tsr, { digestHex: digest, algorithm: 'SHA256' });
assert.equal(parsed.status, 0);
assert.equal(parsed.statusText, 'granted');
assert.equal(parsed.granted, true);
assert.equal(parsed.failInfo, null);
assert.equal(parsed.token.imprintMatches, true, 'imprint в токена съвпада с нашия digest');
assert.equal(parsed.token.imprint, digest);
assert.equal(parsed.token.genTime, '2026-10-21T12:00:00.000Z');
assert.equal(parsed.token.sha256, crypto.createHash('sha256').update(granted.token).digest('hex'));
assert.equal(parsed.token.bytes, granted.token.length);
assert.deepEqual(Buffer.from(parsed.token.der), granted.token, 'суровият DER на токена се връща за .tsr');

const foreign = tsa.parseResponse(granted.tsr, { digestHex: 'ff'.repeat(32) });
assert.equal(foreign.token.imprintMatches, false, 'чужд токен не се приема за наш');

// ── TimeStampResp (rejection + failInfo) ────────────────────────────────────
const rejected = seq(seq(int(2), utf8('bad request'), tlv(0x03, Buffer.from([0x06, 0x40]))));
const refused = tsa.parseResponse(rejected, { digestHex: digest });
assert.equal(refused.status, 2);
assert.equal(refused.statusText, 'rejection');
assert.equal(refused.granted, false);
assert.equal(refused.failInfo, 'badRequest');
assert.equal(refused.token, null, 'при отказ няма токен');

assert.throws(() => tsa.parseResponse(Buffer.from([0x30, 0x05, 0x02])), /DER truncated/);
assert.throws(() => tsa.parseResponse(Buffer.from([0x04, 0x00])), /not a SEQUENCE/);

// ── URL / digest валидация ──────────────────────────────────────────────────
assert.equal(tsa.normalizeUrl('https://zeitstempel.dfn.de/'), 'https://zeitstempel.dfn.de/');
assert.equal(tsa.normalizeUrl('http://timestamp.digicert.com'), 'http://timestamp.digicert.com/');
assert.throws(() => tsa.normalizeUrl('ftp://example.com/'), /http\(s\)/);
assert.throws(() => tsa.normalizeUrl('https://user:pass@example.com/'), /credentials/);
assert.throws(() => tsa.normalizeUrl('not a url'), /Invalid TSA URL/);
assert.throws(() => tsa.normalizeDigest('abc', 'SHA256'), /64 hex/);

console.log('PASS rfc3161 client: DER TimeStampReq, PKIStatusInfo, imprint/genTime, отказан токен, URL валидация');
