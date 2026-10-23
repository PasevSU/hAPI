'use strict';
// OpenPGP (RFC 9580 / RFC 4880) — деташиран подпис без външни зависимости.
//
// Обхват (съзнателно тесен и проверим):
//   • ключове: RSA (1/3), EdDSA legacy (22, само четене/проверка), Ed25519 v6 (27),
//     Ed448 v6 (28 — четене/проверка); версии 4 и 6 (RFC 9580);
//   • подпис: binary document (тип 0x00), v4 подпис за v4 ключ, v6 подпис за v6 ключ
//     (salt, 4-октетни дължини, Issuer Fingerprint, без Issuer Key ID), ASCII armor с CRC24;
//   • проверка на подпис с публичен ключ (включително подключове);
//   • криптиране до публичен ключ (PKESK + SEIPD v1 с MDC, AES-256) и декриптиране със
//     секретен ключ, включително ключ, защитен с парола (S2K iterated-salted).
//
// Извън обхвата (връща ясна грешка, не тих fallback):
//   • S2K тип 4 (Argon2) — иска се gpg 2.4+ с `--s2k-mode 3` или ключ без парола;
//   • AEAD/SEIPD v2, ECDH/X25519, генериране на Ed448 ключове.
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const ARMOR = {
  SIGNATURE: ['-----BEGIN PGP SIGNATURE-----', '-----END PGP SIGNATURE-----'],
  PUBLIC: ['-----BEGIN PGP PUBLIC KEY BLOCK-----', '-----END PGP PUBLIC KEY BLOCK-----'],
  PRIVATE: ['-----BEGIN PGP PRIVATE KEY BLOCK-----', '-----END PGP PRIVATE KEY BLOCK-----'],
  MESSAGE: ['-----BEGIN PGP MESSAGE-----', '-----END PGP MESSAGE-----'],
};

const ALGO = {
  1: { id: 1, name: 'RSA', kind: 'rsa', sign: true },
  3: { id: 3, name: 'RSA (sign only)', kind: 'rsa', sign: true },
  18: { id: 18, name: 'ECDH', kind: 'ecdh', sign: false },
  19: { id: 19, name: 'ECDSA', kind: 'ecdsa', sign: true },
  22: { id: 22, name: 'EdDSA (Ed25519)', kind: 'eddsa', sign: true }, // legacy, само v4
  25: { id: 25, name: 'X25519', kind: 'x25519', sign: false },
  26: { id: 26, name: 'X448', kind: 'x448', sign: false },
  27: { id: 27, name: 'Ed25519', kind: 'eddsa', sign: true }, // RFC 9580, v6
  28: { id: 28, name: 'Ed448', kind: 'ed448', sign: true }, // RFC 9580, v6
};
const ED25519_OID = Buffer.from([0x2b, 0x06, 0x01, 0x04, 0x01, 0xda, 0x47, 0x0f, 0x01]);
// Хеш алгоритми по RFC 4880 §9.4 / RFC 9580 §9.5; `salt` е дължината на salt за v6 подпис.
const HASHES = {
  2: { name: 'sha1', label: 'SHA-1', info: '3021300906052b0e03021a05000414', salt: 0 },
  8: { name: 'sha256', label: 'SHA-256', info: '3031300d060960864801650304020105000420', salt: 16 },
  9: { name: 'sha384', label: 'SHA-384', info: '3041300d060960864801650304020205000430', salt: 24 },
  10: { name: 'sha512', label: 'SHA-512', info: '3051300d060960864801650304020305000440', salt: 32 },
  11: { name: 'sha224', label: 'SHA-224', info: '302d300d06096086480165030402040500041c', salt: 16 },
  12: { name: 'sha3-256', label: 'SHA3-256', info: '3031300d060960864801650304020805000420', salt: 16 },
  14: { name: 'sha3-512', label: 'SHA3-512', info: '3051300d060960864801650304020a05000440', salt: 32 },
};
const HASH_SHA256 = 8;
const HASH_SHA512 = 10;
const HASH_FOR_EDDSA = 10; // GnuPG подписва Ed25519 със SHA-512
const SIG_TYPE_BINARY = 0x00;
const MAX_KEY_BYTES = 256 * 1024;

const fail = (code, message, status) => Object.assign(new Error(message), { code, status: status || 400 });

// ── CRC24 (armor) ────────────────────────────────────────────────────────────
function crc24(buf) {
  let crc = 0xb704ce;
  for (const byte of buf) {
    crc ^= byte << 16;
    for (let i = 0; i < 8; i++) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= 0x1864cfb;
    }
  }
  return crc & 0xffffff;
}

function armor(kind, data) {
  const [begin, end] = ARMOR[kind] || ARMOR.SIGNATURE;
  const body = data.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
  const sum = crc24(data);
  const crc = Buffer.from([(sum >> 16) & 0xff, (sum >> 8) & 0xff, sum & 0xff]);
  return `${begin}\n\n${body}\n=${crc.toString('base64')}\n${end}\n`;
}

function dearmor(text) {
  if (typeof text !== 'string') throw fail('INVALID_ARMOR', 'Очаква се ASCII armor текст');
  const src = text.replace(/\r\n/g, '\n').trim();
  const lines = src.split('\n');
  const begin = lines.findIndex((l) => /^-----BEGIN PGP .+-----$/.test(l.trim()));
  const end = lines.findIndex((l) => /^-----END PGP .+-----$/.test(l.trim()));
  if (begin < 0 || end <= begin) throw fail('INVALID_ARMOR', 'Липсват armor заглавка/опашка');
  const kindLine = lines[begin].trim();
  const kind = kindLine.includes('SIGNATURE') ? 'SIGNATURE' : kindLine.includes('PRIVATE') ? 'PRIVATE' : 'PUBLIC';
  const payload = [];
  let sum = null;
  for (const raw of lines.slice(begin + 1, end)) {
    const line = raw.trim();
    if (!line || /^[A-Za-z-]+: /.test(line)) continue; // headers (напр. Version:)
    if (line.startsWith('=')) { sum = line.slice(1); continue; }
    payload.push(line);
  }
  if (!payload.length) throw fail('INVALID_ARMOR', 'Празно armor тяло');
  const data = Buffer.from(payload.join(''), 'base64');
  if (!data.length) throw fail('INVALID_ARMOR', 'Невалиден base64 в armor');
  if (sum) {
    const expected = crc24(data);
    const given = Buffer.from(sum, 'base64');
    if (given.length !== 3 || ((given[0] << 16) | (given[1] << 8) | given[2]) !== expected) {
      throw fail('CHECKSUM_MISMATCH', 'CRC24 на armor не съвпада');
    }
  }
  return { kind, data };
}

// ── MPI ──────────────────────────────────────────────────────────────────────
function readMpi(buf, at) {
  if (at + 2 > buf.length) throw fail('BAD_MPI', 'Отрязан MPI');
  const bits = buf.readUInt16BE(at);
  const bytes = Math.ceil(bits / 8);
  if (at + 2 + bytes > buf.length) throw fail('BAD_MPI', 'Отрязан MPI');
  return { value: buf.subarray(at + 2, at + 2 + bytes), bits, next: at + 2 + bytes };
}

function writeMpi(value) {
  let i = 0;
  while (i < value.length && value[i] === 0) i++;
  const body = value.subarray(i);
  if (!body.length) return Buffer.from([0, 0]);
  const bits = (body.length - 1) * 8 + (32 - Math.clz32(body[0]));
  const head = Buffer.alloc(2);
  head.writeUInt16BE(bits, 0);
  return Buffer.concat([head, body]);
}

const mpis = (list) => Buffer.concat(list.map(writeMpi));

// ── Пакети ───────────────────────────────────────────────────────────────────
function packet(tag, body) {
  const len = body.length;
  let head;
  if (len < 192) head = Buffer.from([0xc0 | tag, len]);
  else if (len < 8384) head = Buffer.from([0xc0 | tag, ((len - 192) >> 8) + 192, (len - 192) & 0xff]);
  else {
    head = Buffer.alloc(6);
    head[0] = 0xc0 | tag;
    head[1] = 0xff;
    head.writeUInt32BE(len, 2);
  }
  return Buffer.concat([head, body]);
}

