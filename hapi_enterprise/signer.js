'use strict';
// Подпис + timestamp (Фаза 3.3): HMAC-SHA256 над SHA-256 хеша на файла.
// PKCS#7 (detached signature с X.509) остава за по-късен етап.
const crypto = require('node:crypto');
// Сравнение на подписи в постоянно време. Приема низ или буфер; липсваща
// стойност не е равна на нищо.
const toCompare = (v) => (Buffer.isBuffer(v) ? v : typeof v === 'string' ? Buffer.from(v, 'utf8') : null);
const safeEqual = (a, b) => {
  const x = toCompare(a), y = toCompare(b);
  return !!x && !!y && x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};
const canonical = r => `${r.algorithm}\n${r.fileId}\n${r.name}\n${r.sha256}\n${r.size}\n${r.timestamp}`;

function sign({ fileId, name, sha256, size, secret, now }) {
  const receipt = { algorithm: 'HMAC-SHA256', fileId, name, sha256, size, timestamp: now || new Date().toISOString() };
  receipt.signature = crypto.createHmac('sha256', secret).update(canonical(receipt)).digest('hex');
  return receipt;
}

function verify(receipt, secret) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return { valid: false, reason: 'INVALID_RECEIPT' };
  if (receipt.algorithm !== 'HMAC-SHA256') return { valid: false, reason: 'UNSUPPORTED_ALGORITHM' };
  if (typeof receipt.fileId !== 'string' || typeof receipt.name !== 'string' || typeof receipt.sha256 !== 'string' ||
    !Number.isSafeInteger(receipt.size) || typeof receipt.timestamp !== 'string' || typeof receipt.signature !== 'string') {
    return { valid: false, reason: 'MISSING_FIELD' };
  }
  if (!/^[a-f0-9]{64}$/.test(receipt.signature)) return { valid: false, reason: 'INVALID_SIGNATURE' };
  const expected = crypto.createHmac('sha256', secret).update(canonical(receipt)).digest('hex');
  if (!safeEqual(expected, receipt.signature)) return { valid: false, reason: 'SIGNATURE_MISMATCH' };
  return { valid: true };
}

module.exports = { sign, verify, canonical };
