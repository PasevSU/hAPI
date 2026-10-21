# ADR-0011: compatibility

- **Status:** Accepted
- **Date:** 2026-10
- **Context:** Must support HA (LAN/NAS) and Windows with identical behavior.
- **Decision:** Compatibility matrix — API v1 stable on both; Node `node:sqlite`
  everywhere; feature flags for platform-only capabilities; nightly dual-runner tests.
- **Options:** (A) single matrix + feature flags ✅; (B) fork per platform ❌;
  (C) runtime-specific code in domain layer ❌.
- **Consequences:** contract discipline; CI runs HA + Windows runners.
- **Validation:** `06_TESTING/INTEROPERABILITY.md` + dual-target suite.
