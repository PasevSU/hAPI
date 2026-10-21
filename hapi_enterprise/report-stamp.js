'use strict';
// Фаза 11 / RS-05: реален RFC 3161 обхват върху отчет от Report Studio.
//
// Конвенцията е същата като на `POST /admin/api/v2/rfc3161` и на HASH_REPORT генератора:
//   • START подпечатва digest на манифеста (`report-manifest.digest`, каноничен JSON);
//   • STOP подпечатва затварящия хеш `sha256("<START digest>|<START token sha256>")`,
//     т.е. обвързан е с конкретния START токен, а не само с документа.
// Затова верификатор може да преизчисли и двете стойности от самия отчет.
//
// Без TSA обаждане нито едно поле не се измисля: всички стойности остават
// „not established“, а статусът казва защо (ADR-0025, т. 5). Функцията никога не
// хвърля заради отказ на TSA — връща обект, в който провалът е видим.

const crypto = require('node:crypto');
const M = require('./report-manifest');
const tsaClient = require('./tsa-client');

const NOT_REQUESTED = 'NOT REQUESTED — no TSA call was made in this run';
const NOT_ESTABLISHED = 'not established — no TSA call in this run';
const NOT_ESTABLISHED_FAILED = 'not established — the TSA call did not produce a token';
const TOKEN_FORMAT = 'RFC 3161 TimeStampToken (DER, application/timestamp-reply)';
const BINDING = 'SHA-256 of the report manifest (canonical JSON, report-manifest.digest)';

const lower = (value) => String(value || '').toLowerCase();
const upper = (value) => (value ? String(value).toUpperCase() : '');

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

// Затварящият хеш на обхвата. Същият низ изчислява и `POST /rfc3161` за phase=stop,
// за да сочат отчетът и записаният .tsr към едно и също нещо.
function closingDigest(startDigest, startTokenSha256) {
  return sha256Text(lower(startDigest) + '|' + lower(startTokenSha256));
}
function algorithmOr(value) {
  try {
    return tsaClient.normalizeAlgorithm(value || 'SHA256');
  } catch {
    return null;
  }
}

// ── Полета в стила на генератора ────────────────────────────────────────────
function startFields(evidenceDigest, record) {
  const evidence = upper(evidenceDigest) || 'not established — the manifest digest was not computed';
  const rows = [
    ['Marker', 'START'],
    ['START Binding', BINDING],
    ['Evidence-Set SHA-256', evidence],
  ];
  if (!record) {
    return rows.concat([
      ['Message Imprint (SHA-256)', NOT_ESTABLISHED],
      ['Nonce', NOT_ESTABLISHED],
      ['TSA URL', NOT_ESTABLISHED],
      ['TSA genTime', NOT_ESTABLISHED],
      ['Token Format', NOT_ESTABLISHED],
      ['Token SHA-256', NOT_ESTABLISHED],
      ['Verification Status', NOT_REQUESTED],
    ]);
  }
  const token = record.token;
  return rows.concat([
    ['Message Imprint (SHA-256)', upper(record.digest) || NOT_ESTABLISHED_FAILED],
    ['Nonce', record.nonce || NOT_ESTABLISHED_FAILED],
    ['TSA URL', record.url || NOT_ESTABLISHED_FAILED],
    ['TSA genTime', (token && token.genTime) || NOT_ESTABLISHED_FAILED],
    ['Token Format', token ? TOKEN_FORMAT : NOT_ESTABLISHED_FAILED],
    ['Token SHA-256', token ? upper(token.sha256) : NOT_ESTABLISHED_FAILED],
    ['Verification Status', verificationText(record)],
  ]);
}

function stopFields(evidenceDigest, closing, record, startTokenSha256) {
  const evidence = upper(evidenceDigest) || 'not established — the manifest digest was not computed';
  const rows = [
    ['Marker', 'STOP'],
    ['Evidence-Set SHA-256', evidence],
    ['STOP Closing Message Imprint', upper(closing) || NOT_ESTABLISHED],
    ['START Anchor Used by STOP', upper(startTokenSha256) || NOT_ESTABLISHED],
  ];
  if (!record) {
    return rows.concat([
      ['TSA URL', NOT_ESTABLISHED],
      ['TSA genTime', NOT_ESTABLISHED],
      ['Token SHA-256', NOT_ESTABLISHED],
      ['Verification Status', NOT_REQUESTED],
    ]);
  }
  const token = record.token;
  return rows.concat([
    ['TSA URL', record.url || NOT_ESTABLISHED_FAILED],
    ['TSA genTime', (token && token.genTime) || NOT_ESTABLISHED_FAILED],
    ['Token SHA-256', token ? upper(token.sha256) : NOT_ESTABLISHED_FAILED],
    ['Verification Status', verificationText(record)],
  ]);
}

function verificationText(record) {
  if (record.skipped) return `NOT REQUESTED — ${record.error || 'an earlier phase did not succeed'}`;
  // Токен с чужд imprint се показва (знаем какво е пристигнало), но не се брои за успех.
  if (record.token && record.token.imprintMatches === false) {
    return 'REJECTED — the returned token does not carry our message imprint';
  }
  if (record.ok && record.token) {
    return `granted — TSA status ${record.status} (${record.statusText}), message imprint matches`;
  }
  return `FAILED — ${record.error || 'the TSA call did not produce a token'}`;
}

