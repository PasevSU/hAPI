'use strict';
// „Бърз линк“ (Send-lite): еднократен/срочен/безсрочен публичен достъп до ЕДИН файл,
// без портал, без ключ и без имейл в отговора.
//
// Разлики спрямо Bitwarden/Vaultwarden Send (съзнателни):
//   1. Срокът НЕ е задължителен — по подразбиране линкът е безсрочен, както порталите.
//   2. Няма дълготраен токен в URL. Изтеглянето минава през еднократен билет с
//      TTL 60 секунди, издаден след проверка (и евентуална парола).
//   3. Подателят/имейлът никога не се показва на получателя.
//
// Модулът е чист (без I/O): състоянието живее върху файла (`f.sends`) и се записва
// от server.js през update(), за да остане единственият писател на базата.

const crypto = require('node:crypto');

// Crockford base32 без I, L, O, U — 22 знака ≈ 110 бита ентропия.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_LENGTH = 22;
const TICKET_TTL_MS = 60_000;
const SCRYPT_KEYLEN = 32;

/** Генерира непрозрачен идентификатор на линк (напр. `9B7T93D8SH2HxaqQdD7VpQ`-подобен). */
function newId(bytes = crypto.randomBytes(ID_LENGTH)) {
  let out = '';
  for (let i = 0; i < ID_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const nowMs = (now) => (typeof now === 'function' ? now() : Date.now());

/** scrypt хеш на паролата; солта се пази до хеша, за да може да се провери по-късно. */
function hashPassphrase(passphrase, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(String(passphrase), salt, SCRYPT_KEYLEN);
  return { salt: salt.toString('base64'), hash: hash.toString('base64'), algo: 'scrypt', keylen: SCRYPT_KEYLEN };
}

/** Постоянно-времева проверка на паролата. Без запазен хеш (без парола) → true. */
function verifyPassphrase(passphrase, rec) {
  const stored = rec && rec.pass;
  if (!stored || !stored.salt || !stored.hash) return true;
  if (typeof passphrase !== 'string' || !passphrase) return false;
  let derive;
  try { derive = crypto.scryptSync(passphrase, Buffer.from(stored.salt, 'base64'), Number(stored.keylen) || SCRYPT_KEYLEN) }
  catch { return false }
  const expected = Buffer.from(stored.hash, 'base64');
  return derive.length === expected.length && crypto.timingSafeEqual(derive, expected);
}

const isProtected = (rec) => Boolean(rec && rec.pass && rec.pass.hash);
const isExpired = (rec, now) => Boolean(rec && rec.expiresAt && Date.parse(rec.expiresAt) <= nowMs(now));
const isExhausted = (rec) => Boolean(rec && Number(rec.maxAccess) > 0 && Number(rec.accessCount || 0) >= Number(rec.maxAccess));

/** Единственото място, което решава дали един линк още работи. */
function canAccess(rec, now) {
  if (!rec) return { ok: false, reason: 'missing' };
  if (rec.disabled) return { ok: false, reason: 'revoked' };
  if (isExpired(rec, now)) return { ok: false, reason: 'expired' };
  if (isExhausted(rec)) return { ok: false, reason: 'exhausted' };
  return { ok: true, reason: 'ok' };
}

/** Нов запис на линк. `expiresAt: null` = безсрочен (подразбиране). */
function createRecord({ expiresAt = null, maxAccess = 0, passphrase = '' } = {}, now) {
  const at = new Date(nowMs(now)).toISOString();
  const rec = {
    id: newId(),
    createdAt: at,
    // Безсрочният линк е нормален режим, не изключение.
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    maxAccess: Number.isFinite(Number(maxAccess)) && Number(maxAccess) > 0 ? Math.trunc(Number(maxAccess)) : 0,
    accessCount: 0,
    lastAccessAt: null,
    disabled: false,
    pass: null,
  };
  if (typeof passphrase === 'string' && passphrase.length) rec.pass = hashPassphrase(passphrase);
  return rec;
}

/** Всичко, което може да се покаже на администратора — никога хеша/солта. */
function adminView(rec) {
  return {
    id: rec.id,
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt || null,
    maxAccess: Number(rec.maxAccess || 0),
    accessCount: Number(rec.accessCount || 0),
    lastAccessAt: rec.lastAccessAt || null,
    disabled: Boolean(rec.disabled),
    protected: isProtected(rec),
    url: require('./links').sendPath(rec.id),
  };
}

function sign(secret, payload) {
  return crypto.createHmac('sha256', String(secret)).update(payload).digest('base64url');
}

/**
 * Еднократен билет за сваляне: `<payload>.<hmac>`.
 * Payload носи само send id + file id + срок — без парола и без път.
 */
function mintTicket({ sendId, fileId, secret, now, ttlMs = TICKET_TTL_MS }) {
  const exp = nowMs(now) + ttlMs;
  const payload = Buffer.from(JSON.stringify({ s: sendId, f: fileId, e: exp, j: crypto.randomBytes(9).toString('base64url') })).toString('base64url');
  return { ticket: payload + '.' + sign(secret, payload), expiresAt: new Date(exp).toISOString() };
}

/** Проверява подписа и срока. Връща `{ sendId, fileId }` или null. */
function verifyTicket(ticket, secret, now) {
  if (typeof ticket !== 'string' || ticket.length > 512) return null;
  const dot = ticket.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = ticket.slice(0, dot), signature = ticket.slice(dot + 1);
  const expected = sign(secret, payload);
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let claims;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) } catch { return null }
  if (!claims || typeof claims.s !== 'string' || typeof claims.f !== 'string') return null;
  if (!Number.isFinite(claims.e) || claims.e <= nowMs(now)) return null;
  return { sendId: claims.s, fileId: claims.f, expiresAt: claims.e, nonce: claims.j };
}

module.exports = {
  ALPHABET,
  ID_LENGTH,
  TICKET_TTL_MS,
  newId,
  hashPassphrase,
  verifyPassphrase,
  isProtected,
  isExpired,
  isExhausted,
  canAccess,
  createRecord,
  adminView,
  mintTicket,
  verifyTicket,
};
