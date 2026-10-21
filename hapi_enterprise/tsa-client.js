'use strict';
// RFC 3161 Time-Stamp Protocol клиент (TSQ → TSA → TSR), без зависимости.
//
// Порт на блока „RFC 3161 TSA — START / STOP“ от HASH_REPORT (ChronoSeal-Vault):
// START подпечатва манифеста на отчета, STOP — затварящия хеш на пакета.
// DER се кодира и декодира ръчно, за да остане add-on-ът без npm пакети и без
// външни библиотеки; всичко, което се връща към извикващия, е проверено:
//   • status и failInfo идват от PKIStatusInfo;
//   • messageImprint в TSTInfo трябва да съвпада с нашия digest (imprintMatches);
//   • токенът се връща като суров DER (за .tsr файл) + SHA-256 отпечатък.
// Никога не се лъжем: при отказ от TSA няма „измислен“ токен.

const crypto = require('node:crypto');

const ALGORITHMS = {
  SHA1: { oid: '1.3.14.3.2.26', bytes: 20 },
  SHA256: { oid: '2.16.840.1.101.3.4.2.1', bytes: 32 },
  SHA512: { oid: '2.16.840.1.101.3.4.2.3', bytes: 64 },
};
const STATUS_TEXT = {
  0: 'granted',
  1: 'grantedWithMods',
  2: 'rejection',
  3: 'waiting',
  4: 'revocationWarning',
  5: 'revocationNotification',
};
const FAIL_INFO = {
  0: 'badAlg',
  1: 'badRequest',
  2: 'badDataFormat',
  3: 'timeNotAvailable',
  4: 'unacceptedPolicy',
  5: 'unacceptedExtension',
  6: 'addInfoNotAvailable',
  7: 'systemFailure',
};
const MAX_REPLY_BYTES = 2 * 1024 * 1024;

// ── DER writer ───────────────────────────────────────────────────────────────
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
function tlv(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}
function seq(...parts) {
  return tlv(0x30, Buffer.concat(parts));
}
function integer(buffer) {
  let bytes = Buffer.from(buffer);
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return tlv(0x02, bytes);
}
function smallInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw Error('Invalid integer');
  const bytes = [];
  let rest = value;
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  return integer(Buffer.from(bytes.length ? bytes : [0]));
}
function octetString(buffer) {
  return tlv(0x04, Buffer.from(buffer));
}
function boolean(value) {
  return tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
}
function oid(dotted) {
  const parts = String(dotted).split('.').map(Number);
  if (parts.length < 2 || parts.some((p) => !Number.isInteger(p) || p < 0)) throw Error('Invalid OID');
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
}

// ── DER reader ───────────────────────────────────────────────────────────────
function readTlv(buffer, offset) {
  if (offset + 2 > buffer.length) throw Error('DER truncated');
  const tag = buffer[offset];
  let cursor = offset + 1;
  let length = buffer[cursor++];
  if (length & 0x80) {
    const count = length & 0x7f;
    if (!count || count > 4) throw Error('DER length unsupported');
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + buffer[cursor++];
  }
  const start = cursor;
  const end = start + length;
  if (end > buffer.length) throw Error('DER truncated');
  return { tag, start, end, content: buffer.subarray(start, end), raw: buffer.subarray(offset, end) };
}
function list(buffer, node) {
  const out = [];
  let offset = node.start;
  while (offset < node.end) {
    const child = readTlv(buffer, offset);
    out.push(child);
    offset = child.end;
  }
  return out;
}
function intValue(node) {
  let value = 0;
  for (const byte of node.content) value = value * 256 + byte;
  return value;
}
function generalizedTime(text) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d+))?Z$/.exec(String(text || ''));
  if (!match) return null;
  const [, y, mo, d, h, mi, s, fraction] = match;
  const ms = fraction ? Math.round(Number('0.' + fraction) * 1000) : 0;
  const at = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, ms));
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

