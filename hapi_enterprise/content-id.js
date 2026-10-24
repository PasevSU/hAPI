'use strict';
// Идентичност на СЪДЪРЖАНИЕТО (`content_id`) — §11 и §12 от HAPI-ARCH-API-001.
//
// Защо е нужно: име на файл не е идентичност. Ако „договор.pdf“ бъде подменен, името остава
// същото, а байтовете — не. Затова всяка версия получава собствен `content_id`, който зависи
// САМО от портала, SHA-256 и размера:
//
//   content_id = 'CT-' + sha256(portal_id + '\n' + sha256 + '\n' + size)[0..32]
//
// Следствия (точно това иска планът):
//   • същите байтове в същия портал → същият `content_id` (проверимо, без регистър);
//   • различни байтове → различен `content_id`, дори името да е същото;
//   • нов `content_id` не пренаписва стария: старият остава в манифеста и архива.
// Модулът е чист (без I/O и без време), за да е еднакъв резултатът навсякъде.
const crypto = require('node:crypto');

/** Правилото, което identity-то пази (ползва се от тестовете и документацията). */
const CODE = 'IMMUTABLE_CONTENT_ID';
const PREFIX = 'CT-';
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * `content_id` за дадено съдържание или `null`, ако липсва нещо задължително.
 * Липсващите данни НЕ се гадаят: по-добре `null`, отколкото идентичност, която не е вярна.
 */
function of(value) {
  const input = value || {};
  const portalId = String(input.portalId || '').trim();
  const digest = typeof input.sha256 === 'string' ? input.sha256.toLowerCase() : '';
  const size = Number(input.size);
  if (!portalId || !HEX64.test(digest) || !Number.isFinite(size) || size < 0) return null;
  const body = crypto.createHash('sha256').update(portalId + '\n' + digest + '\n' + size).digest('hex');
  return PREFIX + body.slice(0, 32);
}

/**
 * `content_id` на регистриран файл: записаният (`f.contentId`) печели, за да не се променя
 * идентичността на вече публикувано съдържание; за стари записи се смята от хеша и размера.
 */
function forFile(portal, file) {
  const f = file || {};
  if (typeof f.contentId === 'string' && f.contentId.startsWith(PREFIX)) return f.contentId;
  return of({ portalId: portal && portal.id, sha256: f.sha256, size: f.size });
}

module.exports = { CODE, PREFIX, of, forFile };
