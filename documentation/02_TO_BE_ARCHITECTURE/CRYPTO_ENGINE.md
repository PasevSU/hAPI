# Crypto Engine — hAPI Enterprise (To-Be)

## Goal

Upgrade HMAC receipts into **legally meaningful cryptographic evidence**:

- **Detached digital signature** (PKCS#7 / CMS) with an X.509 certificate.
- **RFC 3161 timestamp token** from an external TSA.
- **Verifiable chain of custody** with external anchor hash.

## Pipeline (on document finalization)

```text
document
  └─ canonicalize (fixed field order + UTF-8)
       ├─ hash SHA-256 + SHA-512
       │    ├─ PKCS#7 detached signature (server key)
       │    └─ RFC 3161 timestamp token (external TSA)
       ├─ evidence manifest (JSON, canonical)
       └─ append audit-chain entry + anchor hash
```

## Components

| Component | Responsibility |
| --------- | -------------- |
| `CryptoProvider` | sign/verify abstraction (HMAC → PKCS#7 interchangeable) |
| `TsaClient` | RFC 3161 request/verify (replaceable TSA URL) |
| `KeyManager` | key lifecycle, rotation, revocation |
| `EvidenceManifest` | canonical manifest generation |

## Verification (judge/prosecutor)

1. Download original document + manifest + signature + timestamp.
2. Portal/client recomputes SHA-256/SHA-512 → must match manifest.
3. Verify PKCS#7 signature against trusted cert.
4. Verify RFC 3161 token against TSA cert.

## Non-goals

- We do **not** operate our own CA/TSA; we consume public/private TSAs and customer certs.