// ── TimeStampReq ─────────────────────────────────────────────────────────────
function normalizeAlgorithm(value) {
  const name = String(value || 'SHA256')
    .toUpperCase()
    .replace(/[-_]/g, '');
  const aliases = { SHA1: 'SHA1', SHA256: 'SHA256', SHA512: 'SHA512' };
  if (!aliases[name]) throw Error('Unsupported hash algorithm: ' + value);
  return aliases[name];
}
function normalizeDigest(hex, algorithm) {
  const normalized = String(hex || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]+$/.test(normalized)) throw Error('Digest must be hex');
  if (normalized.length !== ALGORITHMS[algorithm].bytes * 2) {
    throw Error(`${algorithm} digest must be ${ALGORITHMS[algorithm].bytes * 2} hex characters`);
  }
  return normalized;
}
function messageImprint(digestHex, algorithm) {
  return seq(seq(oid(ALGORITHMS[algorithm].oid), tlv(0x05, Buffer.alloc(0))), octetString(Buffer.from(digestHex, 'hex')));
}
// TimeStampReq ::= SEQUENCE {
//   version INTEGER { v1(1) }, messageImprint MessageImprint,
//   reqPolicy TSAPolicyId OPTIONAL, nonce INTEGER OPTIONAL,
//   certReq BOOLEAN DEFAULT FALSE, extensions [0] IMPLICIT OPTIONAL }
function buildRequest({ digestHex, algorithm = 'SHA256', nonce, certReq = true } = {}) {
  const name = normalizeAlgorithm(algorithm);
  const digest = normalizeDigest(digestHex, name);
  const nonceBytes = nonce ? Buffer.from(nonce) : crypto.randomBytes(8);
  if (!nonceBytes.length) throw Error('Nonce must not be empty');
  const body = [smallInteger(1), messageImprint(digest, name), integer(nonceBytes)];
  // certReq има DEFAULT FALSE — TRUE се кодира, FALSE се пропуска (важидер DER).
  if (certReq !== false) body.push(boolean(true));
  return { der: seq(...body), nonceHex: Buffer.from(nonceBytes).toString('hex'), digestHex: digest, algorithm: name };
}

