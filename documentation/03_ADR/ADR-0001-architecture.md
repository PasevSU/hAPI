# ADR-0001: architecture

- **Status:** Accepted
- **Date:** 2026-10
- **Context:** Need one maintainable codebase that runs as HA add-on and Windows app.
- **Decision:** Single Node.js backend (`server.js` composition root) + layered
  DOCFLOW L1–L6; UI surfaces call the same versioned REST API.
- **Options:** (A) single backend + thin clients ✅; (B) two separate codebases ❌;
  (C) Python-only ❌ (no browser parity).
- **Consequences:** one behavior across targets; must keep API contract strict.
- **Validation:** same test suite (`tests/*.cjs`) passes on both runtimes.
