'use strict';
// Минимален X.509 (self-signed) — за подписване на отчети и за устройствени сертификати.
//
// Защо собствен DER писач: проектът е без зависимости, а за detached CMS подпис
// (PDF/RS-06) е нужен сертификат, който да застане в `SignedData.certificates`. Тук се
// строи САМО това, което подписът изисква: версия, сериен номер, алгоритъм, издател,
// валидност, субект, публичен ключ и подпис. Нищо „декоративно“ — всяко поле се проверява
// от `node:crypto` в теста (`X509Certificate` + `verify`).
//
// Сертификатът е САМОПОДПИСАН: той доказва цялост и произход на ключа, но не е издаден от
// удостоверител. Затова никъде не се твърди „удостоверен“ — вж. README на Report Studio.
const crypto = require('node:crypto');

// ── DER писач ────────────────────────────────────────────────────────────────────
const len = (n) => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let rest = n;
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), len(content.length), content]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const ctx = (n, content, constructed = true) => tlv((constructed ? 0xa0 : 0x80) + n, content);
const int = (value) => {
  let bytes = [];
  let n = value;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  if (!bytes.length) bytes = [0];
  if (bytes[0] & 0x80) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
};
const octet = (buf) => tlv(0x04, Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
const bits = (buf, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), buf]));
const utf8 = (text) => tlv(0x0c, Buffer.from(String(text), 'utf8'));
const utcTime = (date) => {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z';
  return tlv(0x17, Buffer.from(iso, 'latin1'));
};
/** OID от точков вид; 1.2.840 → първите два компонента се кодират като 40*a+b. */
const oid = (dotted) => {
  const parts = String(dotted).split('.').map(Number);
  const bytes = [40 * parts[0] + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk = [];
    let n = part;
    do {
      chunk.unshift(n & 0x7f);
      n >>= 7;
    } while (n > 0);
    bytes.push(...chunk.map((b, i) => (i === chunk.length - 1 ? b : b | 0x80)));
  }
  return tlv(0x06, Buffer.from(bytes));
};
const OID = {
  sha256WithRsa: '1.2.840.113549.1.1.11',
  rsaEncryption: '1.2.840.113549.1.1.1',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  country: '2.5.4.6',
};
const nameAttr = (type, value) => set(seq(oid(type), utf8(value)));
const ALG_SHA256_RSA = seq(oid(OID.sha256WithRsa), Buffer.from([0x05, 0x00])); // + NULL params

/** Чете TLV от буфер, започвайки от offset; връща {tag, content, start, end}. */
function readTlv(buf, offset) {
  const tag = buf[offset];
  let p = offset + 1;
  let length = buf[p];
  p += 1;
  if (length & 0x80) {
    const n = length & 0x7f;
    length = 0;
    for (let i = 0; i < n; i += 1) length = (length << 8) | buf[p + i];
    p += n;
  }
  return { tag, content: buf.subarray(p, p + length), start: offset, end: p + length };
}

/** Издател и сериен номер на сертификат (за CMS signerInfo). */
function issuerAndSerial(certDer) {
  const cert = readTlv(certDer, 0); // Certificate SEQUENCE
  const tbs = readTlv(cert.content, 0); // TBSCertificate
  let offset = 0;
  let first = readTlv(tbs.content, 0);
  if (first.tag === 0xa0) offset = first.end; // [0] EXPLICIT version
  const serial = readTlv(tbs.content, offset);
  offset = serial.end;
  const sigAlg = readTlv(tbs.content, offset); // AlgorithmIdentifier
  offset = sigAlg.end;
  const issuer = readTlv(tbs.content, offset); // Name
  return {
    serial: Buffer.from(serial.content),
    serialRaw: Buffer.from(serial.content),
    issuer: Buffer.from(tbs.content.subarray(issuer.start, issuer.end)),
  };
}

/**
 * Прави самоподписан сертификат.
 * @param {{commonName?:string, organization?:string, country?:string, days?:number, keySize?:number, keyPem?:string}} options
 * @returns {{certDer: Buffer, certPem: string, keyPem: string, pem: string, subject: string}}
 */
function selfSigned(options) {
  const opts = options || {};
  const commonName = String(opts.commonName || 'hAPI Report Signer');
  const organization = String(opts.organization || 'hAPI Enterprise');
  const country = String(opts.country || 'BG');
  const days = Number(opts.days || 365);
  const keys = opts.keyPem
    ? { privateKey: crypto.createPrivateKey(opts.keyPem), publicKey: crypto.createPublicKey(opts.keyPem) }
    : crypto.generateKeyPairSync('rsa', { modulusLength: Number(opts.keySize || 2048) });

  const now = new Date();
  const notBefore = new Date(now.getTime() - 60 * 1000);
  const notAfter = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  // Сериен номер: 16 случайни байта, но с изчистен висок бит (положително число).
  const serialBytes = crypto.randomBytes(16);
  serialBytes[0] &= 0x7f;
  if (!serialBytes[0]) serialBytes[0] = 1;

  const name = seq(...examplesName(country, organization, commonName));
  const spki = crypto.createPublicKey(keys.privateKey).export({ type: 'spki', format: 'der' });
  const tbs = seq(
    ctx(0, int(2), true), // [0] version v3
    tlv(0x02, serialBytes),
    ALG_SHA256_RSA,
    name,
    seq(utcTime(notBefore), utcTime(notAfter)),
    name,
    Buffer.from(spki),
  );
  const signature = crypto.sign('sha256', tbs, keys.privateKey);
  const certDer = seq(tbs, ALG_SHA256_RSA, bits(signature));
  const certPem = toPem('CERTIFICATE', certDer);
  return {
    certDer,
    certPem,
    keyPem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    pem: certPem,
    subject: `CN=${commonName}`,
  };
}

// RDN последователност: C, O, CN (редът е по избор, но трябва да е стабилен).
function examplesName(country, organization, commonName) {
  return [nameAttr(OID.country, country), nameAttr(OID.organization, organization), nameAttr(OID.commonName, commonName)];
}

function toPem(label, der) {
  const body = der.toString('base64').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN ${label}-----\n${body.replace(/\n$/, '')}\n-----END ${label}-----\n`;
}

module.exports = { selfSigned, issuerAndSerial, readTlv, toPem, len, OID, tlv, seq, set, ctx, int, octet, bits, utf8, utcTime, oid, ALG_SHA256_RSA };
