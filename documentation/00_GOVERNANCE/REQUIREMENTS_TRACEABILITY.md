# Requirements Traceability Matrix — hAPI Enterprise

Legend: **P**hase, **T**est reference, status ✅/🟡.

| ID | Requirement | Phase | Backend handler | Test | Status |
| -- | ----------- | ----- | --------------- | ---- | ------ |
| REQ-001 | Variable hierarchy with composite key | 1 | registry / variable-store | `tests/*.cjs` | ✅ |
| REQ-002 | Auto-generated profiles + orphan records | 1 | groups/profiles | core tests | ✅ |
| REQ-003 | Metadata-driven schemas | 2 | registry | flexibility tests | ✅ |
| REQ-004 | Replaceable Repository interface | 2 | repository | flexibility tests | ✅ |
| REQ-005 | HMAC-SHA256 integrity | 3 | signer.js | signer tests | ✅ |
| REQ-006 | Document preview + thumbnails | 4 | preview.js | phase-4 tests | ✅ |
| REQ-007 | Versioning + PDF watermarks | 4 | versioning / pdf-writer | phase-4 tests | ✅ |
| REQ-008 | QR share + landing + revocation | 4 | sharing / qr | phase-4 tests | ✅ |
| REQ-009 | Settings UI + progress popup | 5 | settings / progress | phase-5 tests | 🟡 |
| REQ-010 | Zero-damage migration | 6 | migration-bridge | phase-6 tests | 🟡 |
| REQ-011 | Judge/prosecutor roles | 7 | portal-auth / rbac | portal-roles | 🟡 |
| REQ-012 | Client-side hash verification | 7 | verifier | portal-verify | 🟡 |
| REQ-013 | PKCS#7 + RFC 3161 evidence sealing | 7 | signer / tsa-client | portal-upload-evidence | 🟡 |
| REQ-014 | Chain of custody (hash-chained) | 7 | audit-chain | portal-chain-of-custody | 🟡 |

> Source of truth for detailed specs: `documentation/04_FUNCTION_SPECIFICATIONS/`.