function readPackets(buf) {
  const out = [];
  let at = 0;
  while (at < buf.length) {
    const ctb = buf[at];
    if ((ctb & 0x80) === 0) throw fail('BAD_PACKET', 'Невалиден OpenPGP пакет', 400);
    const newFormat = (ctb & 0x40) !== 0;
    const tag = newFormat ? ctb & 0x3f : (ctb >> 2) & 0x0f;
    let body;
    if (newFormat) {
      at += 1;
      if (at >= buf.length) throw fail('BAD_PACKET', 'Отрязан пакет', 400);
      const first = buf[at];
      if (first < 192) { at += 1; body = buf.subarray(at, at + first); at += first; }
      else if (first < 224) {
        if (at + 1 >= buf.length) throw fail('BAD_PACKET', 'Отрязан пакет', 400);
        const length = ((first - 192) << 8) + buf[at + 1] + 192;
        at += 2;
        body = buf.subarray(at, at + length);
        at += length;
      } else if (first === 0xff) {
        if (at + 4 >= buf.length) throw fail('BAD_PACKET', 'Отрязан пакет', 400);
        const length = buf.readUInt32BE(at + 1);
        at += 5;
        body = buf.subarray(at, at + length);
        at += length;
      } else {
        // Частични дължини (RFC 4880 §4.2.2.4) — GnuPG ги ползва за големи потоци.
        const parts = [];
        let chunk = 1 << (first & 0x1f);
        at += 1;
        for (; ;) {
          if (at + chunk > buf.length) throw fail('BAD_PACKET', 'Отрязан пакет', 400);
          parts.push(buf.subarray(at, at + chunk));
          at += chunk;
          if (at >= buf.length) throw fail('BAD_PACKET', 'Отрязан пакет', 400);
          const next = buf[at];
          if (next < 192) { at += 1; parts.push(buf.subarray(at, at + next)); at += next; break; }
          if (next < 224) {
            if (at + 1 >= buf.length) throw fail('BAD_PACKET', 'Отрязан пакет', 400);
            const length = ((next - 192) << 8) + buf[at + 1] + 192;
            at += 2;
            parts.push(buf.subarray(at, at + length));
            at += length;
            break;
          }
          if (next === 0xff) {
            if (at + 4 >= buf.length) throw fail('BAD_PACKET', 'Отрязан пакет', 400);
            const length = buf.readUInt32BE(at + 1);
            at += 5;
            parts.push(buf.subarray(at, at + length));
            at += length;
            break;
          }
          chunk = 1 << (next & 0x1f);
          at += 1;
        }
        body = Buffer.concat(parts);
      }
    } else {
      const ltype = ctb & 0x03;
      at += 1;
      let length;
      if (ltype === 3) length = buf.length - at;
      else {
        const size = [1, 2, 4][ltype];
        if (at + size > buf.length) throw fail('BAD_PACKET', 'Отрязан пакет', 400);
        length = size === 1 ? buf[at] : size === 2 ? buf.readUInt16BE(at) : buf.readUInt32BE(at);
        at += size;
      }
      if (at + length > buf.length) throw fail('BAD_PACKET', 'Отрязан пакет', 400);
      body = buf.subarray(at, at + length);
      at += length;
    }
    if (tag === 9) {
      // Компресиран пакет (GnuPG компресира и подписите си).
      const algo = body[0];
      const payload = body.subarray(1);
      let inner;
      if (algo === 1) inner = zlib.inflateRawSync(payload);
      else if (algo === 2) inner = zlib.inflateSync(payload);
      else throw fail('UNSUPPORTED_COMPRESSION', `Неподдържана компресия (${algo})`, 400);
      out.push(...readPackets(inner));
    } else {
      out.push({ tag, body });
    }
  }
  return out;
}

// ── Ключове ──────────────────────────────────────────────────────────────────
/** Дължина на публичния ключов материал за алгоритъм (v6). */
const RAW_KEY_BYTES = { eddsa: 32, ed448: 57, x25519: 32, x448: 56 };

/**
 * Чете ключов пакет (v4 или v6). v4: version|created|algo|MPI…;
 * v6 (RFC 9580 §5.5.2.3): version|created|algo|uint32 дължина|материал.
 */
