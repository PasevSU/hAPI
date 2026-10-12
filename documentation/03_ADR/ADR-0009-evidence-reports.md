# ADR-0009: evidence-reports

- **Status:** Accepted
- **Date:** 2026-10
- **Context:** Courts need a human-readable, tamper-evident report of evidence.
- **Decision:** Generate a canonical evidence report (PDF/JSON) that includes
  manifest, hashes, signature, timestamp, and audit excerpt; signed as one unit.
- **Options:** (A) signed canonical report ✅; (B) raw folder dump ❌; (C) DB export
  only ❌ (not self-contained).
- **Consequences:** `pdf-writer.js` + `EvidenceManifest` compose the report.
- **Validation:** report verify round-trip in `06_TESTING`.