// ── Нормализиране на отговора на клиента ────────────────────────────────────
function normalizeRecord(phase, result) {
  const token = result && result.token ? result.token : null;
  const granted = Boolean(result && result.granted);
  const ok = granted && Boolean(token) && token.imprintMatches !== false;
  return {
    phase,
    ok,
    skipped: false,
    url: (result && result.url) || '',
    digest: (result && result.digest) || '',
    nonce: (result && result.nonce) || '',
    algorithm: (result && result.algorithm) || '',
    status: result ? result.status : null,
    statusText: (result && result.statusText) || '',
    failInfo: (result && result.failInfo) || null,
    attempts: (result && result.attempts) || [],
    token: token
      ? {
        sha256: lower(token.sha256),
        genTime: token.genTime || null,
        serialNumber: token.serialNumber || null,
        bytes: token.bytes || 0,
        imprintMatches: token.imprintMatches !== false,
      }
      : null,
    tokenDer: (result && result.tokenDer) || null,
    error: ok
      ? null
      : granted
        ? 'the returned token does not carry our message imprint'
        : `TSA refused the timestamp: ${(result && result.statusText) || 'unknown status'}`,
  };
}

function failedRecord(phase, error, url) {
  return {
    phase,
    ok: false,
    skipped: false,
    url: url || '',
    digest: '',
    nonce: '',
    algorithm: '',
    status: null,
    statusText: '',
    failInfo: null,
    attempts: (error && error.attempts) || [],
    token: null,
    tokenDer: null,
    error: (error && error.message) || 'TSA request failed',
  };
}

function skippedRecord(phase, reason) {
  return {
    phase,
    ok: false,
    skipped: true,
    url: '',
    digest: '',
    nonce: '',
    algorithm: '',
    status: null,
    statusText: '',
    failInfo: null,
    attempts: [],
    token: null,
    tokenDer: null,
    error: reason,
  };
}

// ── Публично API ────────────────────────────────────────────────────────────
// options: { startUrl, stopUrl, algorithm, timeoutMs, stamp }
//   stamp — инжектируем заместител на tsaClient.stamp (тестове, офлайн среди).
async function stampReport(manifest, options = {}) {
  const evidenceDigest = M.digest(manifest);
  const algorithm = algorithmOr(options.algorithm);
  const startUrl = String(options.startUrl || '').trim();
  const stopUrl = String(options.stopUrl || '').trim() || startUrl;

  if (!evidenceDigest) {
    const error = 'manifest digest is unavailable in this runtime';
    return {
      requested: false,
      ok: false,
      algorithm: algorithm || 'SHA256',
      evidenceDigest: null,
      closingDigest: null,
      error,
      start: { ...skippedRecord('start', error), fields: startFields(null, null) },
      stop: { ...skippedRecord('stop', error), fields: stopFields(null, null, null, null) },
    };
  }
  if (!algorithm) {
    const error = 'unsupported RFC 3161 algorithm';
    return {
      requested: false,
      ok: false,
      algorithm: String(options.algorithm || ''),
      evidenceDigest,
      closingDigest: null,
      error,
      start: { ...skippedRecord('start', error), fields: startFields(evidenceDigest, null) },
      stop: { ...skippedRecord('stop', error), fields: stopFields(evidenceDigest, null, null, null) },
    };
  }
  if (!startUrl) {
    return {
      requested: false,
      ok: false,
      algorithm,
      evidenceDigest,
      closingDigest: null,
      error: null,
      start: { ...skippedRecord('start', 'no TSA URL configured'), fields: startFields(evidenceDigest, null) },
      stop: { ...skippedRecord('stop', 'no TSA URL configured'), fields: stopFields(evidenceDigest, null, null, null) },
    };
  }

  const stamp = typeof options.stamp === 'function' ? options.stamp : tsaClient.stamp;
  const common = { algorithm, timeoutMs: options.timeoutMs };

  let start;
  try {
    start = normalizeRecord('start', await stamp({ url: startUrl, digestHex: evidenceDigest, ...common }));
  } catch (e) {
    start = failedRecord('start', e, startUrl);
  }

  let closing = null;
  let stop;
  if (start.ok) {
    closing = closingDigest(evidenceDigest, start.token.sha256);
    try {
      stop = normalizeRecord('stop', await stamp({ url: stopUrl, digestHex: closing, ...common }));
    } catch (e) {
      stop = failedRecord('stop', e, stopUrl);
    }
  } else {
    stop = skippedRecord('stop', 'START did not produce a token, so there was nothing to close');
  }

  return {
    requested: true,
    ok: start.ok && stop.ok,
    algorithm,
    evidenceDigest,
    closingDigest: closing,
    error: start.error || stop.error || null,
    start: { ...start, fields: startFields(evidenceDigest, start) },
    stop: { ...stop, fields: stopFields(evidenceDigest, closing, stop, start.ok ? start.token.sha256 : null) },
  };
}

module.exports = {
  BINDING,
  NOT_REQUESTED,
  TOKEN_FORMAT,
  closingDigest,
  startFields,
  stopFields,
  stampReport,
};