function parseKeyBody(body) {
  if (body.length < 6) throw fail('BAD_KEY', 'Отрязан ключов пакет');
  const version = body[0];
  if (version !== 4 && version !== 6) {
    throw fail('UNSUPPORTED_KEY_VERSION', `Поддържат се OpenPGP v4 и v6 ключове (получено v${version})`);
  }
  const created = body.readUInt32BE(1);
  const algo = body[5];
  const info = ALGO[algo];
  if (!info) throw fail('UNSUPPORTED_ALGORITHM', `Неподдържан алгоритъм на ключа (${algo})`);
  let at = 6;
  const key = { version, created, algo, algorithm: info.name, kind: info.kind, canSign: info.sign };
  if (version === 6) {
    if (body.length < 10) throw fail('BAD_KEY', 'Отрязан ключов пакет (v6)');
    const materialLen = body.readUInt32BE(6);
    const end = 10 + materialLen;
    if (end > body.length) throw fail('BAD_KEY', 'Отрязан ключов материал (v6)');
    at = 10;
    if (info.kind === 'rsa') {
      const n = readMpi(body, at); at = n.next;
      const e = readMpi(body, at); at = e.next;
      key.n = n.value;
      key.e = e.value;
    } else if (info.kind === 'x25519' || info.kind === 'x448') {
      const size = RAW_KEY_BYTES[info.kind];
      if (materialLen !== size) throw fail('BAD_KEY', `Неочаквана дължина на ${info.name} ключ (${materialLen})`);
      key.point = body.subarray(at, at + size);
      at += size;
    } else if (info.kind === 'ecdh' || info.kind === 'ecdsa') {
      // v6 ECDH/ECDSA: OID на кривата, MPI точка, а при ECDH — и KDF параметри.
      const oidLength = body[at];
      key.curveOid = body.subarray(at + 1, at + 1 + oidLength).toString('hex');
      at += 1 + oidLength;
      const point = readMpi(body, at); at = point.next;
      key.point = point.value;
      if (info.kind === 'ecdh' && at < end) {
        const kdfLength = body[at];
        key.kdf = body.subarray(at, at + 1 + kdfLength);
        at += 1 + kdfLength;
      }
    } else {
      const size = RAW_KEY_BYTES[info.kind];
      if (materialLen !== size) throw fail('BAD_KEY', `Неочаквана дължина на ${info.name} ключ (${materialLen})`);
      key.point = body.subarray(at, at + size);
      at += size;
    }
    if (at !== end) throw fail('BAD_KEY', 'Ключовият материал не съвпада с обявената дължина');
  } else if (info.kind === 'rsa') {
    const n = readMpi(body, at); at = n.next;
    const e = readMpi(body, at); at = e.next;
    key.n = n.value;
    key.e = e.value;
  } else if (info.kind === 'eddsa') {
    if (body[at] !== ED25519_OID.length || !body.subarray(at + 1, at + 1 + ED25519_OID.length).equals(ED25519_OID)) {
      throw fail('UNSUPPORTED_CURVE', 'Поддържа се само Ed25519');
    }
    at += 1 + ED25519_OID.length;
    const point = readMpi(body, at); at = point.next;
    const raw = point.value;
    if (raw.length !== 33 || raw[0] !== 0x40) throw fail('BAD_KEY', 'Неочакван формат на Ed25519 публичен ключ');
    key.point = raw.subarray(1);
  } else if (info.kind === 'ecdh') {
    // v4 ECDH (RFC 6637 §8): OID на кривата, MPI точка, KDF параметри (дължина, запазен,
    // хеш, шифър). Ползва се за криптиране; ключът не се подписва.
    const oidLength = body[at];
    at += 1 + oidLength;
    const point = readMpi(body, at); at = point.next;
    key.point = point.value;
    if (at < body.length) {
      const kdfLength = body[at];
      key.kdf = body.subarray(at, at + 1 + kdfLength);
      at += 1 + kdfLength;
    }
  } else if (info.kind === 'ecdsa') {
    // v4 ECDSA: OID на кривата + MPI точка. Само се разчита (за да не спира разборът на
    // целия блок); подпис с него не се прави.
    const oidLength = body[at];
    at += 1 + oidLength;
    const point = readMpi(body, at); at = point.next;
    key.point = point.value;
  } else if (RAW_KEY_BYTES[info.kind] && info.kind !== 'x25519' && info.kind !== 'x448') {
    throw fail('UNSUPPORTED_ALGORITHM', `${info.name} се поддържа само във v6 ключ`);
  } else {
    // v4 X25519/X448 не съществуват — само във v6 (по-горе).
    throw fail('UNSUPPORTED_ALGORITHM', `${info.name} се поддържа само във v6 ключ`);
  }
  key.bodyLength = at;
  // Отпечатък: v4 → SHA-1 над 0x99 || uint16 || тяло (RFC 4880 §12.2);
  //            v6 → SHA-256 над 0x9B || uint32 || тяло (RFC 9580 §5.5.4.3).
  const publicBody = body.subarray(0, at);
  key.publicBody = publicBody;
  if (version === 6) {
    key.fingerprint = crypto
      .createHash('sha256')
      .update(Buffer.concat([Buffer.from([0x9b]), u32(publicBody.length), publicBody]))
      .digest('hex')
      .toUpperCase();
    key.keyId = key.fingerprint.slice(0, 16); // v6: старшите 64 бита
  } else {
    key.fingerprint = crypto
      .createHash('sha1')
      .update(Buffer.concat([Buffer.from([0x99]), u16(publicBody.length), publicBody]))
      .digest('hex')
      .toUpperCase();
    key.keyId = key.fingerprint.slice(-16); // v4: младшите 64 бита
  }
  return key;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function parseSecretMpis(key, body, passphrase) {
  let at = key.bodyLength;
  if (at >= body.length) throw fail('BAD_KEY', 'Липсва секция на секретния ключ');
  const usage = body[at];
  let source = body;
  if (usage !== 0) {
    // Ключ, защитен с парола: S2K → CFB → MPI (+ SHA-1 или 2-байтова сума).
    const opened = openSecretSection(key, body, passphrase);
    source = opened.plain;
    at = 0;
  } else {
    at += 1;
  }
  const secret = {};
  if (key.kind === 'rsa') {
    const d = readMpi(source, at); at = d.next;
    const p = readMpi(source, at); at = p.next;
    const q = readMpi(source, at); at = q.next;
    const u = readMpi(source, at); at = u.next;
    secret.d = d.value; secret.p = p.value; secret.q = q.value; secret.u = u.value;
  } else if (key.version === 6) {
    // v6: секретът е суров (без MPI) и БЕЗ контролна сума (RFC 9580 §5.5.3).
    const size = RAW_KEY_BYTES[key.kind];
    if (at + size > source.length) throw fail('BAD_KEY', 'Отрязан секретен ключ (v6)');
    secret.d = source.subarray(at, at + size);
  } else {
    const s = readMpi(source, at); at = s.next;
    // MPI е цяло число: водещите нулеви БИТОВЕ не се пазят (RFC 4880 §3.2).
    // Затова 32-байтов секрет, който започва с 0x00, пристига като 31 байта —
    // това е валиден ключ, не повреда. Допълваме отляво до фиксирания размер.
    if (s.value.length > 32) throw fail('BAD_KEY', 'Неочакван размер на Ed25519 секретен ключ');
    secret.d = s.value.length === 32 ? Buffer.from(s.value) : Buffer.concat([Buffer.alloc(32 - s.value.length), s.value]);
  }
  if (key.version === 4 && at + 2 <= source.length) {
    let sum = 0;
    for (let i = usage === 0 ? key.bodyLength + 1 : 0; i < at; i++) sum = (sum + source[i]) & 0xffff;
    if (sum !== source.readUInt16BE(at)) throw fail('BAD_KEY', 'Контролна сума на секретния ключ не съвпада');
  }
  return secret;
}

// ── S2K (ключ, защитен с парола) ─────────────────────────────────────────────
// RFC 4880 §3.7.1: S2K тип 0 (прост), 1 (солен), 3 (итериран и солен). Тип 4 (Argon2,
// RFC 9580) не се поддържа — казва се с думи, вместо да се върне безсмислена грешка.
const S2K_HASHES = { 1: 'md5', 2: 'sha1', 3: 'ripemd160', 8: 'sha256', 9: 'sha384', 10: 'sha512', 11: 'sha224' };
// Шифри, които Node може да ползва директно. CAST5/BLOWFISH/IDEA липсват в Node —
// тогава се казва кой шифър липсва, вместо да се декриптира боклук.
const SYM_CIPHERS = {
  7: { name: 'aes-128-cfb', keyBytes: 16, block: 16, label: 'AES-128' },
  8: { name: 'aes-192-cfb', keyBytes: 24, block: 16, label: 'AES-192' },
  9: { name: 'aes-256-cfb', keyBytes: 32, block: 16, label: 'AES-256' },
};

/** Повтаря `source`, докато се запълнят `total` байта — без O(n²) конкатенации. */
function repeatTo(source, total) {
  const out = Buffer.alloc(total);
  for (let off = 0; off < total; off += source.length) {
    source.copy(out, off, 0, Math.min(source.length, total - off));
  }
  return out;
}

/** Извежда ключ по S2K спецификацията (започва с байта на типа). */
function s2kDerive(spec, passphrase, keyBytes) {
  const type = spec[0];
  const hashName = S2K_HASHES[spec[1]];
  if (!hashName) throw fail('UNSUPPORTED_HASH', `Неподдържан хеш за S2K (${spec[1]})`);
  let salt = Buffer.alloc(0);
  let count = 0;
  if (type === 1) salt = spec.subarray(2, 10);
  if (type === 3) {
    salt = spec.subarray(2, 10);
    const coded = spec[10];
    count = (16 + (coded & 15)) << ((coded >> 4) + 6);
  }
  const source = type === 0 ? passphrase : Buffer.concat([salt, passphrase]);
  if (!source.length) throw fail('PASSPHRASE_REQUIRED', 'Празна парола за секретния ключ');
  const total = type === 3 ? count : source.length;
  const data = repeatTo(source, total);
  const parts = [];
  let have = 0;
  while (have < keyBytes) {
    // За следващите хешове входът се предшества от (i−1) нулеви октета (RFC 4880 §3.7.1.1).
    const input = parts.length ? Buffer.concat([Buffer.alloc(parts.length), data]) : data;
    const digest = crypto.createHash(hashName).update(input).digest();
    parts.push(digest);
    have += digest.length;
  }
  return Buffer.concat(parts).subarray(0, keyBytes);
}

/** Отваря секцията на секретния ключ, защитена с парола. Връща {plain} (без сумата). */
function openSecretSection(key, body, passphrase) {
  const usage = body[key.bodyLength];
  if (usage !== 254 && usage !== 255) {
    throw fail('UNSUPPORTED_KEY_USAGE', `Неподдържан режим на защита на секретния ключ (${usage})`);
  }
  const encryptedText = typeof passphrase === 'string' ? passphrase : '';
  if (!encryptedText) {
    throw fail('PASSPHRASE_REQUIRED', 'Секретният ключ е защитен с парола (S2K) — нужна е паролата (опция `pgp_key_pass` или `PGP_KEY_PASS`)');
  }
  let at = key.bodyLength + 1;
  // RFC 9580 §5.5.3: при v6 след байта за използване има 1 октет „колко байта следват“
  // (общата дължина на S2K параметрите), а след шифъра — още един октет за дължината
  // на самата S2K спецификация. Без тях разборът се размества и паролата „не пасва“.
  if (key.version === 6) at += 1;
  const symAlgo = body[at]; at += 1;
  const cipher = SYM_CIPHERS[symAlgo];
  if (!cipher) throw fail('UNSUPPORTED_CIPHER', `Неподдържан шифър за секретния ключ (${symAlgo}) — hAPI поддържа AES-128/192/256`);
  if (key.version === 6) at += 1;
  const type = body[at];
  const specLength = type === 0 ? 2 : type === 1 ? 10 : type === 3 ? 11 : 0;
  if (!specLength) {
    if (type === 4) throw fail('S2K_ARGON2_UNSUPPORTED', 'Секретният ключ е защитен с Argon2 (S2K тип 4) — hAPI поддържа iterated-salted (тип 3). Експортирай ключа с `--s2k-mode 3` или без парола.');
    throw fail('UNSUPPORTED_S2K', `Неподдържан S2K тип (${type})`);
  }
  const spec = body.subarray(at, at + specLength); at += specLength;
  if (at + cipher.block > body.length) throw fail('BAD_KEY', 'Отрязан секретен ключ (IV)');
  const iv = body.subarray(at, at + cipher.block); at += cipher.block;
  const keyBytes = s2kDerive(spec, Buffer.from(encryptedText, 'utf8'), cipher.keyBytes);
  let plain;
  try {
    const decipher = crypto.createDecipheriv(cipher.name, keyBytes, iv);
    plain = Buffer.concat([decipher.update(body.subarray(at)), decipher.final()]);
  } catch {
    throw fail('PASSPHRASE_WRONG', 'Паролата на секретния ключ не е вярна');
  }
  if (usage === 255) {
    if (plain.length < 21) throw fail('BAD_KEY', 'Отрязан секретен ключ (SHA-1)');
    const data = plain.subarray(0, plain.length - 20);
    const given = plain.subarray(plain.length - 20);
    const want = crypto.createHash('sha1').update(data).digest();
    if (!crypto.timingSafeEqual(given, want)) throw fail('PASSPHRASE_WRONG', 'Паролата на секретния ключ не е вярна');
    return { plain: data };
  }
  // gpg 2.5 пише usage=254, но слага SHA-1 контрола (20 октета), а не 2-байтовата сума,
  // която RFC 4880 описва за 254 (проверено с реален ключ). Затова не се гадае по байта:
  // първо се пробва SHA-1 (по-строгата), после 2-байтовата сума.
  if (plain.length >= 21) {
    const data = plain.subarray(0, plain.length - 20);
    const want = crypto.createHash('sha1').update(data).digest();
    if (crypto.timingSafeEqual(plain.subarray(plain.length - 20), want)) return { plain: data };
  }
  if (plain.length >= 3) {
    const data = plain.subarray(0, plain.length - 2);
    let sum = 0;
    for (const byte of data) sum = (sum + byte) & 0xffff;
    if (sum === plain.readUInt16BE(plain.length - 2)) return { plain: data };
  }
  throw fail('PASSPHRASE_WRONG', 'Паролата на секретния ключ не е вярна');
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

// RSA в OpenPGP носи само d, p, q (и u = p⁻¹ mod q), а JWK изисква CRT параметрите.
const toBig = (buf) => (buf.length ? BigInt('0x' + buf.toString('hex')) : 0n);
const toBuf = (n) => {
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return Buffer.from(hex, 'hex');
};
function modInverse(a, m) {
  let [old_r, r] = [a % m, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) throw fail('BAD_KEY', 'Невалидни RSA параметри');
  return ((old_s % m) + m) % m;
}

function privateKeyObject(key, secret) {
  if (key.kind === 'rsa') {
    const p = toBig(secret.p);
    const q = toBig(secret.q);
    const d = toBig(secret.d);
    const jwk = {
      kty: 'RSA',
      n: b64u(key.n),
      e: b64u(key.e),
      d: b64u(secret.d),
      p: b64u(secret.p),
      q: b64u(secret.q),
      dp: b64u(toBuf(d % (p - 1n))),
      dq: b64u(toBuf(d % (q - 1n))),
      qi: b64u(toBuf(modInverse(q, p))),
    };
    return crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  }
  return crypto.createPrivateKey({ key: { kty: 'OKP', crv: key.kind === 'ed448' ? 'Ed448' : 'Ed25519', x: b64u(key.point), d: b64u(secret.d) }, format: 'jwk' });
}

function publicKeyObject(key) {
  if (key.kind === 'rsa') return crypto.createPublicKey({ key: { kty: 'RSA', n: b64u(key.n), e: b64u(key.e) }, format: 'jwk' });
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: key.kind === 'ed448' ? 'Ed448' : 'Ed25519', x: b64u(key.point) }, format: 'jwk' });
}

