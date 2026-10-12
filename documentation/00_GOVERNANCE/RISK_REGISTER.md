# Risk Register — hAPI Enterprise

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
| -- | ---- | ---------- | ------ | ---------- | ----- |
| R1 | Evidence forgery (file altered after upload) | High | Critical | SHA-256/512 in manifest + receipt, hash-chained audit, WORM | Security |
| R2 | Audit tampering | Medium | Critical | Append-only hash-chained `audit-chain.jsonl`, external anchor | Security |
| R3 | Unauthorized access to evidence | Medium | High | Roles, PKCE/OIDC + MFA, rate limit, access audit | Security |
| R4 | "Who/when" dispute (provenance) | Medium | High | Upload receipt + RFC 3161 timestamp | Security |
| R5 | Copy ≠ original (verification gap) | Medium | High | Client-side hash recomputation (WebCrypto) | Portal |
| R6 | Data loss during migration | Medium | High | Zero-damage migration, hash-verify, rollback plan | Ops |
| R7 | Dependency on Node ≥ 22.13 (`node:sqlite`) | Low | Medium | Embedded Node in add-on image and Windows package | Packaging |
| R8 | Single-process scalability ceiling | Medium | Medium | Load control, bounded concurrency, documented limit | Ops |
| R9 | MITM on public link | Low | High | HTTPS (HA Ingress TLS), signed URLs, hash in QR | Security |

## Review

- Reviewed at each phase close and before every release.
- Critical/high risks require an explicit mitigation note in the release decision.