// ── TimeStampResp ────────────────────────────────────────────────────────────
// TSTInfo ::= SEQUENCE { version, policy, messageImprint, serialNumber, genTime, ... }
function parseTstInfo(bytes) {
  const root = readTlv(bytes, 0);
  const kids = list(bytes, root);
  const imprint = kids.find((node) => node.tag === 0x30);
  if (!imprint) return null;
  const imprintKids = list(bytes, imprint);
  const digestHex = imprintKids[1] ? Buffer.from(imprintKids[1].content).toString('hex') : '';
  const times = kids.filter((node) => node.tag === 0x18);
  const serial = kids.filter((node) => node.tag === 0x02)[1];
  return {
    digestHex,
    genTime: times.length ? generalizedTime(times[0].content.toString('ascii')) : null,
    serialNumber: serial ? Buffer.from(serial.content).toString('hex') : null,
  };
}
// TimeStampToken = CMS ContentInfo(signedData) → SignedData → encapContentInfo → eContent OCTET STRING.
function extractTstInfo(token) {
  const contentInfo = readTlv(token, 0);
  const infoKids = list(token, contentInfo);
  const explicit = infoKids.find((node) => node.tag === 0xa0);
  if (!explicit) return null;
  const signedData = readTlv(token, explicit.start);
  for (const node of list(token, signedData)) {
    if (node.tag !== 0x30) continue;
    const inner = list(token, node);
    if (inner.length < 2 || inner[0].tag !== 0x06 || inner[1].tag !== 0xa0) continue;
    // eContent [0] EXPLICIT OCTET STRING → вътре е DER-ът на TSTInfo.
    const payload = readTlv(token, inner[1].start);
    if (payload.tag !== 0x04) continue;
    try {
      return parseTstInfo(payload.content);
    } catch {
      return null;
    }
  }
  return null;
}
function parseResponse(der, { digestHex, algorithm = 'SHA256' } = {}) {
  const bytes = Buffer.from(der);
  const root = readTlv(bytes, 0);
  if (root.tag !== 0x30) throw Error('TSR is not a SEQUENCE');
  const kids = list(bytes, root);
  if (!kids.length || kids[0].tag !== 0x30) throw Error('TSR has no PKIStatusInfo');
  const statusInfo = kids[0];
  const statusKids = list(bytes, statusInfo);
  const status = statusKids.length ? intValue(statusKids[0]) : -1;
  const failBits = statusKids.find((node) => node.tag === 0x03);
  let failInfo = null;
  if (failBits && failBits.content.length > 1) {
    const bits = failBits.content[1];
    for (let index = 0; index < 8; index++) {
      if (bits & (0x80 >> index)) {
        failInfo = FAIL_INFO[index] || 'failInfo(' + index + ')';
        break;
      }
    }
  }
  const tokenNode = kids.length > 1 && kids[1].tag === 0x30 ? kids[1] : null;
  const result = {
    status,
    statusText: STATUS_TEXT[status] || 'unknown(' + status + ')',
    granted: status === 0 || status === 1,
    failInfo,
    token: null,
  };
  if (!tokenNode) return result;
  const tokenDer = Buffer.from(tokenNode.raw);
  const info = extractTstInfo(tokenDer);
  const expected = digestHex ? normalizeDigest(digestHex, normalizeAlgorithm(algorithm)) : '';
  result.token = {
    bytes: tokenDer.length,
    sha256: crypto.createHash('sha256').update(tokenDer).digest('hex'),
    genTime: info ? info.genTime : null,
    serialNumber: info ? info.serialNumber : null,
    imprint: info ? info.digestHex : null,
    imprintMatches: Boolean(expected && info && info.digestHex === expected),
    der: tokenDer,
  };
  return result;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
function normalizeUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw Error('Invalid TSA URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw Error('TSA URL must be http(s)');
  if (parsed.username || parsed.password) throw Error('TSA URL must not contain credentials');
  return parsed.toString();
}
// POST application/timestamp-query → application/timestamp-reply.
async function stampOne({ url, digestHex, algorithm = 'SHA256', nonce, timeoutMs = 10000 } = {}) {
  if (typeof fetch !== 'function') throw Error('fetch is not available in this runtime');
  const target = normalizeUrl(url);
  const request = buildRequest({ digestHex, algorithm, nonce });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(60000, Number(timeoutMs) || 10000)));
  let response;
  try {
    response = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/timestamp-query',
        accept: 'application/timestamp-reply',
      },
      body: request.der,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_REPLY_BYTES) throw Error('TSA reply is too large');
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!response.ok) {
    const error = Error(`TSA answered HTTP ${response.status}`);
    error.status = 502;
    error.tsaStatus = response.status;
    throw error;
  }
  if (contentType && !contentType.startsWith('application/timestamp-reply')) {
    const error = Error('Unexpected TSA content type: ' + contentType);
    error.status = 502;
    throw error;
  }
  const parsed = parseResponse(body, { digestHex: request.digestHex, algorithm: request.algorithm });
  return {
    url: target,
    algorithm: request.algorithm,
    digest: request.digestHex,
    nonce: request.nonceHex,
    requestBytes: request.der.length,
    replyBytes: body.length,
    status: parsed.status,
    statusText: parsed.statusText,
    granted: parsed.granted,
    failInfo: parsed.failInfo,
    token: parsed.token
      ? {
          bytes: parsed.token.bytes,
          sha256: parsed.token.sha256,
          genTime: parsed.token.genTime,
          serialNumber: parsed.token.serialNumber,
          imprintMatches: parsed.token.imprintMatches,
        }
      : null,
    tokenDer: parsed.token ? parsed.token.der : null,
  };
}