/** Чете armored ключов блок (публичен или секретен). Връща {keys:[...], userId, kind}. */
/** Чете armored ключов блок (публичен или секретен). Връща {keys:[...], userId, kind}.
 *  `options.passphrase` отключва секретен ключ, защитен с парола (S2K). */
function parseKeyBlock(text, options) {
  const passphrase = options && typeof options.passphrase === 'string' ? options.passphrase : '';
  const { data, kind } = dearmor(text);
  if (data.length > MAX_KEY_BYTES) throw fail('KEY_TOO_LARGE', 'Ключът е твърде голям');
  const packets = readPackets(data);
  const keys = [];
  let userId = '';
  let current = null;
  for (const p of packets) {
    if (p.tag === 6 || p.tag === 14) {
      const key = parseKeyBody(p.body);
      key.secret = null;
      key.isSubkey = p.tag === 14;
      keys.push(key);
      current = key;
    } else if (p.tag === 5 || p.tag === 7) {
      const key = parseKeyBody(p.body);
      key.isSubkey = p.tag === 7;
      key.secret = parseSecretMpis(key, p.body, passphrase);
      keys.push(key);
      current = key;
    } else if (p.tag === 13 && !userId) {
      userId = p.body.toString('utf8');
      current = null;
    }
  }
  if (!keys.length) throw fail('NO_KEY', 'В блока няма ключов пакет');
  const primary = keys.find((k) => !k.isSubkey);
  if (!primary) throw fail('NO_KEY', 'Липсва основен ключ');
  return { keys, primary, userId, kind, armored: kind };
}

/** Кой ключ реално подписва: основният, ако може, иначе първият подходящ подключ. */
function signingKey(parsed) {
  const candidates = parsed.keys.filter((k) => k.secret && k.canSign);
  if (!candidates.length) throw fail('NO_SECRET_KEY', 'Няма секретен ключ за подписване');
  return candidates.find((k) => !k.isSubkey) || candidates[0];
}

function describe(parsed) {
  const k = parsed.primary;
  return {
    keyId: k.keyId,
    fingerprint: k.fingerprint,
    version: k.version,
    algorithm: k.algorithm,
    bits: k.kind === 'rsa' ? k.n.length * 8 : k.kind === 'ed448' ? 456 : 256,
    createdAt: new Date(k.created * 1000).toISOString(),
    userId: parsed.userId,
    hasSecret: parsed.keys.some((x) => x.secret),
    subkeys: parsed.keys.filter((x) => x.isSubkey).length,
  };
}

// ── Подпис ────────────────────────────────────────────────────────────────────

function subpacket(type, data) {
  const body = Buffer.concat([Buffer.from([type]), data]);
  if (body.length < 192) return Buffer.concat([Buffer.from([body.length]), body]);
  if (body.length < 8384) return Buffer.concat([Buffer.from([192 + ((body.length - 192) >> 8), (body.length - 192) & 0xff]), body]);
  const head = Buffer.alloc(5);
  head[0] = 0xff;
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
}

function timeSubpacket(type, created, critical) {
  const value = Buffer.alloc(4);
  value.writeUInt32BE(created, 0);
  return subpacket(critical ? type | 0x80 : type, value);
}

/** Issuer Fingerprint (тип 33): 1 октет версия + отпечатък (RFC 9580 §5.2.3.35). */
function issuerFingerprintSubpacket(key, critical) {
  const fp = Buffer.from(key.fingerprint, 'hex');
  return subpacket(critical ? 33 | 0x80 : 33, Buffer.concat([Buffer.from([key.version]), fp]));
}

/** Рамкиране на ключ за хеша: v4 → 0x99|u16; v6 → 0x9B|u32 (RFC 9580 §5.2.4). */
function keyFraming(key) {
  return key.version === 6
    ? Buffer.concat([Buffer.from([0x9b]), u32(key.publicBody.length), key.publicBody])
    : Buffer.concat([Buffer.from([0x99]), u16(key.publicBody.length), key.publicBody]);
}

/**
 * Тяло на signature packet. v4: 2-октетни дължини на subpacket-ите и без salt;
 * v6: 4-октетни дължини, salt (16/24/32 октета) и Issuer Fingerprint вместо Key ID.
 * signedPrefix е това, което се хешира преди заглавката на подписа: данните за
 * деташиран подпис или ключ(+UID) за self-signature.
 */
