# Release Criteria — hAPI Enterprise

## Hard gates (block release)

- [ ] L0–L5 tests pass (see `06_TESTING/MASTER_TEST_PLAN.md`).
- [ ] No 🔴 Critical / 🟠 High open defects (`01_AS_IS_ARCHITECTURE/KNOWN_DEFECTS.md`).
- [ ] Crypto vectors pass (`06_TESTING/CRYPTO_TEST_VECTORS.md`).
- [ ] Evidence verification path functional: hash + signature + RFC 3161 timestamp.
- [ ] WORM evidence storage present and enforced.
- [ ] Zero-damage migration verified (copy-verify-commit + rollback).
- [ ] Security tests pass (`06_TESTING/SECURITY_TESTS.md`).
- [ ] Interop matrix passes (HA + Windows).
- [ ] Documentation tree complete and current.

## Soft gates (should pass)

- [ ] GUI E2E on desktop + HA Ingress.
- [ ] Settings UI + progress popup (Phase 5) shipped.
- [ ] README (EN/BG/DE) reflect the released version.

## Definitions

- **Release** = versioned add-on tag + Windows artifact + portal endpoint.
- **Blocked** = any hard gate unmet; record in `RELEASE_DECISION.md`.
