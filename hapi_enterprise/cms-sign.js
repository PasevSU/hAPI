'use strict';
// Detached CMS/PKCS#7 подпис (RS-06) — това, което PDF четецът проверява.
//
// Структурата е `ContentInfo signedData` по RFC 5652, с **detached** съдържание: подписва се
// SHA-256 на файла, а самите байтове остават извън подписа (`.pdf` + `.p7s`). Затова:
//   • `signedAttrs` носят `contentType = id-data` и `messageDigest = sha256(файла)` —
//     подписът е върху АТРИБУТИТЕ, не върху файла директно (така изисква PDF);
//   • `signature` е RSA-SHA256 върху DER на `signedAttrs` с таг `[0]` (IMPLICIT SET);
//   • `certificates` носи сертификата, за да може проверяващият да го вземе от подписа.
//
// Ключът и сертификатът се подават отвън. Без тях модулът ОТКАЗВА — никакъв „подпис по
// подразбиране“ и никакъв фалшив сертификат, защото подпис без ключ е лъжа.
const crypto = require('node:crypto');
const x509 = require('./x509');

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
};
const NULL_PARAMS = Buffer.from([0x05, 0x00]);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();

/** authenticatedAttributes: contentType + messageDigest (в този ред; DER SET сортира по байт). */
function signedAttributes(digest) {
  const attr = (type, values) => x509.seq(x509.oid(type), x509.set(...values));
  const items = [attr(OID.contentType, [x509.oid(OID.data)]), attr(OID.messageDigest, [x509.octet(digest)])];
  // DER изисква SET OF да е сортиран лексикографски по кодиране.
  items.sort((a, b) => Buffer.compare(a, b));
  return x509.set(...items);
}

/**
 * Подписва данни detached (PDF или друг файл).
 * @param {{data: Buffer, certDer: Buffer, keyPem: string}} options
 * @returns {{cms: Buffer, digest: string, signature: Buffer, signedAttrs: Buffer}}
 */
function signDetached(options) {
  const opts = options || {};
  const data = opts.data;
  if (!Buffer.isBuffer(data) || !data.length) throw Object.assign(new Error('Няма какво да се подпише'), { status: 400 });
  if (!opts.certDer || !Buffer.isBuffer(opts.certDer)) throw Object.assign(new Error('Липсва сертификат (certDer) — без него подписът не е проверим'), { status: 400 });
  if (!opts.keyPem) throw Object.assign(new Error('Липсва частен ключ (keyPem) — подпис без ключ не се прави'), { status: 400 });

  const digest = sha256(data);
  const attrs = signedAttributes(digest);
  // За подписа атрибутите се кодират с таг [0] IMPLICIT (заменя SET), както изисква CMS.
  const attrsForSigning = Buffer.concat([Buffer.from([0xa0]), attrs.subarray(1)]);
  const privateKey = crypto.createPrivateKey(opts.keyPem);
  const signature = crypto.sign('sha256', attrsForSigning, privateKey);

  const { serial, issuer } = x509.issuerAndSerial(opts.certDer);
  const signerInfo = x509.seq(
    x509.int(1), // version: issuerAndSerialNumber
    x509.seq(issuer, x509.tlv(0x02, serial)), // sid
    x509.seq(x509.oid(OID.sha256), NULL_PARAMS), // digestAlgorithm
    attrs, // signedAttrs (SET OF, както остава в подписа)
    x509.seq(x509.oid(OID.rsaEncryption), NULL_PARAMS), // signatureAlgorithm
    x509.octet(signature),
  );
  const signedData = x509.seq(
    x509.int(1), // version
    x509.set(x509.seq(x509.oid(OID.sha256), NULL_PARAMS)), // digestAlgorithms
    x509.seq(x509.oid(OID.data)), // encapContentInfo: detached, без eContent
    x509.ctx(0, opts.certDer, true), // [0] IMPLICIT certificates
    x509.set(signerInfo), // signerInfos
  );
  const cms = x509.seq(x509.oid(OID.signedData), x509.ctx(0, signedData, true));
  return { cms, digest: digest.toString('hex'), signature, signedAttrs: attrs };
}