// ── Circuit breaker ──────────────────────────────────────────────────────────
// TSA, който не отговаря, не бива да изяжда всяка заявка: след N последователни
// неуспеха адресът се пропуска за cooldown периода и веднага се минава към
// следващия (резервираността остава). Състоянието живее в процеса и се нулира
// при рестарт; TSA_BREAKER_THRESHOLD / TSA_BREAKER_COOLDOWN_MS го настройват.
const breaker = new Map();
const clampInt = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
const breakThreshold = () => clampInt(process.env.TSA_BREAKER_THRESHOLD, 1, 50, 3);
const breakCooldownMs = () =>
  clampInt(process.env.TSA_BREAKER_COOLDOWN_MS, 1000, 6 * 60 * 60 * 1000, 60 * 1000);
function breakerEntry(url) {
  const entry = breaker.get(url);
  if (!entry) return null;
  if (entry.openedUntil && entry.openedUntil <= Date.now()) {
    breaker.delete(url);
    return null;
  }
  return entry;
}
function breakerOpen(url) {
  const entry = breakerEntry(url);
  return Boolean(entry && entry.openedUntil > Date.now());
}
function recordFailure(url) {
  const entry = breaker.get(url) || { fails: 0, openedUntil: 0 };
  entry.fails += 1;
  if (entry.fails >= breakThreshold()) {
    entry.openedUntil = Date.now() + breakCooldownMs();
    entry.fails = 0;
  }
  breaker.set(url, entry);
  return entry;
}
function recordSuccess(url) {
  breaker.delete(url);
}
function resetBreaker(url) {
  if (url) breaker.delete(String(url));
  else breaker.clear();
}
function breakerSnapshot() {
  return [...breaker.entries()].map(([url, entry]) => ({
    url,
    fails: entry.fails,
    open: entry.openedUntil > Date.now(),
    retryAt: entry.openedUntil ? new Date(entry.openedUntil).toISOString() : null,
  }));
}
// Резервираност: списък от TSA адреси ("a,b" или масив) се опитва по ред;
// първият успешен отговор печели, а неуспешните остават в attempts за журнала.
async function stamp(options = {}) {
  const raw = Array.isArray(options.url) ? options.url : String(options.url || '').split(',');
  const urls = raw.map((value) => String(value).trim()).filter(Boolean);
  if (!urls.length) throw Object.assign(Error('No TSA URL configured'), { status: 400 });
  const attempts = [];
  let lastError = null;
  let skipped = 0;
  for (const url of urls) {
    // Отворен предпазител: адресът се прескача, но останалите продължават.
    if (breakerOpen(url)) {
      skipped += 1;
      attempts.push({ url, ok: false, skipped: true, error: 'circuit open' });
      continue;
    }
    try {
      const result = await stampOne({ ...options, url });
      recordSuccess(url);
      return {
        ...result,
        attempts: [...attempts, { url: result.url, ok: true }],
        breaker: breakerSnapshot(),
      };
    } catch (e) {
      recordFailure(url);
      attempts.push({ url, ok: false, error: e.message });
      lastError = e;
    }
  }
  if (!lastError && skipped) {
    const openError = Object.assign(Error(`All TSA endpoints are in cooldown (${skipped})`), {
      status: 503,
      code: 'TSA_CIRCUIT_OPEN',
    });
    openError.attempts = attempts;
    openError.breaker = breakerSnapshot();
    throw openError;
  }
  const error = lastError || Error('TSA request failed');
  if (!error.status) error.status = 502;
  error.attempts = attempts;
  error.breaker = breakerSnapshot();
  throw error;
}

module.exports = {
  ALGORITHMS,
  STATUS_TEXT,
  buildRequest,
  parseResponse,
  parseTstInfo,
  stamp,
  stampOne,
  breakerSnapshot,
  resetBreaker,
  normalizeAlgorithm,
  normalizeDigest,
  normalizeUrl,
};
