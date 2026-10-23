'use strict';
// Криптиран контейнер за експортен пакет (hapiPKG1).
//
// Защо собствен контейнер, а не ZIP с парола: ZIP криптирането (ZipCrypto) е чупливо,
// а AES в ZIP (WinZip AE-1/2) не се поддържа от `unzip` и от `node:zlib`. Затова
// пакетът се криптира ЦЯЛОСТНО със стандартни примитиви на `node:crypto` и носи
// всичко нужно за разшифроване в собствения си хедър — получателят не зависи от нас.
//
// Формат (big-endian, фиксиран хедър от 50 байта):
//   [0..7]   'hapiPKG1'      магия
//   [8]      версия = 1
//   [9]      KDF    = 1      (scrypt)
//   [10..13] N               цена на scrypt (2^14)
//   [14..17] r               размер на блок (8)
//   [18..21] p               паралелизъм (1)
//   [22..37] salt (16 B)
//   [38..49] iv (12 B)
//   [50..65] authTag (16 B)  GCM
//   [66..]   ciphertext      AES-256-GCM върху ZIP-а
//
// Хедърът е AAD: ако някой свали N или смени salt/iv, tag-ът не се проверява и
// разшифроването се проваля — тоест параметрите не могат да бъдат подменени.
const crypto = require('node:crypto');

const MAGIC = Buffer.from('hapiPKG1', 'ascii');
const MAGIC_LEN = MAGIC.length;
const VERSION = 1;
const KDF_SCRYPT = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC_LEN + 1 + 1 + 4 + 4 + 4 + SALT_LEN + IV_LEN; // 50
const TAG_OFFSET = HEADER_LEN;
const BODY_OFFSET = HEADER_LEN + TAG_LEN; // 66
const KEY_LEN = 32; // AES-256

// scrypt N=2^14, r=8, p=1 → ~16 MiB и ~50 ms на ядро: достатъчно скъпо за отгатване
// на парола и достатъчно евтино за add-on на Raspberry Pi.
const PARAMS = { N: 16384, r: 8, p: 1 };

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 1024;

const fail = (message, status) => Object.assign(new Error(message), { status: status || 400, code: status === 401 ? 'AUTH_FAILED' : 'BAD_CONTAINER' });

function assertPassword(password) {
  const value = String(password == null ? '' : password);
  if (value.length < MIN_PASSWORD) throw fail(`Паролата трябва да е поне ${MIN_PASSWORD} знака`);
  if (value.length > MAX_PASSWORD) throw fail(`Паролата е по-дълга от ${MAX_PASSWORD} знака`);
  return value;
}

function derive(password, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, KEY_LEN, {
      N: params.N,
      r: params.r,
      p: params.p,
      // maxmem се задава изрично: подразбирането (32 MiB) е точно на ръба за N=2^14·r=8.
      maxmem: 128 * params.N * params.r * 2,
    }, (err, key) => (err ? reject(fail('Грешка при извличане на ключ: ' + err.message, 500)) : resolve(key)));
  });
}

function isContainer(buf) {
  return Buffer.isBuffer(buf) && buf.length >= BODY_OFFSET && buf.subarray(0, MAGIC_LEN).equals(MAGIC);
}

function describe() {
  return {
    container: MAGIC.toString('ascii'),
    version: VERSION,
    cipher: 'AES-256-GCM',
    kdf: 'scrypt',
    params: { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, keyLen: KEY_LEN },
    saltBytes: SALT_LEN,
    ivBytes: IV_LEN,
    tagBytes: TAG_LEN,
    headerBytes: HEADER_LEN,
    overheadBytes: BODY_OFFSET,
  };
}

/** Криптира произволен буфер; връща целия контейнер (хедър + tag + шифротекст). */
async function encrypt(data, password) {
  const secret = assertPassword(password);
  if (!Buffer.isBuffer(data)) throw fail('Липсват данни за криптиране', 500);
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const header = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(header, 0);
  header.writeUInt8(VERSION, MAGIC_LEN);
  header.writeUInt8(KDF_SCRYPT, MAGIC_LEN + 1);
  header.writeUInt32BE(PARAMS.N, MAGIC_LEN + 2);
  header.writeUInt32BE(PARAMS.r, MAGIC_LEN + 6);
  header.writeUInt32BE(PARAMS.p, MAGIC_LEN + 10);
  salt.copy(header, MAGIC_LEN + 14);
  iv.copy(header, MAGIC_LEN + 14 + SALT_LEN);
  const key = await derive(secret, salt, PARAMS);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([header, cipher.getAuthTag(), body]);
}

/** Чете параметрите от хедъра без да разшифрова (за `--info` и за диагностика). */
function info(buf) {
  if (!isContainer(buf)) throw fail('Файлът не е hapiPKG1 контейнер');
  const version = buf.readUInt8(MAGIC_LEN);
  if (version !== VERSION) throw fail(`Неподдържана версия на контейнера: ${version}`);
  const kdf = buf.readUInt8(MAGIC_LEN + 1);
  if (kdf !== KDF_SCRYPT) throw fail(`Неподдържан KDF: ${kdf}`);
  const params = {
    N: buf.readUInt32BE(MAGIC_LEN + 2),
    r: buf.readUInt32BE(MAGIC_LEN + 6),
    p: buf.readUInt32BE(MAGIC_LEN + 10),
  };
  // Границите пазят от контейнер, който иска гигабайти памет при разшифроване.
  const pow2 = (n) => n > 0 && (n & (n - 1)) === 0;
  if (!pow2(params.N) || params.N < 1024 || params.N > 1048576) throw fail('Невалидна цена на scrypt в контейнера');
  if (params.r < 1 || params.r > 32 || params.p < 1 || params.p > 16) throw fail('Невалидни scrypt параметри в контейнера');
  return {
    container: MAGIC.toString('ascii'),
    version,
    cipher: 'AES-256-GCM',
    kdf: 'scrypt',
    params,
    headerBytes: HEADER_LEN,
    bodyBytes: buf.length - BODY_OFFSET,
  };
}

/** Разшифрова контейнер; грешна парола или подправен байт → AUTH_FAILED. */
async function decrypt(buf, password) {
  const secret = assertPassword(password);
  info(buf);
  const iv = buf.subarray(MAGIC_LEN + 14 + SALT_LEN, HEADER_LEN);
  const salt = buf.subarray(MAGIC_LEN + 14, MAGIC_LEN + 14 + SALT_LEN);
  const header = buf.subarray(0, HEADER_LEN);
  const tag = buf.subarray(TAG_OFFSET, BODY_OFFSET);
  const body = buf.subarray(BODY_OFFSET);
  const key = await derive(secret, salt, info(buf).params);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw fail('Грешна парола или подправен контейнер', 401);
  }
}

/** Случайна парола от 24 знака без двусмислени символи (0/O, 1/l/I). */
function generatePassword(length) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const size = Number.isInteger(length) && length >= MIN_PASSWORD ? length : 24;
  let out = '';
  while (out.length < size) {
    for (const byte of crypto.randomBytes(size)) {
      if (out.length >= size) break;
      // Отхвърля стойностите над последното кратно на азбуката, за да няма отклонение.
      if (byte < 256 - (256 % alphabet.length)) out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}

module.exports = {
  MAGIC,
  MIN_PASSWORD,
  MAX_PASSWORD,
  encrypt,
  decrypt,
  info,
  describe,
  isContainer,
  generatePassword,
};
