# ADR-0003: openpgp-v6

- **Status:** Accepted
- **Date:** 2026-10
- **Context:** Interoperability of evidence with courts/tools that understand OpenPGP.
- **Decision:** Support OpenPGP v6 for exchange/signature verification alongside
  PKCS#7; default issuance remains PKCS#7 (X.509) for courts.
- **Options:** (A) PKCS#7 + OpenPGP v6 bridge ✅; (B) OpenPGP only ❌; (C) no
  standards-based signature ❌.
- **Consequences:** broader interop; extra verification path to maintain.
- **Validation:** `06_TESTING/INTEROPERABILITY.md`.
- **Implemented (2026-10):** `hapi_enterprise/pgp.js` — detached binary signatures for
  **OpenPGP v4 and v6 (RFC 9580)** (RSA/SHA-256, Ed25519/SHA-512), ASCII armor + CRC24,
  key parsing (v4 + v6 fingerprints/key IDs), verification, and package signing
  (`packager.js`). v6 signatures use a salt, 4-octet subpacket lengths and an Issuer
  Fingerprint subpacket (no Issuer Key ID). Keys are **attached** through
  „Настройки → PGP ключ и автоподписване“ (`POST /admin/api/pgp/keys` with
  `secretArmored`); the add-on does not generate keys for production use.
- **Validation:** v4 verified both directions against GnuPG 2.5
  (`tests/pgp-gpg-interop.cjs`); v6 verified against an independent RFC 9580
  implementation (OpenPGP.js 6) plus own round-trip tests (`tests/pgp.cjs`), because the
  GnuPG build used for interop does not yet accept v6 keys. AEAD/SEIPD and
  passphrase-protected (S2K) secret keys are **not** implemented; such keys are rejected
  with a clear error.