function buildSignatureBody({ key, sigType, signedPrefix, extraHashed, created, hashAlgo, salt }) {
  const algo = hashAlgo || (key.kind === 'rsa' ? HASH_SHA256 : HASH_FOR_EDDSA);
  const hashInfo = HASHES[algo];
  if (!hashInfo) throw fail('UNSUPPORTED_HASH', `Неподдържан хеш алгоритъм (${algo})`);
  const v6 = key.version === 6;
  const hashed = Buffer.concat([
    timeSubpacket(2, created, v6),
    ...(v6 ? [issuerFingerprintSubpacket(key, false)] : []),
    ...(extraHashed || []),
  ]);
  const unhashed = v6 ? Buffer.alloc(0) : subpacket(16, Buffer.from(key.keyId, 'hex'));
  const header = Buffer.alloc(v6 ? 8 : 6);
  header[0] = v6 ? 6 : 4;
  header[1] = sigType;
  header[2] = key.algo;
  header[3] = algo;
  if (v6) header.writeUInt32BE(hashed.length, 4);
  else header.writeUInt16BE(hashed.length, 4);
  const hashedPart = Buffer.concat([header, hashed]);
  const saltBuf = v6 ? (Buffer.isBuffer(salt) && salt.length === hashInfo.salt ? salt : crypto.randomBytes(hashInfo.salt)) : null;
  const digestInput = [v6 ? saltBuf : null, signedPrefix, hashedPart, Buffer.from([v6 ? 6 : 4, 0xff]), u32(hashedPart.length)];
  const ctx = crypto.createHash(hashInfo.name);
  for (const part of digestInput) if (part) ctx.update(part);
  const digest = ctx.digest();
  let signatureMpis;
  if (key.kind === 'rsa') {
    const raw = crypto.privateEncrypt(
      { key: privateKeyObject(key, key.secret), padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.concat([Buffer.from(hashInfo.info, 'hex'), digest]),
    );
    signatureMpis = mpis([raw]);
  } else {
    const sig = crypto.sign(null, digest, privateKeyObject(key, key.secret));
    // v6 подписва с суровите 64/114 октета; v4 (EdDSA legacy) — като два MPI.
    signatureMpis = v6 ? sig : mpis([sig.subarray(0, 32), sig.subarray(32)]);
  }
  const tail = v6 ? Buffer.concat([u32(unhashed.length), unhashed, digest.subarray(0, 2), Buffer.from([saltBuf.length]), saltBuf]) : Buffer.concat([u16(unhashed.length), unhashed, digest.subarray(0, 2)]);
  return Buffer.concat([header, hashed, tail, signatureMpis]);
}

/** Деташиран подпис (binary document) в ASCII armor. */
function signDetached(data, armoredSecretKey, options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (!Buffer.isBuffer(data)) throw fail('INVALID_DATA', 'Очаква се Buffer за подпис');
  const parsed = parseKeyBlock(armoredSecretKey);
  const key = signingKey(parsed);
  const created = Number.isFinite(opts.createdAt) ? Number(opts.createdAt) : Math.floor(Date.now() / 1000);
  const hashAlgo = opts.hashAlgo || (key.kind === 'eddsa' ? HASH_FOR_EDDSA : HASH_SHA256);
  if (!HASHES[hashAlgo]) throw fail('UNSUPPORTED_HASH', `Неподдържан хеш алгоритъм (${hashAlgo})`);
  const body = buildSignatureBody({ key, sigType: SIG_TYPE_BINARY, signedPrefix: data, created, hashAlgo });
  const armored = armor('SIGNATURE', packet(2, body));
  return {
    armored,
    keyId: key.keyId,
    fingerprint: key.fingerprint,
    algorithm: key.algorithm,
    hash: HASHES[hashAlgo].label,
    createdAt: new Date(created * 1000).toISOString(),
  };
}

/** Self-signature (positive certification, тип 0x13) върху ключ и потребителски идентификатор. */
function selfCertification(key, userId, created) {
  const keyFramingBuf = keyFraming(key);
  const uid = Buffer.from(userId, 'utf8');
  const uidLength = Buffer.alloc(4);
  uidLength.writeUInt32BE(uid.length, 0);
  const keyFlags = subpacket(27, Buffer.from([0x03])); // certify + sign
  const primaryUid = subpacket(25, Buffer.from([0x01]));
  return buildSignatureBody({
    key,
    sigType: 0x13,
    signedPrefix: Buffer.concat([keyFramingBuf, Buffer.from([0xb4]), uidLength, uid]),
    extraHashed: [keyFlags, primaryUid],
    created,
  });
}

/** Direct Key self-signature (тип 0x1F) — препоръчана за v6 ключове (RFC 9580 §5.2.3.10). */
function directKeySignature(key, created) {
  return buildSignatureBody({
    key,
    sigType: 0x1f,
    signedPrefix: keyFraming(key),
    extraHashed: [subpacket(27, Buffer.from([0x03]))],
    created,
  });
}

/** Проверка на деташиран подпис (v4 и v6, RFC 9580). */
function verifyDetached(data, armoredSignature, armoredPublicKey) {
  try {
    if (!Buffer.isBuffer(data)) return { valid: false, reason: 'INVALID_DATA' };
    const sig = dearmor(armoredSignature);
    const packets = readPackets(sig.data).filter((p) => p.tag === 2);
    if (packets.length !== 1) return { valid: false, reason: 'NO_SIGNATURE_PACKET' };
    const body = packets[0].body;
    if (body.length < 10) return { valid: false, reason: 'TRUNCATED_SIGNATURE' };
    const version = body[0];
    if (version !== 4 && version !== 6) return { valid: false, reason: 'UNSUPPORTED_SIGNATURE_VERSION' };
    const v6 = version === 6;
    const pubAlgo = body[2];
    const hashAlgo = body[3];
    const hashInfo = HASHES[hashAlgo];
    if (!hashInfo) return { valid: false, reason: 'UNSUPPORTED_HASH' };

    let hashedEnd;
    let unhashedStart;
    let unhashedLen;
    if (v6) {
      if (body.length < 12) return { valid: false, reason: 'TRUNCATED_SIGNATURE' };
      const hashedLen = body.readUInt32BE(4);
      hashedEnd = 8 + hashedLen;
      if (body.length < hashedEnd + 4) return { valid: false, reason: 'TRUNCATED_SIGNATURE' };
      unhashedStart = hashedEnd + 4;
      unhashedLen = body.readUInt32BE(hashedEnd);
    } else {
      hashedEnd = 6 + body.readUInt16BE(4);
      if (body.length < hashedEnd + 4) return { valid: false, reason: 'TRUNCATED_SIGNATURE' };
      unhashedStart = hashedEnd + 2;
      unhashedLen = body.readUInt16BE(hashedEnd);
    }
    if (body.length < unhashedStart + unhashedLen + 2) return { valid: false, reason: 'TRUNCATED_SIGNATURE' };
    const hashedPart = body.subarray(0, hashedEnd);
    let at = unhashedStart + unhashedLen;
    const left16 = body.subarray(at, at + 2);
    at += 2;
    let salt = Buffer.alloc(0);
    if (v6) {
      if (at >= body.length) return { valid: false, reason: 'TRUNCATED_SIGNATURE' };
      const saltLen = body[at];
      at += 1;
      if (body.length < at + saltLen) return { valid: false, reason: 'TRUNCATED_SIGNATURE' };
      if (saltLen !== hashInfo.salt) return { valid: false, reason: 'BAD_SALT_LENGTH' };
      salt = body.subarray(at, at + saltLen);
      at += saltLen;
    }
    const sigAt = at;

    // Издател: v4 → Issuer Key ID (16); v6 → Issuer Fingerprint (33).
    let issuer = '';
    const scan = (start, end) => {
      for (let p = start; p < end;) {
        const first = body[p];
        let length;
        let head;
        if (first < 192) { length = first; head = 1; }
        else if (first < 255) { length = ((first - 192) << 8) + body[p + 1] + 192; head = 2; }
        else { length = body.readUInt32BE(p + 1); head = 5; }
        if (!length || p + head + length > end) break;
        const type = body[p + head] & 0x7f;
        const payload = body.subarray(p + head + 1, p + head + length);
        if (v6 && type === 33 && payload.length >= 2) issuer = payload.subarray(1).toString('hex').toUpperCase().slice(0, 16);
        else if (!v6 && type === 16 && payload.length >= 8) issuer = payload.subarray(0, 8).toString('hex').toUpperCase();
        p += head + length;
      }
    };
    scan(v6 ? 8 : 6, hashedEnd);
    scan(unhashedStart, unhashedStart + unhashedLen);

    const parsed = parseKeyBlock(armoredPublicKey);
    const candidates = parsed.keys.filter((k) => {
      const compatible =
        (pubAlgo === 22 && k.kind === 'eddsa') ||
        (pubAlgo === 27 && k.kind === 'eddsa') ||
        (pubAlgo === 28 && k.kind === 'ed448') ||
        (pubAlgo !== 22 && pubAlgo !== 27 && pubAlgo !== 28 && k.kind === 'rsa');
      if (!compatible) return false;
      if (v6 && k.version !== 6) return false;
      if (!v6 && k.version === 6) return false;
      if (!issuer) return true;
      return k.keyId === issuer;
    });
    if (!candidates.length) return { valid: false, reason: 'UNKNOWN_SIGNING_KEY', keyId: issuer };

    const ctx = crypto.createHash(hashInfo.name);
    if (v6) ctx.update(salt);
    ctx.update(data);
    ctx.update(hashedPart);
    ctx.update(Buffer.from([version, 0xff]));
    ctx.update(u32(hashedPart.length));
    const digest = ctx.digest();
    if (!left16.equals(digest.subarray(0, 2))) return { valid: false, reason: 'DIGEST_MISMATCH' };

    for (const key of candidates) {
      const pub = publicKeyObject(key);
      if (key.kind === 'rsa') {
        const mpi = readMpi(body, sigAt);
        let recovered;
        try {
          recovered = crypto.publicDecrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_PADDING }, mpi.value);
        } catch {
          continue;
        }
        const expected = Buffer.concat([Buffer.from(hashInfo.info, 'hex'), digest]);
        if (recovered.length === expected.length && crypto.timingSafeEqual(recovered, expected)) {
          return { valid: true, keyId: key.keyId, fingerprint: key.fingerprint, version: key.version, algorithm: key.algorithm, hash: hashInfo.label };
        }
      } else if (v6) {
        const size = key.kind === 'ed448' ? 114 : 64;
        const signature = body.subarray(sigAt, sigAt + size);
        if (signature.length === size && crypto.verify(null, digest, pub, signature)) {
          return { valid: true, keyId: key.keyId, fingerprint: key.fingerprint, version: key.version, algorithm: key.algorithm, hash: hashInfo.label };
        }
      } else {
        const r = readMpi(body, sigAt);
        const s = readMpi(body, r.next);
        const sigBuf = Buffer.concat([Buffer.concat([Buffer.alloc(32 - r.value.length), r.value]), Buffer.concat([Buffer.alloc(32 - s.value.length), s.value])]);
        if (sigBuf.length === 64 && crypto.verify(null, digest, pub, sigBuf)) {
          return { valid: true, keyId: key.keyId, fingerprint: key.fingerprint, version: key.version, algorithm: key.algorithm, hash: hashInfo.label };
        }
      }
    }
    return { valid: false, reason: 'SIGNATURE_MISMATCH' };
  } catch (e) {
    return { valid: false, reason: e.code || 'VERIFY_ERROR', message: e.message };
  }
}

