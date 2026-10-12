# ADR-0002: crypto-provider

- **Status:** Accepted
- **Date:** 2026-10
- **Context:** Receipts start as HMAC-SHA256; legal evidence needs signatures.
- **Decision:** Introduce a `CryptoProvider` abstraction with HMAC (legacy) and
  PKCS#7 detached signature (target) behind one sign/verify interface.
- **Options:** (A) provider abstraction ✅; (B) hardcode PKCS#7 only ❌ (breaks
  current installs); (C) vendor bespoke signing ❌.
- **Consequences:** seamless upgrade; must maintain backward-compat HMAC verify.
- **Validation:** `tests/signing.cjs` / `tests/core-signer.cjs` remain green.
