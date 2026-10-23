'use strict';
// L2: криптирана работна папка (бач B4 от `PLAN-0.69.67-LINKS-AND-FILES.md`).
//
// Какво пази: файловете в папката на портала (`<storage_root>/<slug>`) — там, където
// потребителят вижда имената през SMB/HA. Без частния ключ съдържанието е нечетимо.
//
// Защо хибридно: PGP върху цял файл е бавен за големи файлове. Затова съдържанието се
// криптира симетрично (AES-256-GCM на парчета по 1 MiB), а ключът за файла (DEK) се
// обвива с PGP до ключа `encrypt-storage`. Форматът е собствен контейнер, защото трябва
// да пази и ОРИГИНАЛНИЯ размер (иначе дървото на папката показва размера на шифротекста).
//
// Контейнер:
//   magic "HAPIW1"  | версия 1 | uint64 размер на откритите данни | uint32 дължина на DEK
//   armored PGP съобщение с DEK (base64 вътре) | парчета: uint32 дълж. | ciphertext | tag 16
// AAD за всяко парче е целият заглавен блок → подмяна на заглавката се хваща от GCM.
const crypto = require('node:crypto');

const MAGIC = Buffer.from('HAPIW1', 'utf8');
const VERSION = 1;
const CHUNK = 1024 * 1024; // 1 MiB на парче: паметта е ограничена, а файловете растат
const TAG = 16;

const fail = (code, message, status) => Object.assign(new Error(message), { code, status: status || 422 });

/** Има ли буферът нашата заглавка (значи е криптиран от hAPI). */
const isSealed = (buf) => Buffer.isBuffer(buf) && buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);

/** Колко е ОРИГИНАЛНИЯТ размер според заглавката; `null`, когато не е наш контейнер. */
function plainSize(buf) {
  if (!isSealed(buf) || buf.length < MAGIC.length + 13) return null;
  return Number(buf.readBigUInt64BE(MAGIC.length + 1));
}

const headerOf = (plainLength, wrapped) => {
  const head = Buffer.alloc(MAGIC.length + 1 + 8 + 4);
  MAGIC.copy(head, 0);
  head.writeUInt8(VERSION, MAGIC.length);
  head.writeBigUInt64BE(BigInt(plainLength), MAGIC.length + 1);
  head.writeUInt32BE(wrapped.length, MAGIC.length + 1 + 8);
  return Buffer.concat([head, wrapped]);
};

/**
 * Криптира данни. Връща контейнер (Buffer). Хвърля `PGP_SECRET_KEY_REQUIRED`, когато
 * няма ключ — „криптирано без ключ“ е точно това, което не бива да се случва.
 */
function seal(data, keyring) {
  const plain = Buffer.isBuffer(data) ? data : Buffer.from(String(data == null ? '' : data), 'utf8');
  const dek = crypto.randomBytes(32);
  // DEK-ът се обвива с ключа, но НЕ през L1 политиката: L2 не изисква `pgp_encrypt_paths`.
  const wrapped = Buffer.from(keyring.wrapSecret(dek.toString('base64')), 'utf8');
  const header = headerOf(plain.length, wrapped);
  const parts = [header];
  for (let offset = 0, index = 0; offset < plain.length || index === 0; offset += CHUNK, index++) {
    const piece = plain.subarray(offset, Math.min(offset + CHUNK, plain.length));
    // Nonce: 8 случайни байта (веднъж за файла) + номерът на парчето, за да е уникален.
    const nonce = Buffer.alloc(12);
    header.copy(nonce, 0, MAGIC.length + 1, MAGIC.length + 9); // производни от заглавката
    nonce.writeUInt32BE(index, 8);
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, nonce);
    cipher.setAAD(header);
    const body = Buffer.concat([cipher.update(piece), cipher.final()]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(piece.length, 0);
    parts.push(len, body, cipher.getAuthTag());
    if (plain.length === 0) break;
  }
  return Buffer.concat(parts);
}

/** Декриптира контейнер; хвърля `WORKDIR_LOCKED` без ключ и `WORKDIR_CORRUPT` при подмяна. */
function open(buffer, keyring) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!isSealed(buf)) throw fail('WORKDIR_NOT_SEALED', 'Файлът не е криптиран от hAPI');
  if (buf.readUInt8(MAGIC.length) !== VERSION) throw fail('WORKDIR_VERSION', 'Неподдържана версия на контейнера');
  const plainLength = plainSize(buf);
  const dekLength = buf.readUInt32BE(MAGIC.length + 1 + 8);
  const wrappedEnd = MAGIC.length + 1 + 8 + 4 + dekLength;
  if (wrappedEnd > buf.length) throw fail('WORKDIR_CORRUPT', 'Отрязан контейнер (липсва ключ)');
  const header = buf.subarray(0, wrappedEnd);
  let dek;
  try {
    dek = Buffer.from(keyring.unwrapSecret(buf.subarray(MAGIC.length + 1 + 8 + 4, wrappedEnd).toString('utf8')), 'base64');
  } catch (err) {
    throw fail('WORKDIR_LOCKED', 'Файлът е криптиран, но ключът не е достъпен: ' + ((err && err.code) || 'unknown'), 503);
  }
  const out = [];
  let at = wrappedEnd;
  let index = 0;
  while (at < buf.length) {
    if (at + 4 > buf.length) throw fail('WORKDIR_CORRUPT', 'Отрязан контейнер (липсва дължина)');
    const length = buf.readUInt32BE(at);
    at += 4;
    const end = at + length + TAG;
    if (end > buf.length) throw fail('WORKDIR_CORRUPT', 'Отрязан контейнер (липсва парче)');
    const nonce = Buffer.alloc(12);
    header.copy(nonce, 0, MAGIC.length + 1, MAGIC.length + 9);
    nonce.writeUInt32BE(index, 8);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', dek, nonce);
      decipher.setAAD(header);
      decipher.setAuthTag(buf.subarray(at + length, end));
      out.push(Buffer.concat([decipher.update(buf.subarray(at, at + length)), decipher.final()]));
    } catch {
      throw fail('WORKDIR_CORRUPT', 'Съдържанието е подменено (GCM проверката не минава)');
    }
    at = end;
    index++;
  }
  const plain = Buffer.concat(out);
  if (plain.length !== plainLength) throw fail('WORKDIR_CORRUPT', 'Размерът в заглавката не отговаря на съдържанието');
  return plain;
}

module.exports = { seal, open, isSealed, plainSize, MAGIC, CHUNK, VERSION };