// ── Генериране на ключове (само за тестове/интероп; API-то не генерира ключове) ─
function keyPackets({ created, algo, publicMpis, version }) {
  if (version === 6) {
    const head = Buffer.alloc(10); // version(1) + created(4) + algo(1) + uint32 дължина
    head[0] = 6;
    head.writeUInt32BE(created, 1);
    head[5] = algo;
    head.writeUInt32BE(publicMpis.length, 6);
    return Buffer.concat([head, publicMpis]);
  }
  const head = Buffer.alloc(6); // version(1) + created(4) + algo(1)
  head[0] = 4;
  head.writeUInt32BE(created, 1);
  head[5] = algo;
  return Buffer.concat([head, publicMpis]);
}

function secretBody(publicBody, secretMpiBuf, version) {
  // v4: контролна сума (2 октета); v6: без контролна сума (RFC 9580 §5.5.2).
  if (version === 6) return Buffer.concat([publicBody, Buffer.from([0]), secretMpiBuf]);
  const checksum = Buffer.alloc(2);
  let sum = 0;
  for (const byte of secretMpiBuf) sum = (sum + byte) & 0xffff;
  checksum.writeUInt16BE(sum, 0);
  return Buffer.concat([publicBody, Buffer.from([0]), secretMpiBuf, checksum]);
}

/**
 * Генерира OpenPGP ключ (v4 по подразбиране, `version: 6` за RFC 9580).
 * algorithm: 'ed25519' | 'rsa2048' | 'rsa3072' | 'rsa4096'.
 * Връща {publicArmored, secretArmored, keyId, fingerprint, version, algorithm, createdAt, userId}.
 */
function generate({ algorithm = 'ed25519', userId = 'hAPI Enterprise <hapi@localhost>', createdAt, version = 4 } = {}) {
  const created = Number.isFinite(createdAt) ? Number(createdAt) : Math.floor(Date.now() / 1000);
  const name = String(userId || '').replace(/[\r\n\0]/g, ' ').slice(0, 200);
  const v6 = Number(version) === 6;
  let publicMpis;
  let secretMpiBuf;
  let algo;
  if (algorithm === 'ed25519') {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
    const sec = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url');
    if (v6) {
      algo = 27;
      publicMpis = pub;
      secretMpiBuf = sec;
    } else {
      algo = 22;
      publicMpis = Buffer.concat([Buffer.from([ED25519_OID.length]), ED25519_OID, writeMpi(Buffer.concat([Buffer.from([0x40]), pub]))]);
      secretMpiBuf = writeMpi(sec);
    }
  } else {
    const bits = { rsa2048: 2048, rsa3072: 3072, rsa4096: 4096 }[algorithm];
    if (!bits) throw fail('UNSUPPORTED_ALGORITHM', `Неподдържан алгоритъм: ${algorithm}`);
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: bits, publicExponent: 0x10001 });
    const pub = publicKey.export({ format: 'jwk' });
    const sec = privateKey.export({ format: 'jwk' });
    const n = Buffer.from(pub.n, 'base64url');
    const e = Buffer.from(pub.e, 'base64url');
    algo = 1;
    publicMpis = Buffer.concat([writeMpi(n), writeMpi(e)]);
    secretMpiBuf = mpis([
      Buffer.from(sec.d, 'base64url'),
      Buffer.from(sec.p, 'base64url'),
      Buffer.from(sec.q, 'base64url'),
      Buffer.from(sec.qi, 'base64url'),
    ]);
  }
  const pubBody = keyPackets({ created, algo, publicMpis, version: v6 ? 6 : 4 });
  const secBody = secretBody(pubBody, secretMpiBuf, v6 ? 6 : 4);
  const uid = packet(13, Buffer.from(name, 'utf8'));
  // Self-signature прави ключа валиден за GnuPG и за всеки друг OpenPGP клиент.
  const secKey = parseKeyBody(secBody);
  secKey.secret = parseSecretMpis(secKey, secBody);
  const cert = packet(2, selfCertification(secKey, name, created));
  // v6 сертификатът изисква Direct Key self-signature (RFC 9580 §5.2.3.10).
  const direct = v6 ? packet(2, directKeySignature(secKey, created)) : Buffer.alloc(0);
  const publicBytes = Buffer.concat([packet(6, pubBody), direct, uid, cert]);
  const secretBytes = Buffer.concat([packet(5, secBody), direct, uid, cert]);
  const parsed = parseKeyBlock(armor('PUBLIC', publicBytes));
  return {
    publicArmored: armor('PUBLIC', publicBytes),
    secretArmored: armor('PRIVATE', secretBytes),
    keyId: parsed.primary.keyId,
    fingerprint: parsed.primary.fingerprint,
    version: parsed.primary.version,
    algorithm: parsed.primary.algorithm,
    bits: parsed.primary.kind === 'rsa' ? parsed.primary.n.length * 8 : 256,
    createdAt: new Date(created * 1000).toISOString(),
    userId: name,
  };
}

/** Публичен ключ от секретен блок (за публикуване без риск). */
function publicKeyOf(secretArmored) {
  const { data } = dearmor(secretArmored);
  const packets = readPackets(data);
  const out = [];
  for (const p of packets) {
    if (p.tag === 5) out.push(packet(6, p.body.subarray(0, parseKeyBody(p.body).bodyLength)));
    else if (p.tag === 7) out.push(packet(14, p.body.subarray(0, parseKeyBody(p.body).bodyLength)));
    else if (p.tag === 13) out.push(packet(13, p.body));
  }
  if (!out.length) throw fail('NO_KEY', 'В блока няма ключ');
  return armor('PUBLIC', Buffer.concat(out));
}

/** Последните 8 байта от отпечатъка — това е key ID-то в PKESK v3. */
function pgpKeyFingerprintHex(key) {
  return Buffer.from(key.fingerprint, 'hex');
}

// X25519/X448 обвивка (RFC 9580 §5.1.6): KEK = HKDF-SHA256/512(eph || получател || shared),
// salt празен, info „OpenPGP X25519“/„OpenPGP X448“; обвива се САМО сесийният ключ с AES-KW.
const X_CURVES = {
  25: { crv: 'X25519', size: 32, hash: 'sha256', info: 'OpenPGP X25519', kekBytes: 16, wrap: 'id-aes128-wrap' },
  26: { crv: 'X448', size: 56, hash: 'sha512', info: 'OpenPGP X448', kekBytes: 32, wrap: 'id-aes256-wrap' },
};

function okpPublic(point, curve) {
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: curve, x: Buffer.from(point).toString('base64url') }, format: 'jwk' });
}

function okpPrivate(point, secret, curve) {
  return crypto.createPrivateKey({
    key: { kty: 'OKP', crv: curve, x: Buffer.from(point).toString('base64url'), d: Buffer.from(secret).toString('base64url') },
    format: 'jwk',
  });
}

/** KEK за Montgomery крива: входът на HKDF е ефимерният ключ, ключът на получателя и общата тайна. */
function kekFor(curve, ephemeralPublic, recipientPoint, shared) {
  const ikm = Buffer.concat([ephemeralPublic, recipientPoint, shared]);
  return Buffer.from(crypto.hkdfSync(curve.hash, ikm, Buffer.alloc(0), Buffer.from(curve.info, 'utf8'), curve.kekBytes));
}

/** AES Key Wrap (RFC 3394) — нативната поддръжка на OpenSSL. */
function aesKeyWrap(cipherName, kek, payload, encrypt) {
  const iv = Buffer.from('A6A6A6A6A6A6A6A6', 'hex');
  const made = encrypt ? crypto.createCipheriv(cipherName, kek, iv) : crypto.createDecipheriv(cipherName, kek, iv);
  return Buffer.concat([made.update(payload), made.final()]);
}

