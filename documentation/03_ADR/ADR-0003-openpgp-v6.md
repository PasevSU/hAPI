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
