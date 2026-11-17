/*
 * Hand-built OpenPGP fixtures, shared by the tests that need a signed message
 * without a gpg binary, a keyring or a network.
 *
 * `pgp-thunderbird.cjs` proves the packet parser reads the signer out of a real
 * signature; `check-sent.cjs` needs the same shape to prove the verifier notices a
 * message that carries no signature at all. One builder, so the two cannot drift.
 */

'use strict';

const FINGERPRINT = 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678';

/** A v4 signature packet carrying issuer fingerprint (type 33) and key ID (type 16). */
function signaturePacket(fingerprint = FINGERPRINT) {
  const keyId = fingerprint.slice(-16);
  const issuerFingerprint = Buffer.concat([
    Buffer.from([22, 0x21, 0x04]), // length 22, type 33, fingerprint version 4
    Buffer.from(fingerprint, 'hex'),
  ]);
  const created = Buffer.from([5, 0x02, 0x69, 0x00, 0x00, 0x00]); // length 5, type 2, time
  const hashed = Buffer.concat([created, issuerFingerprint]);
  const unhashed = Buffer.concat([Buffer.from([9, 0x10]), Buffer.from(keyId, 'hex')]); // length 9, type 16

  const hashedLength = Buffer.alloc(2);
  hashedLength.writeUInt16BE(hashed.length, 0);
  const unhashedLength = Buffer.alloc(2);
  unhashedLength.writeUInt16BE(unhashed.length, 0);

  const body = Buffer.concat([
    Buffer.from([0x04, 0x01, 0x01, 0x08]), // v4, canonical text, RSA, SHA-256
    hashedLength,
    hashed,
    unhashedLength,
    unhashed,
    Buffer.from([0x00, 0x00]), // left 16 bits of the signed hash
  ]);

  return Buffer.concat([Buffer.from([0xc2, body.length]), body]); // new-format packet, tag 2
}

function armor(packet) {
  const base64 = packet.toString('base64').replace(/(.{64})/g, '$1\n').trimEnd();
  return ['-----BEGIN PGP SIGNATURE-----', '', base64, '=AbCd', '-----END PGP SIGNATURE-----'].join('\n');
}

module.exports = { FINGERPRINT, signaturePacket, armor };