/** Кой ключ криптира: X25519/X448 (v6), после RSA. ECDH с именувана крива не се поддържа. */
function encryptionKeyOf(parsed) {
  const all = parsed.keys;
  const montgomery = all.find((k) => k.kind === 'x25519' || k.kind === 'x448');
  if (montgomery) return montgomery;
  const rsa = all.find((k) => k.kind === 'rsa');
  if (rsa) return rsa;
  if (all.some((k) => k.kind === 'ecdh')) {
    throw fail('UNSUPPORTED_CURVE', 'Ключът за криптиране е ECDH с именувана крива — hAPI поддържа X25519, X448 и RSA');
  }
  throw fail('NO_ENCRYPTION_KEY', 'Няма ключ за криптиране (X25519, X448 или RSA)');
}

// ── RSA: PKCS#1 v1.5 ръчно ────────────────────────────────────────────────────
// OpenSSL 3 отказва PKCS#1 padding при частните операции (`privateEncrypt`), затова
// padding-ът и модулното степенуване се правят тук. MPI не пази водещи нули, затова
// резултатът се допълва до дължината на модула в двете посоки — иначе gpg чете счупен блок.
function pkcs1Pad(payload, size) {
  if (payload.length > size - 11) throw fail('DATA_TOO_LONG', 'Данните не се побират в един RSA блок');
  const ps = Buffer.alloc(size - payload.length - 3);
  for (let i = 0; i < ps.length; i++) {
    let byte = 0;
    while (byte === 0) byte = crypto.randomBytes(1)[0];
    ps[i] = byte;
  }
  return Buffer.concat([Buffer.from([0x00, 0x02]), ps, Buffer.from([0x00]), payload]);
}

/** m^e mod n, допълнено до `size` байта (MPI-то няма водещи нули). */
function rsaPow(base, exponent, modulus, size) {
  let result = 1n;
  let square = base % modulus;
  let exp = exponent;
  while (exp > 0n) {
    if (exp & 1n) result = (result * square) % modulus;
    square = (square * square) % modulus;
    exp >>= 1n;
  }
  const out = toBuf(result);
  if (out.length >= size) return out.subarray(out.length - size);
  return Buffer.concat([Buffer.alloc(size - out.length), out]);
}

function rsaParameters(jwk, names) {
  const n = toBig(Buffer.from(jwk.n, 'base64url'));
  const size = Buffer.from(jwk.n, 'base64url').length;
  const values = names.map((name) => toBig(Buffer.from(jwk[name], 'base64url')));
  return { n, size, values };
}

/** PKCS#1 v1.5 криптиране към публичен RSA ключ (за PKESK). */
function rsaEncryptPkcs1(keyObject, payload) {
  const { n, size, values } = rsaParameters(keyObject.export({ format: 'jwk' }), ['e']);
  return rsaPow(toBig(pkcs1Pad(payload, size)), values[0], n, size);
}

/** PKCS#1 v1.5 декриптиране с частен RSA ключ; връща само данните след padding-а. */
function rsaDecryptPkcs1(keyObject, cipherText) {
  const { n, size, values } = rsaParameters(keyObject.export({ format: 'jwk' }), ['d']);
  const block = rsaPow(toBig(cipherText), values[0], n, size);
  if (block[0] !== 0x00 || block[1] !== 0x02) {
    throw fail('BAD_SESSION_KEY', 'RSA блокът не е PKCS#1 v1.5 тип 2');
  }
  const end = block.indexOf(0, 2);
  if (end < 10) throw fail('BAD_SESSION_KEY', 'RSA блокът е с невалиден padding');
  return block.subarray(end + 1);
}

/** Какво носи PKESK при RSA: алгоритъм на шифъра, ключът и 2-байтова контролна сума. */
function sessionBlob(sessionKey) {
  let sum = 0;
  for (const byte of sessionKey) sum = (sum + byte) & 0xffff;
  return Buffer.concat([Buffer.from([9]), sessionKey, Buffer.from([sum >> 8, sum & 0xff])]);
}

/**
 * Криптира данни до публичен ключ и връща armored `PGP MESSAGE`.
 *   • X25519/X448: PKESK v3 `[eph][дължина][алгоритъм][AES-KW(ключ)]` (RFC 9580 §5.1.6);
 *   • RSA: PKESK v3 с MPI и PKCS#1 v1.5.
 * Вътре винаги е SEIPD v1 с MDC — това чете и gpg.
 */
function encryptToKey(data, armoredPublicKey) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data == null ? '' : data), 'utf8');
  if (!payload.length) throw fail('INVALID_DATA', 'Няма данни за криптиране');
  const parsed = parseKeyBlock(armoredPublicKey);
  const key = encryptionKeyOf(parsed);
  const sessionKey = crypto.randomBytes(32);
  let pkesk;

  if (key.kind === 'x25519' || key.kind === 'x448') {
    const curve = X_CURVES[key.algo];
    if (!curve) throw fail('UNSUPPORTED_ALGO', `Неподдържана крива (${key.algo})`);
    const ephemeral = crypto.generateKeyPairSync(curve.crv.toLowerCase());
    const ephemeralPublic = Buffer.from(ephemeral.publicKey.export({ format: 'jwk' }).x, 'base64url');
    const shared = crypto.diffieHellman({ privateKey: ephemeral.privateKey, publicKey: okpPublic(key.point, curve.crv) });
    const wrapped = aesKeyWrap(curve.wrap, kekFor(curve, ephemeralPublic, key.point, shared), sessionKey, true);
    // „дължината“ покрива октета на алгоритъма и обвития ключ — при v3 PKESK алгоритъмът
    // е ИЗВЪН обвивката (проверено срещу OpenPGP.js 6.3.2).
    pkesk = packet(1, Buffer.concat([
      Buffer.from([3]),
      Buffer.from(key.keyId, 'hex'),
      Buffer.from([key.algo]),
      ephemeralPublic,
      Buffer.from([1 + wrapped.length, 9]),
      wrapped,
    ]));
  } else {
    const bits = key.n.length * 8;
    if (bits < 2048) throw fail('WEAK_KEY', `Твърде малък RSA ключ за криптиране (${bits} бита, нужно е ≥ 2048)`);
    const encrypted = rsaEncryptPkcs1(publicKeyObject(key), sessionBlob(sessionKey));
    pkesk = packet(1, Buffer.concat([
      Buffer.from([3]),
      pgpKeyFingerprintHex(key).subarray(-8),
      Buffer.from([1]),
      writeMpi(encrypted),
    ]));
  }

  // Префикс: 16 случайни октета + 2 октета от сесийния ключ. При X25519 алгоритъмът е в
  // PKESK, затова тук няма трети октет (18, не 19 байта).
  const block = 16;
  const prefix = Buffer.concat([crypto.randomBytes(block), sessionKey.subarray(30, 32)]);
  // Данните влизат в литерален пакет (tag 11), както правят gpg и OpenPGP.js: без него
  // потокът от пакети е невалиден и чуждите четци спират преди края (MDC изглежда счупен).
  const literal = packet(11, Buffer.concat([Buffer.from([0x62, 0x00]), Buffer.alloc(4), payload]));
  const content = Buffer.concat([prefix, literal]);
  // MDC (RFC 4880 §5.13): SHA-1 върху ЦЯЛОТО, включително двата октета 0xD3 0x14.
  const mdcHeader = Buffer.from([0xd3, 0x14]);
  const mdc = crypto.createHash('sha1').update(Buffer.concat([content, mdcHeader])).digest();
  const inner = Buffer.concat([content, mdcHeader, mdc]);
  const cipher = crypto.createCipheriv('aes-256-cfb', sessionKey, Buffer.alloc(block, 0));
  const sealed = Buffer.concat([cipher.update(inner), cipher.final()]);
  const seipd = packet(18, Buffer.concat([Buffer.from([1]), sealed]));
  return {
    armored: armor('MESSAGE', Buffer.concat([pkesk, seipd])),
    keyId: key.keyId,
    fingerprint: key.fingerprint,
    algorithm: key.kind === 'rsa' ? `RSA ${key.n.length * 8}` : key.algorithm,
    bytes: payload.length,
  };
}

/**
 * Маха обвивките, които инструментите слагат вътре в шифротекста: литерален пакет
 * (tag 11) и padding (tag 21). hAPI криптира самите данни, затова при него няма нищо.
 */