// ── Минимален разбор за проверка (същият формат, който сами пишем) ─────────────────
function children(buf, node) {
  const out = [];
  let offset = 0;
  while (offset < node.content.length) {
    const child = x509.readTlv(node.content, offset);
    out.push(child);
    offset = child.end;
  }
  return out;
}

/**
 * Проверява detached подпис срещу данните.
 * @returns {{ok: boolean, reason?: string, digest?: string, subject?: string}}
 */
function verifyDetached(options) {
  const opts = options || {};
  const data = opts.data;
  const cms = opts.cms || (opts.cmsDer ? Buffer.from(opts.cmsDer) : null);
  if (!Buffer.isBuffer(data) || !Buffer.isBuffer(cms)) return { ok: false, reason: 'липсват данни или подпис' };
  try {
    const contentInfo = x509.readTlv(cms, 0);
    const infoChildren = children(cms, contentInfo);
    if (!infoChildren.length) return { ok: false, reason: 'празен ContentInfo' };
    if (dottedOid(Buffer.from(infoChildren[0].content)) !== OID.signedData) return { ok: false, reason: 'не е signedData' };
    const explicit = infoChildren[1];
    if (!explicit) return { ok: false, reason: 'липсва съдържание на signedData' };
    const signedData = children(cms, explicit)[0];
    if (!signedData) return { ok: false, reason: 'липсва SignedData' };
    const parts = children(cms, signedData); // version, digestAlgorithms, encapContentInfo, [certificates], signerInfos
    const encap = parts[2];
    if (!encap) return { ok: false, reason: 'липсва encapContentInfo' };
    if (children(cms, encap).length !== 1) return { ok: false, reason: 'подписът не е detached (има вградено съдържание)' };
    const certNode = parts.find((p) => p.tag === 0xa0);
    if (!certNode) return { ok: false, reason: 'липсва сертификат в подписа' };
    const certDer = Buffer.from(certNode.content);
    const cert = new crypto.X509Certificate(certDer);
    const signerInfos = parts[parts.length - 1];
    const signerInfo = children(explicit.content, signerInfos)[0];
    const fields = children(explicit.content, signerInfo);
    // fields: version, sid, digestAlgorithm, signedAttrs, signatureAlgorithm, signature
    const signedAttrs = fields[3];
    const sigNode = fields[5];
    if (!signedAttrs || !sigNode) return { ok: false, reason: 'липсват signedAttrs или подпис' };
    // Подписът е върху СЪЩОТО съдържание, но с таг [0] вместо SET (IMPLICIT кодиране).
    const signingBytes = Buffer.concat([Buffer.from([0xa0]), x509.len(signedAttrs.content.length), signedAttrs.content]);
    const okSignature = crypto.verify('sha256', signingBytes, cert.publicKey, Buffer.from(sigNode.content));
    if (!okSignature) return { ok: false, reason: 'подписът не се проверява с публичния ключ' };
    // messageDigest трябва да съвпада с SHA-256 на данните.
    const digest = sha256(data);
    let msgDigest = null;
    for (const attr of children(cms, signedAttrs)) {
      const parts2 = children(cms, attr);
      if (parts2.length < 2) continue;
      if (dottedOid(Buffer.from(parts2[0].content)) !== OID.messageDigest) continue;
      const value = children(cms, parts2[1])[0];
      if (value) msgDigest = Buffer.from(value.content);
    }
    if (!msgDigest) return { ok: false, reason: 'липсва messageDigest' };
    if (Buffer.compare(msgDigest, digest) !== 0) return { ok: false, reason: 'messageDigest не съвпада с данните' };
    return { ok: true, digest: digest.toString('hex'), subject: cert.subject.replace(/\n/g, ', '), signatureBytes: Buffer.from(sigNode.content) };
  } catch (e) {
    return { ok: false, reason: 'подписът не може да се разчете: ' + e.message };
  }
}

function dottedOid(bytes) {
  const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let value = 0;
  for (const byte of bytes.subarray(1)) {
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

module.exports = { signDetached, verifyDetached, OID, signedAttributes, sha256 };