function stripWrappingPackets(buffer) {
  let rest = buffer;
  for (let guard = 0; guard < 4; guard++) {
    if (!rest.length) return rest;
    const newFormat = (rest[0] & 0x40) !== 0;
    const tag = newFormat ? rest[0] & 0x3f : (rest[0] >> 2) & 0x0f;
    let bodyStart;
    if (newFormat) {
      const first = rest[1];
      if (first < 192) bodyStart = 2;
      else if (first < 224) bodyStart = 3;
      else bodyStart = 6;
    } else {
      bodyStart = 1 + (1 << (rest[0] & 3));
    }
    if (tag === 21) return stripWrappingPackets(Buffer.alloc(0));
    if (tag !== 11) return rest;
    const nameLength = rest[bodyStart + 1] || 0;
    return rest.subarray(bodyStart + 2 + nameLength + 4);
  }
  return rest;
}

/**
 * Декриптира `PGP MESSAGE` от hAPI, gpg или OpenPGP.js. Секретният ключ може да е
 * защитен с парола — тогава `passphrase` е задължителна. MDC се проверява винаги.
 */
function decryptMessage(armored, armoredSecretKey, passphrase) {
  const parsed = parseKeyBlock(armoredSecretKey, { passphrase: passphrase || '' });
  const { data } = dearmor(armored);
  const packets = readPackets(data);
  const pkesk = packets.find((p) => p.tag === 1);
  if (!pkesk) throw fail('NOT_ENCRYPTED', 'Съобщението няма PKESK пакет (криптирано е само с парола)');
  const version = pkesk.body[0];
  if (version !== 3 && version !== 6) throw fail('UNSUPPORTED_PKESK', `Неподдържана версия на PKESK (${version})`);
  let at = 1;
  let keyId = '';
  if (version === 6) {
    const length = pkesk.body[at]; at += 1;
    if (length) {
      at += 1; // версия на ключа
      keyId = pkesk.body.subarray(at, at + 8).toString('hex');
      at += length - 1;
    }
  } else {
    keyId = pkesk.body.subarray(at, at + 8).toString('hex');
    at += 8;
  }
  const algo = pkesk.body[at]; at += 1;
  const secret = parsed.keys.find((k) => k.secret && k.keyId.toLowerCase() === keyId) || parsed.keys.find((k) => k.secret);
  if (!secret) throw fail('NO_SECRET_KEY', 'Секретният ключ не съдържа този ключ за криптиране');

  let sessionKey;
  let sessionAlgo;
  let prefixLength;
  const block = 16;

  if (algo === 25 || algo === 26) {
    const curve = X_CURVES[algo];
    const ephemeral = pkesk.body.subarray(at, at + curve.size); at += curve.size;
    const size = pkesk.body[at]; at += 1;
    sessionAlgo = pkesk.body[at]; at += 1;
    const wrapped = pkesk.body.subarray(at, at + size - 1);
    const shared = crypto.diffieHellman({
      privateKey: okpPrivate(secret.point, secret.secret.d, curve.crv),
      publicKey: okpPublic(ephemeral, curve.crv),
    });
    try {
      sessionKey = aesKeyWrap(curve.wrap, kekFor(curve, ephemeral, secret.point, shared), wrapped, false);
    } catch {
      throw fail('BAD_SESSION_KEY', 'Сесийният ключ не може да бъде развит с този ключ');
    }
    prefixLength = block + 2;
  } else if (algo === 1 || algo === 2) {
    const encrypted = readMpi(pkesk.body, at).value;
    let blob;
    try {
      blob = rsaDecryptPkcs1(privateKeyObject(secret, secret.secret), encrypted);
    } catch (e) {
      throw fail('BAD_SESSION_KEY', e && e.message ? e.message : 'Сесийният ключ не може да бъде разчетен с този ключ');
    }
    if (blob.length < 4) throw fail('BAD_SESSION_KEY', 'Сесийният ключ е отрязан');
    sessionAlgo = blob[0];
    const info = SYM_CIPHERS[sessionAlgo];
    if (!info) throw fail('UNSUPPORTED_CIPHER', `Неподдържан шифър на съобщението (${sessionAlgo})`);
    sessionKey = blob.subarray(1, 1 + info.keyBytes);
    let sum = 0;
    for (const byte of sessionKey) sum = (sum + byte) & 0xffff;
    if (sum !== blob.readUInt16BE(1 + info.keyBytes)) throw fail('BAD_SESSION_KEY', 'Контролната сума на сесийния ключ не съвпада');
    // 18 или 19 октета — решава се след декриптирането, по съдържанието (виж по-долу).
    prefixLength = block + 2;
  } else {
    throw fail('UNSUPPORTED_ALGO', `Неподдържан алгоритъм на ключа за криптиране (${algo})`);
  }

  const cipherInfo = SYM_CIPHERS[sessionAlgo];
  if (!cipherInfo) throw fail('UNSUPPORTED_CIPHER', `Неподдържан шифър на съобщението (${sessionAlgo})`);
  const seipd = packets.find((p) => p.tag === 18);
  if (!seipd) {
    const aead = packets.find((p) => p.tag === 20);
    if (aead) {
      const names = { 1: 'EAX', 2: 'OCB', 3: 'GCM' };
      throw fail('UNSUPPORTED_AEAD', `Съобщението е AEAD/${names[aead.body[2]] || aead.body[2]} — hAPI чете SEIPD v1. Криптирай с hAPI или с инструмент, който пише SEIPD v1.`);
    }
    throw fail('UNSUPPORTED_FORMAT', 'Липсва SEIPD пакет (компресирано съобщение не се поддържа)');
  }
  if (seipd.body[0] !== 1) throw fail('UNSUPPORTED_FORMAT', `Неподдържана версия на SEIPD (${seipd.body[0]})`);
  let inner;
  try {
    const decipher = crypto.createDecipheriv(cipherInfo.name, sessionKey, Buffer.alloc(cipherInfo.block, 0));
    inner = Buffer.concat([decipher.update(seipd.body.subarray(1)), decipher.final()]);
  } catch {
    throw fail('DECRYPT_FAILED', 'Съобщението не може да бъде декриптирано');
  }
  if (inner.length < prefixLength + 22) throw fail('BAD_MESSAGE', 'Отрязано съобщение');
  if (inner[inner.length - 22] !== 0xd3 || inner[inner.length - 21] !== 0x14) {
    throw fail('MDC_MISSING', 'Липсва контрола за цялост (MDC) — съобщението е подменено или от стар формат');
  }
  const want = crypto.createHash('sha1').update(inner.subarray(0, inner.length - 20)).digest();
  if (!crypto.timingSafeEqual(inner.subarray(inner.length - 20), want)) {
    throw fail('MDC_MISMATCH', 'Контролната сума не съвпада — съобщението е подменено');
  }
  // Префиксът на SEIPD v1: `block` случайни октета + 2 октета за проверка (RFC 4880 §5.7).
  // Двете проверъчни октета не са еднакви при всички: hAPI и OpenPGP.js повтарят края на
  // СЕСИЙНИЯ ключ, а GnuPG повтаря последните два октета на самия случаен блок (измерено с
  // gpg 2.5.24). Приемат се и двете; цялостта така или иначе е доказана от MDC по-горе.
  // Дължината също не се предполага: GnuPG слага между тях октет с алгоритъма на шифъра.
  if (algo === 1 || algo === 2) {
    const repeat = inner.subarray(block, block + 2);
    const matchesKey = repeat.equals(sessionKey.subarray(sessionKey.length - 2));
    const matchesPrefix = repeat.equals(inner.subarray(block - 2, block));
    if (!matchesKey && !matchesPrefix) {
      throw fail('BAD_SESSION_KEY', 'Префиксът не отговаря нито на сесийния ключ, нито на себе си');
    }
    prefixLength = inner[block + 2] === sessionAlgo ? block + 3 : block + 2;
  }
  const result = stripWrappingPackets(inner.subarray(prefixLength, inner.length - 22));
  // Компресия вътре в шифротекста не се поддържа — по-добре ясен код, отколкото смет.
  if (result.length && result[0] & 0x80) {
    const tag = result[0] & 0x40 ? result[0] & 0x3f : (result[0] >> 2) & 0x0f;
    if (tag === 8) {
      throw fail('UNSUPPORTED_COMPRESSION', 'Съобщението е компресирано преди криптиране — криптирай без компресия (`gpg -z 0` или hAPI)');
    }
  }
  return result;
}

module.exports = {
  armor,
  dearmor,
  crc24,
  packet,
  readPackets,
  parseKeyBlock,
  describe,
  publicKeyOf,
  // Кой ключ криптира и кой подписва: решенията живеят тук, за да не се разминават
  // между ключохранилището и двигателя.
  encryptionKeyOf,
  signingKey,
  signDetached,
  verifyDetached,
  generate,
  encryptToKey,
  decryptMessage,
  ALGO,
};
